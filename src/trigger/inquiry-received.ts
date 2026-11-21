import { task, logger } from "@trigger.dev/sdk";
import { createNote, isOptedOut, moveDealToStage, updateContact } from "../lib/hubspot";
import { phoneTag } from "../lib/guards";
import { slotLabel } from "../lib/slots";
import { triage } from "../lib/triage";
import { callCadence } from "./call-cadence";

export type InquiryPayload = {
  contactId: string;
  dealId: string;
  firstName: string;
  email: string;
  phone: string; // E.164
  inquiryType: string;
  message: string;
};

export const inquiryReceived = task({
  id: "inquiry-received",
  run: async (payload: InquiryPayload, { ctx }) => {
    logger.info("Inquiry received", {
      contactId: payload.contactId,
      dealId: payload.dealId,
      inquiryType: payload.inquiryType,
    });

    // 0. Do-not-call memory: someone who said "stop calling" on an earlier call is never phoned again.
    if (await isOptedOut(payload.phone, payload.contactId)) {
      logger.warn("Opted out earlier, no call", { contactId: payload.contactId });
      await createNote({
        contactId: payload.contactId,
        dealId: payload.dealId,
        body: "New enquiry from someone who asked us to stop phoning. No AI call made. Please contact by email only.",
      });
      return { decision: "human", source: "opted_out", cadence: "not started" };
    }

    // 1. Triage: rules first, model only when needed.
    const result = await triage({
      firstName: payload.firstName,
      inquiryType: payload.inquiryType,
      message: payload.message,
    });
    logger.info("Triage result", { ...result });

    // 2. Write the decision to HubSpot so the broker can see it.
    await updateContact(payload.contactId, {
      ai_run_id: ctx.run.id,
      ai_triage_decision: result.decision,
      ai_triage_reason: result.reason,
      ai_call_brief: result.callBrief,
    });

    // 3. Only call_now and call_later get a call. Everything else stays in "New inquiry" for a person.
    if (result.decision !== "call_now" && result.decision !== "call_later") {
      return { decision: result.decision, source: result.source, cadence: "not started" };
    }

    await moveDealToStage(payload.dealId, "HUBSPOT_STAGE_AI_CONTACTING");

    // call_later: tell the broker when the call will happen.
    if (result.decision === "call_later" && result.callAt) {
      await createNote({
        contactId: payload.contactId,
        dealId: payload.dealId,
        body: `Borrower asked for a later call. The AI will phone at ${slotLabel(new Date(result.callAt))} (Sydney time).`,
      });
    }

    // 4. Start the call cadence. It is dry-run (no real calls) unless CALL_DRY_RUN=false.
    const dryRun = process.env.CALL_DRY_RUN !== "false";
    const handle = await callCadence.trigger({
      contactId: payload.contactId,
      dealId: payload.dealId,
      firstName: payload.firstName,
      email: payload.email,
      phone: payload.phone,
      inquiryType: payload.inquiryType,
      inquiryPhrase: result.inquiryPhrase,
      callBrief: result.callBrief,
      callAt: result.callAt,
      dryRun,
    }, { tags: [phoneTag(payload.phone)] });

    return { decision: result.decision, source: result.source, cadenceRunId: handle.id, dryRun };
  },
});
