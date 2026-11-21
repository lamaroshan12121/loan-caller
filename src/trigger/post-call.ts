import { task, logger } from "@trigger.dev/sdk";
import { createNote, createTask, moveDealToStage, updateContact } from "../lib/hubspot";
import {
  STAGE_FOR_OUTCOME,
  TASK_FOR_OUTCOME,
  buildSummary,
  extractFields,
  normaliseOutcome,
} from "../lib/call-result";
import { nextBusinessDay10am, nextOpenSlot } from "../lib/business-hours";

export type PostCallPayload = {
  contactId: string;
  dealId: string;
  firstName: string;
  attempts: number;
  outcome: string; // booked, qualified_not_booked, ... or no_answer
  output?: Record<string, unknown>; // the extraction variables from Aircall
  callBrief: string;
};

export const postCall = task({
  id: "post-call",
  run: async (payload: PostCallPayload) => {
    const outcome = normaliseOutcome(payload.outcome);
    const fields = extractFields(payload.output);
    const summary = buildSummary(outcome, fields, payload.attempts);

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

    // 2. Move the deal, if this outcome moves it.
    const stageEnv = STAGE_FOR_OUTCOME[outcome];
    if (stageEnv) await moveDealToStage(payload.dealId, stageEnv);

    // 3. A note with the summary and the brief the AI worked from.
    await createNote({
      contactId: payload.contactId,
      dealId: payload.dealId,
      body: `AI call result\n\n${summary}\n\nCall brief: ${payload.callBrief}`,
    });

    // 4. A task for the broker, if this outcome needs one.
    const plan = TASK_FOR_OUTCOME[outcome];
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

    // Not done yet: a real HubSpot meeting. chosen_slot is free text from the call, so we
    // record it in the note and task for now and turn it into a meeting once the slot format is fixed.

    return { outcome, movedStage: Boolean(stageEnv), taskCreated, fields };
  },
});
