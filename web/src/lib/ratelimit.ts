// Small in-memory limiter for login endpoints (single web instance).
const hits = new Map<string, number[]>();

export function tooManyAttempts(key: string, max = 8, windowMs = 15 * 60_000): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  hits.set(key, recent);
  return recent.length >= max;
}
export function recordAttempt(key: string) {
  hits.set(key, [...(hits.get(key) ?? []), Date.now()]);
}
export function clearAttempts(key: string) {
  hits.delete(key);
}
