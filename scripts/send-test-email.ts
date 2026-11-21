// Sends ONE real "sorry we missed you" email through Resend, to check the setup works.
//
//   npx tsx scripts/send-test-email.ts you@example.com
//
// It needs RESEND_API_KEY and MESSAGE_FROM in .env.local. It switches MESSAGES_LIVE on for this run only,
// so the rest of the project stays in "log only" mode.
// With Resend's test sender (onboarding@resend.dev) the address must be the one you signed up to Resend with.

import { readFileSync } from "node:fs";
import { sendMissedCallEmail, buildMissedCallEmail } from "../src/lib/notify";

try {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {
  console.error("Could not read .env.local. Run this from the project folder (C:\\Learning\\loan-caller).");
  process.exit(1);
}

async function main() {
  const to = process.argv[2];
  if (!to || !to.includes("@")) {
    console.error("Usage: npx tsx scripts/send-test-email.ts you@example.com");
    process.exit(1);
  }

  process.env.MESSAGES_LIVE = "true";
  const input = { to, firstName: "Sam", inquiryPhrase: "buying your next home", nextAttempt: "Tuesday 24 November at 10 am" };
  const preview = buildMissedCallEmail(input);
  console.log(`From:    ${process.env.MESSAGE_FROM ?? "(MESSAGE_FROM missing)"}`);
  console.log(`To:      ${to}`);
  console.log(`Subject: ${preview.subject}\n`);

  const result = await sendMissedCallEmail(input);
  if (result.sent) {
    console.log(`SENT. Resend id: ${result.id}. Check the inbox (and the spam folder).`);
  } else {
    console.log(`NOT SENT: ${result.reason}`);
    process.exit(1);
  }
}

main();
