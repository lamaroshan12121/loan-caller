"use client";

import { useState } from "react";

const INQUIRY_TYPES = [
  "Buy my first home",
  "Buy my next home",
  "Refinance",
  "Investment property",
  "Other",
];

const field: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  fontSize: 16,
  border: "1px solid #c8ccd0",
  borderRadius: 8,
  boxSizing: "border-box",
};
const label: React.CSSProperties = { display: "block", fontWeight: 600, marginBottom: 6 };
const row: React.CSSProperties = { marginBottom: 18 };

export default function ApplyPage() {
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");
    setError("");

    const f = new FormData(e.currentTarget);
    const res = await fetch("/api/inquiry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: f.get("firstName"),
        lastName: f.get("lastName"),
        email: f.get("email"),
        phone: f.get("phone"),
        inquiryType: f.get("inquiryType"),
        message: f.get("message") || undefined,
        consent: f.get("consent") === "on",
      }),
    });

    if (res.ok) {
      setStatus("done");
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Something went wrong. Please try again.");
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <main style={{ maxWidth: 520, margin: "60px auto", padding: "0 20px", fontFamily: "system-ui, sans-serif" }}>
        <h1>Thanks, we have your enquiry</h1>
        <p>Our assistant will call you in the next few minutes to ask a few quick questions and set up a time with your broker.</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 520, margin: "40px auto", padding: "0 20px", fontFamily: "system-ui, sans-serif" }}>
      <h1>Home loan enquiry</h1>
      <p style={{ color: "#555", marginBottom: 28 }}>Tell us what you need and we will call you shortly.</p>

      <form onSubmit={onSubmit}>
        <div style={row}>
          <label style={label} htmlFor="firstName">First name</label>
          <input style={field} id="firstName" name="firstName" required />
        </div>
        <div style={row}>
          <label style={label} htmlFor="lastName">Last name</label>
          <input style={field} id="lastName" name="lastName" required />
        </div>
        <div style={row}>
          <label style={label} htmlFor="email">Email</label>
          <input style={field} id="email" name="email" type="email" required />
        </div>
        <div style={row}>
          <label style={label} htmlFor="phone">Mobile phone</label>
          <input style={field} id="phone" name="phone" type="tel" placeholder="0412 345 678" required />
        </div>
        <div style={row}>
          <label style={label} htmlFor="inquiryType">What do you need help with?</label>
          <select style={field} id="inquiryType" name="inquiryType" required defaultValue="">
            <option value="" disabled>Choose one</option>
            {INQUIRY_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div style={row}>
          <label style={label} htmlFor="message">Anything else we should know? (optional)</label>
          <textarea style={{ ...field, minHeight: 90 }} id="message" name="message" />
        </div>
        <div style={row}>
          <label>
            <input type="checkbox" name="consent" required /> I agree to be called by an AI assistant about my enquiry.
          </label>
        </div>

        {error && <p style={{ color: "#b00020" }}>{error}</p>}

        <button
          type="submit"
          disabled={status === "sending"}
          style={{ padding: "12px 22px", fontSize: 16, borderRadius: 8, border: 0, background: "#1a56db", color: "#fff", cursor: "pointer" }}
        >
          {status === "sending" ? "Sending..." : "Send enquiry"}
        </button>
      </form>
    </main>
  );
}
