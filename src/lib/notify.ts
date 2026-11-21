// The "sorry we missed you" email, sent between call attempts 2 and 3.
// Sent through Resend (https://resend.com). It only goes out when MESSAGES_LIVE=true, so a dry run
// never emails anyone by accident. Otherwise it is logged and the cadence carries on.
//
// Env: RESEND_API_KEY, MESSAGE_FROM (e.g. "Harbour Home Loans <onboarding@resend.dev>"),
//      MESSAGE_REPLY_TO (optional), BROKERAGE_NAME (optional, default "Harbour Home Loans").
// Note: Resend's test sender (onboarding@resend.dev) can only email the address you signed up with.

export type MissedCallInput = {
  to: string;
  firstName: string;
  inquiryPhrase: string; // "buying your next home"
  nextAttempt: string; // "Tuesday 24 November at 10 am"
};

export type Email = { subject: string; text: string };

export function brokerageName(): string {
  return process.env.BROKERAGE_NAME ?? "Harbour Home Loans";
}

export function buildMissedCallEmail(i: MissedCallInput): Email {
  const name = brokerageName();
  return {
    subject: "We tried to call you about your home loan enquiry",
    text: [
      `Hi ${i.firstName},`,
      "",
      `Thanks for your enquiry about ${i.inquiryPhrase}. Our assistant tried to call you but could not get through.`,
      "",
      `We will try again on ${i.nextAttempt}. The call takes about 3 minutes and ends with a time to speak to one of our brokers.`,
      "",
      "If another time suits you better, or you would rather we did not call, just reply to this email and a person will sort it out.",
      "",
      `${name}`,
    ].join("\n"),
  };
}

export type SendResult = { sent: boolean; reason?: string; id?: string };

/** Sends the email, or says why it did not. Never throws: a failed courtesy email must not stop the cadence. */
export async function sendMissedCallEmail(i: MissedCallInput): Promise<SendResult> {
  const email = buildMissedCallEmail(i);

  if (process.env.MESSAGES_LIVE !== "true") {
    return { sent: false, reason: "MESSAGES_LIVE is not true, email not sent" };
  }
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MESSAGE_FROM;
  if (!key || !from) return { sent: false, reason: "RESEND_API_KEY or MESSAGE_FROM is missing" };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [i.to],
        subject: email.subject,
        text: email.text,
        ...(process.env.MESSAGE_REPLY_TO ? { reply_to: process.env.MESSAGE_REPLY_TO } : {}),
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return { sent: false, reason: `Resend ${res.status}: ${body.message ?? "unknown error"}` };
    return { sent: true, id: body.id };
  } catch (err) {
    return { sent: false, reason: `Resend request failed: ${String(err)}` };
  }
}
