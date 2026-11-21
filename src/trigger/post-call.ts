import { task, logger } from "@trigger.dev/sdk";
import { createMeeting, createNote, createTask, moveDealToStage, updateContact } from "../lib/hubspot";
import {
  STAGE_FOR_OUTCOME,
  TASK_FOR_OUTCOME,
  buildSummary,
  extractFields,
  normaliseOutcome,
} from "../lib/call-result";
import { nextBusinessDay10am, nextOpenSlot } from "../lib/business-hours";
import { SLOT_MINUTES, matchSlot, type Slot } from "../lib/slots";

export type PostCallPayload = {
  contactId: string;
  dealId: string;
  firstName: string;
  attempts: number;
  outcome: string; // booked, qualified_not_booked, ... or no_answer
  output?: Record<string, unknown>; // the extraction variables from Aircall
  slots?: Slot[]; // the two times offered on the call that produced this result
  callBrief: string;
};

export const postCall = task({
  id: "post-call",
  run: async (payload: PostCallPayload) => {
    const outcome = normaliseOutcome(payload.outcome);
    const fields = extractFields(payload.output);

    // For a booking, turn the free-text chosen_slot into one of the two times we offered.
    let slot: Slot | undefined;
    let slotNote = "";
    if (outcome === "booked") {
      slot = matchSlot(fields.chosen_slot, payload.slots ?? []);
      if (slot) fields.chosen_slot = slot.label;
      else slotNote = `The time the borrower chose ("${fields.chosen_slot ?? "not captured"}") did not match an offered slot. Please confirm a time with them.`;
    }
    const summary = buildSummary(outcome, fields, payload.attempts) + (slotNote ? `\n${slotNote}` : "");

    logger.info("Post-call", { outcome, fields, rawOutcome: payload.outcome });

    // 1. Contact properties. Only values we actually captured, so nothing gets overwritten with blanks.
    // chosen_slot has no HubSpot property: it goes into the summary, note and task instead.
    const { chosen_slot: _slot, ...contactFields } = fields;
    await updateContact(payload.contactId, {
      ai_call_outcome: outcome,
      ai_call_summary: summary,
      ai_attempt_count: payload.attempts,
      ...contactFields,
    });

    // 2. A real 30-minute meeting when the chosen time is clear.
    let meetingCreated = false;
    if (slot) {
      await createMeeting({
        contactId: payload.contactId,
        dealId: payload.dealId,
        title: `Home loan call with ${payload.firstName}`,
        body: `Booked by the AI caller.\n\nCall brief: ${payload.callBrief}`,
        startsAt: new Date(slot.startIso),
        minutes: SLOT_MINUTES,
      });
      meetingCreated = true;
    }

    // 3. Move the deal, if this outcome moves it. "Meeting booked" only when a meeting really exists:
    // a booked call whose time we could not match stays in Qualified until a person confirms the time.
    const bookedWithoutMeeting = outcome === "booked" && !meetingCreated;
    const stageEnv = bookedWithoutMeeting ? "HUBSPOT_STAGE_QUALIFIED" : STAGE_FOR_OUTCOME[outcome];
    if (stageEnv) await moveDealToStage(payload.dealId, stageEnv);

    // 4. A note with the summary and the brief the AI worked from.
    await createNote({
      contactId: payload.contactId,
      dealId: payload.dealId,
      body: `AI call result\n\n${summary}${typeof payload.output?.call_summary === "string" ? `\n\nWhat was said: ${payload.output.call_summary}` : ""}\n\nCall brief: ${payload.callBrief}`,
    });

    // 5. A task for the broker, if this outcome needs one.
    const plan = bookedWithoutMeeting
      ? {
          subject: (n: string, f: { chosen_slot?: string }) =>
            `Book a meeting with ${n}: time not confirmed${f.chosen_slot ? ` (they said "${f.chosen_slot}")` : ""}`,
          priority: "HIGH" as const,
          due: "now" as const,
        }
      : TASK_FOR_OUTCOME[outcome];
    let taskCreated = false;
    if (plan) {
      const dueAt = plan.due === "now" ? nextOpenSlot(new Date()) : nextBusinessDay10am(new Date());
      await createTask({
        contactId: payload.contactId,
        dealId: payload.dealId,
        subject: plan.subject(payload.firstName, fields),
        body: `${summary}\n\nCall brief: ${payload.callBrief}`,
        dueAt,
        priority: plan.priority,
      });
      taskCreated = true;
    }

    return { outcome, movedStage: Boolean(stageEnv), taskCreated, meetingCreated, fields };
  },
});
