import "server-only";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";

export const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

function message(e: unknown) {
  if (e instanceof ZodError) return e.issues[0]?.message ?? "Invalid input";
  if (e instanceof Error) return e.message;
  return "Unexpected error";
}

/** Runs a form action, then redirects back with ?ok= / ?error= so the page can show a flash message. */
export async function run(path: string, fn: () => Promise<string | void>): Promise<never> {
  let ok: string | undefined, error: string | undefined;
  try { ok = (await fn()) || "Done"; } catch (e) { error = message(e); console.error("[action]", e); }
  revalidatePath("/admin", "layout");
  revalidatePath("/cpanel", "layout");
  const qs = new URLSearchParams(error ? { error } : { ok: ok! });
  redirect(`${path}${path.includes("?") ? "&" : "?"}${qs}`);
}
