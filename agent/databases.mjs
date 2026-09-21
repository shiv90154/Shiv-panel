// Tenant databases (MariaDB + PostgreSQL servers installed on the HOST, separate from the mail stack's PostgreSQL).
// One database + one same-named user per database, granted on that database only. SQL is fed on stdin (never argv/shell).
// Identifiers and passwords are restricted to charsets that need no quoting tricks; the admin connection comes from agent env:
//   MARIADB_CMD   default "mariadb" (root over the unix socket, the agent runs as root)
//   PSQL_CMD      default "psql"; connection via PGHOST/PGPORT/PGUSER/PGPASSWORD in the agent's environment
import { spawn } from "node:child_process";

export const ENGINES = ["mariadb", "postgres"];
// "<prefix up to 8>_<rest>": the mandatory underscore + short prefix keeps names clear of system schemas (mysql, information_schema, postgres, template0...)
export const NAME_RE = /^[a-z0-9]{1,8}_[a-z0-9_]{1,23}$/;
export const PASS_RE = /^[A-Za-z0-9_-]{16,64}$/;

export function validateDb(p, { password = false } = {}) {
  if (!ENGINES.includes(p?.engine)) throw new Error("unknown engine");
  if (typeof p.name !== "string" || !NAME_RE.test(p.name)) throw new Error("invalid database name");
  const out = { engine: p.engine, name: p.name };
  if (password) { if (typeof p.password !== "string" || !PASS_RE.test(p.password)) throw new Error("password must be 16-64 chars of A-Z a-z 0-9 _ -"); out.password = p.password; }
  return out;
}

/** Pure: the SQL statements for each operation (unit-tested). Inputs must already be validated. */
export function buildSql(op, { engine, name, password }) {
  if (engine === "mariadb") {
    const u = `'${name}'@'%'`;
    if (op === "create") return [`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`, `CREATE USER ${u} IDENTIFIED BY '${password}';`, `GRANT ALL PRIVILEGES ON \`${name}\`.* TO ${u};`, "FLUSH PRIVILEGES;"];
    if (op === "password") return [`ALTER USER ${u} IDENTIFIED BY '${password}';`];
    return [`DROP DATABASE IF EXISTS \`${name}\`;`, `DROP USER IF EXISTS ${u};`, "FLUSH PRIVILEGES;"];
  }
  if (op === "create") return [`CREATE ROLE "${name}" LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE;`, `CREATE DATABASE "${name}" OWNER "${name}";`, `REVOKE ALL ON DATABASE "${name}" FROM PUBLIC;`];
  if (op === "password") return [`ALTER ROLE "${name}" PASSWORD '${password}';`];
  return [`DROP DATABASE IF EXISTS "${name}" WITH (FORCE);`, `DROP ROLE IF EXISTS "${name}";`];
}

const exec = (cmd, args, stdin) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
  let err = ""; const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
  child.stderr.on("data", (d) => { err += d; });
  child.on("error", (e) => { clearTimeout(timer); reject(new Error(`${cmd}: ${e.message}`)); });
  child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`${cmd} failed: ${err.replace(/PASSWORD '[^']*'|IDENTIFIED BY '[^']*'/g, "<redacted>").trim().slice(0, 300)}`)); });
  child.stdin.end(stdin);
});

// PostgreSQL forbids CREATE DATABASE inside a transaction block, so each statement is its own psql -c call over stdin (-f -).
const runSql = async (engine, statements) => {
  if (engine === "mariadb") return exec(process.env.MARIADB_CMD || "mariadb", ["--batch"], statements.join("\n"));
  for (const s of statements) await exec(process.env.PSQL_CMD || "psql", ["-v", "ON_ERROR_STOP=1", "-q", "-d", "postgres", "-f", "-"], s);
};

const op = (kind, password) => ({
  scope: "account", validate: (p) => validateDb(p, { password }),
  run: async (p) => { await runSql(p.engine, buildSql(kind, p)); return {}; },
});

export const DB_METHODS = {
  "db.create": op("create", true),
  "db.setPassword": op("password", true),
  "db.drop": op("drop", false),
};
