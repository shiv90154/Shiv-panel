import { Flash, SectionCard } from "@/components/ui";
import { ConfirmButton } from "@/components/client";
import { requireRole } from "@/lib/session";
import { agentConfigured } from "@/server/agent";
import { checkForUpdate, getUpdateStatus } from "@/server/security";
import { applyUpdateAction } from "../../security-actions";

export const dynamic = "force-dynamic";

async function safe<T>(fn: () => Promise<T>): Promise<{ data: T | null; error: string | null }> {
  try { return { data: await fn(), error: null }; } catch (e) { return { data: null, error: e instanceof Error ? e.message : "Agent error" }; }
}

export default async function Updates({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requireRole("admin");
  const sp = await searchParams;
  const configured = agentConfigured();
  const check = configured ? await safe(checkForUpdate) : null;
  const status = configured ? await safe(getUpdateStatus) : null;
  const running = status?.data?.state === "running";
  const canApply = !!check?.data && check.data.behind > 0 && !check.data.dirty && check.data.ahead === 0 && !check.data.busy && !running;

  return (
    <>
      <h1>Self-update</h1>
      <p className="sub">Fast-forwards the git checkout this stack runs from (<span className="mono">UPDATE_DIR</span>), rebuilds the compose stack and restarts the agent. Refuses if the checkout has local changes, has commits not on the remote, or is on the wrong branch.</p>
      <Flash {...sp} />
      {!configured && <p className="flash bad">The host agent is not configured (AGENT_URL / AGENT_SECRET).</p>}
      {check?.error && <p className="flash bad">{check.error}</p>}
      {running && <p className="flash">Update running: {status?.data?.step}</p>}
      {status?.data?.state === "failed" && <p className="flash bad">Last update failed at {status.data.step}: {status.data.error}</p>}
      {status?.data?.state === "ok" && <p className="flash ok">Last update finished {status.data.finishedAt}.</p>}

      {check?.data && (
        <SectionCard title={`Branch ${check.data.branch}`}>
          <table><tbody>
            <tr><td className="muted">Current</td><td className="mono">{check.data.current.slice(0, 12)}</td></tr>
            <tr><td className="muted">Latest on remote</td><td className="mono">{check.data.latest.slice(0, 12)}</td></tr>
            <tr><td className="muted">Status</td><td>
              {check.data.dirty ? "Local changes present - refusing to update" :
                check.data.ahead > 0 ? `${check.data.ahead} local commit(s) not on the remote - refusing to update` :
                  check.data.currentBranch !== check.data.branch ? `On branch ${check.data.currentBranch}, not ${check.data.branch}` :
                    check.data.behind === 0 ? "Up to date" : `${check.data.behind} commit(s) behind`}
            </td></tr>
          </tbody></table>
          {check.data.behind > 0 && !!check.data.commits.length && (
            <table style={{ marginTop: 12 }}><tbody>
              {check.data.commits.map((c) => <tr key={c.sha}><td className="mono">{c.sha.slice(0, 10)}</td><td>{c.subject}</td></tr>)}
            </tbody></table>
          )}
          {canApply && (
            <form action={applyUpdateAction} style={{ marginTop: 12 }}>
              <input type="hidden" name="expect" value={check.data.latest} />
              <ConfirmButton className="danger" message={`Update to ${check.data.latest.slice(0, 12)}? This rebuilds and restarts every container.`}>Apply update</ConfirmButton>
            </form>
          )}
        </SectionCard>
      )}

      {!!status?.data?.log && (
        <SectionCard title="Update log (tail)">
          <pre className="mono" style={{ maxHeight: 360, overflow: "auto", whiteSpace: "pre-wrap" }}>{status.data.log}</pre>
        </SectionCard>
      )}
    </>
  );
}
