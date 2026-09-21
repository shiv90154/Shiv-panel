export function Flash({ ok, error }: { ok?: string; error?: string }) {
  if (error) return <div className="flash err">{error}</div>;
  if (ok) return <div className="flash ok">{ok}</div>;
  return null;
}

export const Badge = ({ kind, children }: { kind: "ok" | "bad" | "warn" | "off"; children: React.ReactNode }) => <span className={`badge ${kind}`}>{children}</span>;

export function bytes(n: number | bigint) {
  let v = Number(n);
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}

export function UsageBar({ used, quotaMb }: { used: number | bigint; quotaMb: number }) {
  if (!quotaMb) return <span className="muted">{bytes(used)} / unlimited</span>;
  const pct = Math.min(100, (Number(used) / (quotaMb * 1048576)) * 100);
  return (
    <div>
      <div className={pct >= 90 ? "bar hot" : "bar"}><i style={{ width: `${pct}%` }} /></div>
      <span className="muted">{bytes(used)} / {quotaMb >= 1024 ? `${quotaMb / 1024} GB` : `${quotaMb} MB`}</span>
    </div>
  );
}

/** Usage meter: `limit` 0 = unlimited (no bar, just the number). */
export function Meter({ label, used, limit, fmt = (n) => String(n) }: { label: string; used: number; limit: number; fmt?: (n: number) => string }) {
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div className="meter">
      <div className="meter-head"><span>{label}</span><b>{fmt(used)} <span className="muted">/ {limit ? fmt(limit) : "unlimited"}</span></b></div>
      {limit > 0 && <div className={pct >= 90 ? "bar hot" : "bar"}><i style={{ width: `${pct}%` }} /></div>}
    </div>
  );
}

export function SectionCard({ title, actions, children, narrow }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; narrow?: boolean }) {
  return (
    <section className="card" style={narrow ? { maxWidth: 460 } : undefined}>
      {(title || actions) && <div className="card-head">{title && <h2>{title}</h2>}{actions && <div className="actions">{actions}</div>}</div>}
      {children}
    </section>
  );
}

export type Column<T> = { header: string; render: (row: T) => React.ReactNode; nowrap?: boolean; className?: string };

export function DataTable<T>({ columns, rows, rowKey, empty = "Nothing here yet." }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string | number; empty?: string }) {
  return (
    <table>
      <thead><tr>{columns.map((c) => <th key={c.header}>{c.header}</th>)}</tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={rowKey(r)}>{columns.map((c) => <td key={c.header} className={c.className} style={c.nowrap ? { whiteSpace: "nowrap" } : undefined}>{c.render(r)}</td>)}</tr>
        ))}
        {!rows.length && <tr><td colSpan={columns.length} className="muted">{empty}</td></tr>}
      </tbody>
    </table>
  );
}

const ICONS: Record<string, string> = {
  mail: "M3 6h18v12H3zM3 7l9 7 9-7",
  globe: "M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18",
  forward: "M4 12h13M13 6l6 6-6 6",
  inbox: "M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  user: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0",
  users: "M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2 20a7 7 0 0114 0M17 4a3.5 3.5 0 010 7M18 14a7 7 0 013 6",
  package: "M12 3l9 5v8l-9 5-9-5V8zM3 8l9 5 9-5M12 13v8",
  clipboard: "M9 4h6v3H9zM7 5H5v16h14V5h-2M8 12h8M8 16h6",
  server: "M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  key: "M14 10a4 4 0 11-2-3.5L21 16v3h-3v-2h-2v-2h-2z",
  folder: "M3 6h6l2 2h10v11H3z",
  database: "M4 6c0-2 16-2 16 0v12c0 2-16 2-16 0zM4 6c0 2 16 2 16 0M4 12c0 2 16 2 16 0",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
};

export function Icon({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name] ?? ICONS.grid} />
    </svg>
  );
}
