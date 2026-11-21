import { appendFileSync } from "node:fs";
import { wait } from "@trigger.dev/sdk";
import { parseAircallWebhook } from "@/lib/aircall-webhook";
import { interpretSummary } from "@/lib/call-summary";

// Aircall calls this when an AI voice call ends. We find the call-cadence run that is waiting
// for that phone number and complete its waitpoint with the call result.
//
// Setup: add AIRCALL_WEBHOOK_SECRET to .env.local, then give Aircall this URL:
//   https://<public-address>/api/aircall-webhook?secret=<AIRCALL_WEBHOOK_SECRET>
//
// Always answer fast with 200 once the request is authenticated, so Aircall does not retry.
// A webhook that matches nothing is logged and ignored. If a result never arrives, the waitpoint
// times out and the cadence counts the attempt as no answer.

export async function POST(req: Request) {
  const expected = process.env.AIRCALL_WEBHOOK_SECRET;
  if (!expected) {
    console.error("AIRCALL_WEBHOOK_SECRET is not set, refusing webhook");
    return Response.json({ error: "Webhook not configured" }, { status: 500 });
  }
  const secret = new URL(req.url).searchParams.get("secret");
  if (secret !== expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const raw = await req.text();

  // Debug capture: with AIRCALL_CAPTURE=true every authenticated webhook body is appended to
  // aircall-payloads.log in the project folder, so the real Aircall payload shape can be inspected.
  // Contains caller details. Dev only: turn it off and delete the file when finished.
  if (process.env.AIRCALL_CAPTURE === "true") {
    try {
      appendFileSync("aircall-payloads.log", JSON.stringify({ at: new Date().toISOString(), raw }) + "\n");
    } catch (err) {
      console.warn("aircall-webhook: could not write capture file", err);
    }
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    console.warn("aircall-webhook: body is not JSON", raw.slice(0, 200));
    return Response.json({ received: true, matched: false, reason: "not json" });
  }

  const parsed = parseAircallWebhook(body);
  console.log("aircall-webhook: received", { phones: parsed.phones, variables: Object.keys(parsed.output) });

  // Real Aircall AI voice agent webhooks carry no extraction variables. The result of the call arrives as
  // Aircall's plain-English summary ("summary.created"), so we read the outcome and details from that.
  // If it cannot be read, the call is escalated to a person instead of being dropped or re-dialled.
  const b = body as { event?: unknown; data?: { content?: unknown } };
  if (!parsed.hasOutcome && b.event === "summary.created" && typeof b.data?.content === "string") {
    try {
      parsed.output = await interpretSummary(b.data.content);
    } catch (err) {
      console.error("aircall-webhook: could not read the call summary, escalating", err);
      parsed.output = { call_outcome: "escalated", call_summary: b.data.content.slice(0, 1500) };
    }
    parsed.hasOutcome = true;
    console.log("aircall-webhook: summary read", { outcome: parsed.output.call_outcome, fields: Object.keys(parsed.output) });
  }

  // No outcome yet (a ringing, started or transcript event): nothing to complete.
  if (!parsed.hasOutcome) {
    return Response.json({ received: true, matched: false, reason: "no call_outcome in payload" });
  }

  // Find the waiting run by phone tag. The agent's own number is also in the payload, but it has no waiting token.
  for (const phone of parsed.phones) {
    const waiting = [];
    for await (const token of wait.listTokens({ tags: [`phone_${phone}`], status: "WAITING" })) {
      waiting.push(token);
    }
    if (waiting.length === 0) continue;
    if (waiting.length > 1) console.warn(`aircall-webhook: ${waiting.length} waiting tokens for ${phone}, using the newest`);

    // Newest first, so a stale token from an earlier run is never the one we complete.
    waiting.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    const token = waiting[0];
    await wait.completeToken(token.id, parsed.output);
    console.log("aircall-webhook: completed token", token.id, "outcome", parsed.output.call_outcome);
    return Response.json({ received: true, matched: true, tokenId: token.id });
  }

  console.warn("aircall-webhook: no waiting token for", parsed.phones);
  return Response.json({ received: true, matched: false, reason: "no waiting run for these numbers" });
}
