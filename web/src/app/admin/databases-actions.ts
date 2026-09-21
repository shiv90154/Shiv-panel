"use server";

// Database actions, shared by WHM (/admin) and cPanel (/cpanel). Session -> getOwnedDatabase (tenant scope) -> mutate.
import { run, s } from "@/lib/actions-util";
import { audit } from "@/lib/audit";
import { requireSession } from "@/lib/session";
import { assertInScope, getOwnedDatabase } from "@/lib/tenancy";
import { createDatabase, deleteDatabase, resetDatabasePassword } from "@/server/databases";

export async function addDatabase(fd: FormData) {
  const sess = await requireSession();
  return run(`${sess.base}/databases`, async () => {
    const ownerId = s(fd, "ownerId") || sess.account.id;
    await assertInScope(sess, ownerId);
    const d = await createDatabase({ accountId: ownerId, engine: s(fd, "engine"), suffix: s(fd, "name") });
    await audit(sess, "database.create", { target: d.name, accountId: ownerId, detail: { engine: d.engine } });
    return `Database ${d.name} created`;
  });
}

export async function resetDbPassword(id: string) {
  const sess = await requireSession();
  return run(`${sess.base}/databases`, async () => {
    const d = await getOwnedDatabase(sess, id);
    await resetDatabasePassword(d.id);
    await audit(sess, "database.password", { target: d.name, accountId: d.accountId });
    return `New password set for ${d.name}`;
  });
}

export async function removeDatabase(id: string, fd: FormData) {
  const sess = await requireSession();
  return run(`${sess.base}/databases`, async () => {
    const d = await getOwnedDatabase(sess, id);
    if (s(fd, "confirm") !== d.name) throw new Error("Type the database name to confirm");
    await deleteDatabase(d.id);
    await audit(sess, "database.delete", { target: d.name, accountId: d.accountId, detail: { engine: d.engine } });
    return `Database ${d.name} deleted`;
  });
}
