import { login } from "../actions";
import { Flash } from "@/components/ui";

export default async function AdminLogin({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="center">
      <div className="card login">
        <h1>Admin sign in</h1>
        <p className="sub">Mail platform control panel</p>
        <Flash error={error} />
        <form action={login}>
          <div><label>Email</label><input name="email" type="email" required autoFocus autoComplete="username" /></div>
          <div><label>Password</label><input name="password" type="password" required autoComplete="current-password" /></div>
          <button className="primary" style={{ width: "100%" }}>Sign in</button>
        </form>
      </div>
    </div>
  );
}
