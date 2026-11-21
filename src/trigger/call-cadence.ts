import { task, wait, logger } from "@trigger.dev/sdk";
import { startAircallCall } from "../lib/aircall";
import { createNote, updateContact } from "../lib/hubspot";
import { buildMissedCallEmail, sendMissedCallEmail } from "../lib/notify";
import { nextBusinessDay10am, nextOpenSlot } from "../lib/business-hours";
import { proposeSlots, slotLabel, type Slot } from "../lib/slots";
import { postCall } from "./post-call";

export type CadencePayload = {
  contactId: string;
  dealId: string;
  firstName: string;
  email?: string; // optional so runs started before this field existed still work
  phone: string; // E.164
  inquiryType: string;
  inquiryPhrase: string;
  callBrief: string;
  callAt?: string; // ISO time: the borrower asked for a later call, so attempt 1 waits until then
  // Dry run: no real Aircall calls, no business-hours waits, short gaps.
  // You complete each attempt yourself by posting JSON to the token URL printed in the logs.
  dryRun: boolean;
};

type CallResult = { call_outcome?: string; [key: string]: unknown };

// Outcomes that mean a person picked up and the call finished. Anything else counts as not answered.
const ANSWERED = ["booked", "qualified_not_booked", "not_qualified", "callback_requested", "opted_out", "escalated"];

type AttemptResult =
  | { answered: true; outcome: string; output: CallResult; slots: Slot[] }
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

      // Offer two real times, worked out fresh for every attempt so they are never in the past.
      const slots = proposeSlots(new Date());
      logger.info(`Attempt ${n}: slots offered`, { slot_1: slots[0].label, slot_2: slots[1].label });

      if (payload.dryRun) {
        logger.info(`Attempt ${n}: DRY RUN, no call placed. Post the result JSON to the token URL.`);
      } else {
        await startAircallCall({
          phone: payload.phone,
          firstName: payload.firstName,
          inquiryPhrase: payload.inquiryPhrase,
          slot1: slots[0].label,
          slot2: slots[1].label,
          idempotencyKey: `${payload.contactId}-attempt-${n}`,
        });
      }

      const result = await wait.forToken<CallResult>(token);
      if (!result.ok) return { answered: false, reason: "timeout" };

      const outcome = String(result.output.call_outcome ?? "no_answer");
      if (ANSWERED.includes(outcome)) return { answered: true, outcome, output: result.output, slots };
      return { answered: false, reason: outcome };
    }

    /** Wait until it is OK to call (Sydney business hours), or a short pause in dry-run mode. */
    async function waitUntil(date: Date) {
      if (payload.dryRun) await wait.for({ seconds: 20 });
      else await wait.until({ date });
    }

    /** Hand the final result to the post-call task, which writes everything to HubSpot. */
    async function finish(attempts: number, outcome: string, output?: Record<string, unknown>, slots?: Slot[]) {
      const res = await postCall.triggerAndWait({
        contactId: payload.contactId,
        dealId: payload.dealId,
        firstName: payload.firstName,
        attempts,
        outcome,
        output,
        slots,
        callBrief: payload.callBrief,
      });
      if (!res.ok) throw new Error(`post-call failed: ${String(res.error)}`);
      return res.output;
    }

    /** Email the borrower "sorry we missed you". Logs the result and a HubSpot note. Never stops the cadence. */
    async function sendMissedCallMessage(nextAttempt: string) {
      if (!payload.email) {
        logger.warn("No email on this run, skipping the missed-call message");
        return;
      }
      try {
        const input = { to: payload.email, firstName: payload.firstName, inquiryPhrase: payload.inquiryPhrase, nextAttempt };
        const result = await sendMissedCallEmail(input);
        const preview = buildMissedCallEmail(input);
        logger.info(result.sent ? "Missed-call email sent" : "Missed-call email NOT sent", { ...result, subject: preview.subject, body: preview.text });
        await createNote({
          contactId: payload.contactId,
          dealId: payload.dealId,
          body: result.sent
            ? `Missed-call email sent to the borrower after 2 unanswered calls. Next call: ${nextAttempt}.`
            : `Missed-call email NOT sent (${result.reason}). It would have said the next call is ${nextAttempt}.`,
        });
      } catch (err) {
        logger.error("Missed-call message step failed, carrying on", { error: String(err) });
      }
    }

    // Attempt 1: straight away, at the next opening, or at the time the borrower asked for.
    const first = nextOpenSlot(payload.callAt ? new Date(payload.callAt) : new Date());
    if (payload.callAt) logger.info("Call later: first attempt waits for the borrower's time", { callAt: first.toISOString(), label: slotLabel(first) });
    await waitUntil(first);
    const a1 = await attempt(1);
    if (a1.answered) return { status: "answered" as const, attempts: 1, post: await finish(1, a1.outcome, a1.output, a1.slots) };

    // Attempt 2: two hours later (inside business hours).
    await waitUntil(nextOpenSlot(new Date(Date.now() + 2 * 60 * 60 * 1000)));
    const a2 = await attempt(2);
    if (a2.answered) return { status: "answered" as const, attempts: 2, post: await finish(2, a2.outcome, a2.output, a2.slots) };

    // Attempt 3 is next business day at 10am. Tell the borrower when, between attempts 2 and 3.
    const third = nextBusinessDay10am(new Date());
    await sendMissedCallMessage(slotLabel(third));

    await waitUntil(third);
    const a3 = await attempt(3);
    if (a3.answered) return { status: "answered" as const, attempts: 3, post: await finish(3, a3.outcome, a3.output, a3.slots) };

    // Nobody picked up. post-call marks the lead unreachable and creates the broker's follow-up task.
    logger.info("Unreachable after 3 attempts", { contactId: payload.contactId });
    return { status: "unreachable" as const, attempts: 3, post: await finish(3, "no_answer") };
  },
});
