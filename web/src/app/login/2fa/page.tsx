import { redirect } from "next/navigation";
import Link from "next/link";
import { verifySecondFactor } from "../../actions/auth";
import { Flash } from "@/components/ui";
import { readPendingLogin } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SecondFactor({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!(await readPendingLogin())) redirect("/login");
  const { error } = await searchParams;
  return (
    <div className="center">
      <div className="card login">
        <h1>Two-factor authentication</h1>
        <p className="sub">Enter the 6-digit code from your authenticator app, or one of your recovery codes.</p>
        <Flash error={error} />
        <form action={verifySecondFactor}>
          <div><label>Code</label><input name="code" required autoFocus autoComplete="one-time-code" inputMode="text" /></div>
          <button className="primary" style={{ width: "100%" }}>Verify</button>
        </form>
        <p className="muted" style={{ marginTop: 12 }}><Link href="/login">← Back to sign in</Link></p>
      </div>
    </div>
  );
}
