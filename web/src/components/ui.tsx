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
