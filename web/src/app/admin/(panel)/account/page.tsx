import QRCode from "qrcode";
import { Flash, SectionCard } from "@/components/ui";
import { requireSession, readRecoveryFlash } from "@/lib/session";
import { unseal } from "@/lib/crypto";
import { otpauthUri } from "@/lib/totp";
import { config } from "@/lib/config";
import { cancelTotpSetup, changePassword, confirmTotpSetup, disableTotp, startTotpSetup } from "../../../actions/auth";

// Shared by /admin/account and /cpanel/account: password + two-factor authentication.
export default async function Account({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [s, sp] = await Promise.all([requireSession(), searchParams]);
  const a = s.account;
  const secret = !a.totpEnabled && a.totpSecret ? unseal(a.totpSecret) : null;
  const qr = secret ? await QRCode.toDataURL(otpauthUri(config.mailHostname, a.email, secret), { margin: 1, width: 200 }) : null;
  const codes = a.totpEnabled ? await readRecoveryFlash() : null;
  return (
    <>
      <h1>{s.role === "user" ? "Security" : "My account"}</h1>
      <p className="sub">{a.username} · {a.email}</p>
      <Flash {...sp} />
      {s.impersonating && <div className="flash err">Security settings can only be changed by the account owner.</div>}

      {codes && (
        <SectionCard title="Recovery codes - save them now">
          <p className="muted">Each code works once if you lose your phone. They will not be shown again.</p>
          <div className="codes">{codes.map((c) => <div key={c}>{c}</div>)}</div>
        </SectionCard>
      )}

      {!s.impersonating && (
        <>
          <SectionCard title="Change password" narrow>
            <form action={changePassword} className="login">
              <div><label>Current password</label><input name="current" type="password" required autoComplete="current-password" /></div>
              <div><label>New password (min 10)</label><input name="next" type="password" required minLength={10} autoComplete="new-password" /></div>
              <button className="primary">Change password</button>
            </form>
          </SectionCard>

          <SectionCard title="Two-factor authentication" narrow>
            {a.totpEnabled ? (
              <form action={disableTotp} className="login">
                <p>Enabled. {a.recoveryCodes.length} recovery code(s) left.</p>
                <div><label>Password</label><input name="password" type="password" required autoComplete="current-password" /></div>
                <div><label>Authenticator or recovery code</label><input name="code" required autoComplete="one-time-code" /></div>
                <button className="danger">Disable two-factor</button>
              </form>
            ) : secret && qr ? (
              <div className="login">
                <p>Scan with an authenticator app (Google Authenticator, Authy, 1Password…), then enter the 6-digit code.</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr} alt="TOTP QR code" width={200} height={200} style={{ background: "#fff", borderRadius: 8 }} />
                <p className="muted">Can&apos;t scan? Enter this key manually: <span className="mono">{secret}</span></p>
                <form action={confirmTotpSetup}>
                  <div><label>Code</label><input name="code" inputMode="numeric" autoComplete="one-time-code" required /></div>
                  <div className="actions" style={{ marginTop: 12 }}><button className="primary">Enable</button></div>
                </form>
                <form action={cancelTotpSetup} style={{ marginTop: 8 }}><button className="sm">Cancel</button></form>
              </div>
            ) : (
              <form action={startTotpSetup}>
                <p className="muted">Require a code from your phone at sign-in.</p>
                <button className="primary">Set up two-factor</button>
              </form>
            )}
          </SectionCard>
        </>
      )}
    </>
  );
}
