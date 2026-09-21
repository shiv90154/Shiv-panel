import { login } from "../actions/auth";
import { Flash } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="center">
      <div className="card login">
        <h1>Sign in</h1>
        <p className="sub">Hosting control panel</p>
        <Flash error={error} />
        <form action={login}>
          <div><label>Username or email</label><input name="login" required autoFocus autoComplete="username" /></div>
          <div><label>Password</label><input name="password" type="password" required autoComplete="current-password" /></div>
          <button className="primary" style={{ width: "100%" }}>Sign in</button>
        </form>
      </div>
    </div>
  );
}
