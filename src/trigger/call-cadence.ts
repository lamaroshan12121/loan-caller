import { task, wait, logger } from "@trigger.dev/sdk";
import { startAircallCall } from "../lib/aircall";
import { updateContact } from "../lib/hubspot";
import { nextBusinessDay10am, nextOpenSlot } from "../lib/business-hours";
import { postCall } from "./post-call";

export type CadencePayload = {
  contactId: string;
  dealId: string;
  firstName: string;
  phone: string; // E.164
  inquiryType: string;
  inquiryPhrase: string;
  callBrief: string;
  // Dry run: no real Aircall calls, no business-hours waits, short gaps.
  // You complete each attempt yourself by posting JSON to the token URL printed in the logs.
  dryRun: boolean;
};

type CallResult = { call_outcome?: string; [key: string]: unknown };

// Outcomes that mean a person picked up and the call finished. Anything else counts as not answered.
const ANSWERED = ["booked", "qualified_not_booked", "not_qualified", "callback_requested", "opted_out", "escalated"];

type AttemptResult =
  | { answered: true; outcome: string; output: CallResult }
  | { answered: false; reason: string };

export const callCadence = task({
  id: "call-cadence",
  maxDuration: 600, // compute seconds. Time spent waiting does not count.
  run: async (payload: CadencePayload) => {
    const digits = payload.phone.replace(/\D/g, "");

    /** Place one call and wait for its result (or give up after the timeout). */
    async function attempt(n: number): Promise<AttemptResult> {
      const token = await wait.createToken({
        timeout: payload.dryRun ? "5m" : "20m",
        tags: [`phone_${digits}`, `contact_${payload.contactId}`],
      });
      logger.info(`Attempt ${n}: waiting for call result`, { tokenUrl: token.url, tokenId: token.id });

      await updateContact(payload.contactId, { ai_attempt_count: n });

      if (payload.dryRun) {
        logger.info(`Attempt ${n}: DRY RUN, no call placed. Post the result JSON to the token URL.`);
      } else {
        await startAircallCall({
          phone: payload.phone,
          firstName: payload.firstName,
          inquiryPhrase: payload.inquiryPhrase,
          idempotencyKey: `${payload.contactId}-attempt-${n}`,
        });
      }

      const result = await wait.forToken<CallResult>(token);
      if (!result.ok) return { answered: false, reason: "timeout" };

      const outcome = String(result.output.call_outcome ?? "no_answer");
      if (ANSWERED.includes(outcome)) return { answered: true, outcome, output: result.output };
      return { answered: false, reason: outcome };
    }

    /** Wait until it is OK to call (Sydney business hours), or a short pause in dry-run mode. */
    async function waitUntil(date: Date) {
      if (payload.dryRun) await wait.for({ seconds: 20 });
      else await wait.until({ date });
    }

    /** Hand the final result to the post-call task, which writes everything to HubSpot. */
    async function finish(attempts: number, outcome: string, output?: Record<string, unknown>) {
      const res = await postCall.triggerAndWait({
        contactId: payload.contactId,
        dealId: payload.dealId,
        firstName: payload.firstName,
        attempts,
        outcome,
        output,
        callBrief: payload.callBrief,
      });
      if (!res.ok) throw new Error(`post-call failed: ${String(res.error)}`);
      return res.output;
    }

    // Attempt 1: straight away, or at the next opening.
    await waitUntil(nextOpenSlot(new Date()));
    const a1 = await attempt(1);
    if (a1.answered) return { status: "answered" as const, attempts: 1, post: await finish(1, a1.outcome, a1.output) };

    // Attempt 2: two hours later (inside business hours).
    await waitUntil(nextOpenSlot(new Date(Date.now() + 2 * 60 * 60 * 1000)));
    const a2 = await attempt(2);
    if (a2.answered) return { status: "answered" as const, attempts: 2, post: await finish(2, a2.outcome, a2.output) };

    // Between attempts 2 and 3: a message to the borrower.
    // TODO (later): send the SMS or email here. For now we only log it.
    logger.info("Would send the 'sorry we missed you' message now", { phone: payload.phone });

    // Attempt 3: next business day at 10am.
    await waitUntil(nextBusinessDay10am(new Date()));
    const a3 = await attempt(3);
    if (a3.answered) return { status: "answered" as const, attempts: 3, post: await finish(3, a3.outcome, a3.output) };

    // Nobody picked up. post-call marks the lead unreachable and creates the broker's follow-up task.
    logger.info("Unreachable after 3 attempts", { contactId: payload.contactId });
    return { status: "unreachable" as const, attempts: 3, post: await finish(3, "no_answer") };
  },
});
