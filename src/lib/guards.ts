// Small protections for the public form: rate limit and "is this number already being handled?".

import { runs } from "@trigger.dev/sdk";

/** Phone number as digits only. Used in run tags so one number can be found again. */
export function phoneTag(e164: string): string {
  return `phone_${e164.replace(/\D/g, "")}`;
}

// ---- Rate limit (in memory) ----------------------------------------------------------------
// Fine for one server. On serverless hosting each instance has its own memory, so for real traffic
// swap this for a shared store (Upstash Redis, for example). The function signature can stay the same.

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, number[]>();

export function rateLimited(key: string, now: number = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  // Keep the map from growing forever.
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
  }
  return false;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown").trim();
}

// ---- Duplicate-call guard ------------------------------------------------------------------
const ACTIVE = ["QUEUED", "DELAYED", "EXECUTING", "WAITING", "DEQUEUED", "PENDING_VERSION"] as const;

/** True if a run for this phone number (inquiry or call cadence) is still going. */
export async function hasActiveRun(e164: string): Promise<boolean> {
  const page = await runs.list({ tag: phoneTag(e164), status: [...ACTIVE], limit: 1 });
  return page.data.length > 0;
}
