import Link from "next/link";

export default function Home() {
  return (
    <div className="center">
      <div className="card login" style={{ textAlign: "center" }}>
        <h1>MailHost</h1>
        <p className="sub">Self-hosted mail platform</p>
        <div className="actions" style={{ justifyContent: "center" }}>
          <Link className="btn primary" href="/webmail">Open webmail</Link>
          <Link className="btn" href="/admin">Admin</Link>
        </div>
      </div>
    </div>
  );
}
