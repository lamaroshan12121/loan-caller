# AI Loan Inquiry Caller: handoff notes (updated 21 Nov 2026, after the first real call)

Paste or attach this at the start of the next chat so we can continue where we left off.

## What this is
Roshan's portfolio project for Warren at BAC. A home-loan inquiry form triggers an AI voice agent (Aircall) that qualifies the lead and books a 30-minute broker meeting. Outcomes are written to HubSpot.
Stack: trigger.dev v4 (cloud), OpenRouter (default `openai/gpt-4o-mini`), HubSpot, Aircall, Next.js, Resend.
Project folder: `C:\Learning\loan-caller` (Windows PowerShell, Roshan runs terminal steps himself).

Two PRDs for Warren are Claude Docs, both up to date as of 21 Nov (including the real Aircall call):
- Technical PRD: https://claude.ai/artifact/VK8iLUoPMYvdripqvcHS2s
- AI Agent PRD: https://claude.ai/artifact/Wy99WnyLREoJNFBRexrQKc

## Built and tested
Everything below works. The full chain was proven with one REAL Aircall call to Roshan's own phone: form -> HubSpot -> triage -> Aircall call -> result -> HubSpot meeting, deal stage, note and task.
- Form `/apply` -> `/api/inquiry` -> HubSpot contact + deal -> trigger.dev `inquiry-received`
- Triage: rules first, model second, falls back to human. 21 of 21 test cases pass (`npx tsx scripts/triage-eval.ts`; rerun after any prompt/rule/model change, model answers vary)
- Call cadence: attempt 1 now, attempt 2 after 2 hours, attempt 3 at 10 am next business day, then Unreachable. Business hours Sydney, no Sundays or NSW holidays
- Two real meeting slots per attempt, matched to what the borrower chooses, HubSpot meeting created (30 min)
- Post-call: updates contact, moves deal stage, writes note (now includes what was said), creates broker task
- Missed-call email via Resend: real send worked with the test sender
- Form protection (honeypot + rate limit), duplicate-call guard, do-not-call memory, call-later

## What the real Aircall call taught us
- Auth: the trigger endpoint answers 403 to a Bearer header. It needs Basic auth: `AIRCALL_API_ID` + `AIRCALL_API_TOKEN` (key made under Integrations > API keys; the token is shown only once). `src/lib/aircall.ts` uses Basic when `AIRCALL_API_ID` is set
- Aircall refuses a call unless every `{{variable}}` in the agent's first message is in `context` (Ruby: `first_name`, `inquiry_phrase`)
- Aircall webhooks do NOT carry our structured fields (`call_outcome`, `chosen_slot`). `ai_voice_agent.summary` never fired for an outbound call
- Fix (new file `src/lib/call-summary.ts` + `src/app/api/aircall-webhook/route.ts` + `src/trigger/post-call.ts`): the route reads Aircall's `summary.created` text with the same OpenRouter model and fills the usual fields. If it cannot be read, the call is `escalated` to a person (never re-dialled)
- In `ai_voice_agent` events `external_caller_number` is the Aircall number and `aircall_number` is the borrower's. The route does not rely on field names
- Webhook registered in the Aircall dashboard as "Loan caller" with all events on. Its URL contains the quick-tunnel address, which CHANGES whenever `cloudflared` restarts: re-edit the webhook URL then

## Settings
- `CALL_DRY_RUN`: currently off in `.env.local` (real calls go out). Set to `true` (or remove the line) for demos that should not dial
- `IGNORE_BUSINESS_HOURS=true`: TEST ONLY, lets calls go out any time. Remove it after testing
- `AIRCALL_CAPTURE=true`: logs every webhook to `aircall-payloads.log` (contains call details). Turn off and delete the file when finished
- `MESSAGES_LIVE` off. Emails are only logged and noted in HubSpot
- `MESSAGE_FROM=Harbour Home Loans <onboarding@resend.dev>` (Resend test sender, only delivers to Roshan's own signup address). Real sender domain deliberately skipped
- Aircall trial: about 100 minutes and 7 days from the start of the trial

## Still to do
1. Cleanup: remove `IGNORE_BUSINESS_HOURS` and `AIRCALL_CAPTURE`, delete `aircall-payloads.log`, delete the old "Customer Inquiry API" key in Aircall, delete test contacts/deals in HubSpot (`later.test1`, `optout.test2` and today's tests)
2. Optional more real-call tests: no answer, "call me back", "not interested" (opt-out), voicemail
3. trigger.dev reply about production deploys (Free plan says "Deployments are not available for this organization"). Demo runs in dev mode: `npx trigger.dev@latest dev`
4. Demo script, once the project is fully complete

Dropped: README (decided not doing it at all), Resend sender domain.

## Useful commands (PowerShell, in `C:\Learning\loan-caller`)
- `npm run dev` (Next.js app)
- `npx trigger.dev@latest dev` (trigger.dev dev worker; needed for runs)
- `cloudflared tunnel --url http://localhost:3000` (public tunnel for Aircall webhooks; keep it running; restarting changes the URL)
- `npx tsx scripts/triage-eval.ts` (triage tests; `--rules` skips the model)
- `node scripts/simulate-aircall-webhook.mjs --phone 0412345680 --outcome booked --slot "Monday 23 November at 10 am"`
- `npx tsx scripts/send-test-email.ts you@example.com` (use the Resend signup address)

## How Roshan likes to work
- Step by step, full files not snippets
- Whenever files are given, say exactly where each goes (full folder path, new or replaces existing)
