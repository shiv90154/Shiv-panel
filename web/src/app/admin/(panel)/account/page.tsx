import { Flash } from "@/components/ui";
import { changeAdminPassword } from "../../actions";

export default async function Account({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  return (
    <>
      <h1>Account</h1>
      <p className="sub">Change your admin password.</p>
      <Flash {...sp} />
      <div className="card" style={{ maxWidth: 420 }}>
        <form action={changeAdminPassword} className="login">
          <div><label>Current password</label><input name="current" type="password" required autoComplete="current-password" /></div>
          <div><label>New password (min 10)</label><input name="next" type="password" required minLength={10} autoComplete="new-password" /></div>
          <button className="primary">Change password</button>
        </form>
      </div>
    </>
  );
}
