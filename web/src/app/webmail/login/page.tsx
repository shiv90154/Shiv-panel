import { webmailLogin } from "../actions";
import { Flash } from "@/components/ui";

export default async function WebmailLogin({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="center">
      <div className="card login">
        <h1>Webmail</h1>
        <p className="sub">Sign in with your email address</p>
        <Flash error={error} />
        <form action={webmailLogin}>
          <div><label>Email address</label><input name="email" type="email" required autoFocus autoComplete="username" /></div>
          <div><label>Password</label><input name="password" type="password" required autoComplete="current-password" /></div>
          <button className="primary" style={{ width: "100%" }}>Sign in</button>
        </form>
      </div>
    </div>
  );
}
