import Link from "next/link";

export default function Home() {
  return (
    <div className="center">
      <div className="card login" style={{ textAlign: "center" }}>
        <h1>Hosting panel</h1>
        <p className="sub">Mail, domains and hosting</p>
        <div className="actions" style={{ justifyContent: "center" }}>
          <Link className="btn primary" href="/webmail">Open webmail</Link>
          <Link className="btn" href="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
