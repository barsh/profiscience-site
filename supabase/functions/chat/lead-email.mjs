/* =========================================================
   Sales-notification text for a chat lead.
   ---------------------------------------------------------
   Pipedrive's "Lead added" email can insert lead fields, not notes.
   pushToPipedrive puts leadChatText on the custom "Chat transcript"
   field in the same create call, which is what sales actually reads.
   leadNoteHtml is the HTML note on the lead (same facts, escaped).

   Neither function sends anything. The Edge Function only calls them
   from captureLead, and captureLead is not reached for a suspected-bot
   session — see shouldSendLeadEmail.
   ========================================================= */

import { DEFAULTS } from "./abuse.mjs";

/**
 * Room for a turn-capped transcript of the longest messages we store.
 * 24 visitor turns, each a 2,000-character question and a similarly
 * long reply, plus the contact block. The previous 60,000-character
 * trim was sized for the replay window (24 messages total) and could
 * drop the end of a full session.
 */
export const LEAD_EMAIL_MAX_CHARS =
  DEFAULTS.maxSessionTurns * 2 * 2000 + 8000;

const ROUTE_LABEL = {
  sales: "Sales",
  support: "Support",
  not_sure: "Not sure",
};

export function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function interestLabel(interest) {
  const raw = String(interest ?? "").trim();
  return ROUTE_LABEL[raw] || raw;
}

/** Oldest first. A stored turn is a visitor question and the reply. */
export function conversationFromTranscript(prior) {
  const lines = [];
  for (const row of prior || []) {
    if (row?.question) lines.push({ role: "user", content: String(row.question) });
    if (row?.reply) lines.push({ role: "assistant", content: String(row.reply) });
  }
  return lines;
}

export function speakerLabel(role) {
  return role === "user" ? "Visitor" : "Assistant";
}

/**
 * Repeated or too-fast sessions are suspected bots. They must not
 * create a lead, which is what sends the sales email. A turn-cap
 * close is not a bot.
 */
export function shouldSendLeadEmail(prior) {
  return !(prior || []).some(
    (row) => row?.stop_reason === "abuse_repeat" || row?.stop_reason === "abuse_fast",
  );
}

function contactLines(row, { html }) {
  const show = (value) => {
    const text = String(value ?? "").trim();
    if (!text) return "";
    return html ? escapeHtml(text).replace(/\n/g, "<br>") : text;
  };
  const interest = interestLabel(row.interest);
  const lines = [
    ["Name", show(row.name) || (html ? "" : "not given")],
    ["Email", show(row.work_email)],
    ["Firm", show(row.firm_name)],
    ["Phone", show(row.phone)],
    ["Firm size", show(row.firm_size)],
    ["Interest", interest ? (html ? escapeHtml(interest) : interest) : ""],
  ];
  return lines.filter(([, value]) => value);
}

/**
 * Plain text for the custom lead field the sales email inserts.
 * Contact details and the sales/support choice come first, then the
 * transcript in order, so a long chat cannot push who they are off
 * the top. Only an over-cap transcript is trimmed, from the end.
 */
export function leadChatText(row, conversation) {
  const lines = contactLines(row, { html: false }).map(([label, value]) => `${label}: ${value}`);
  const summary = String(row.summary ?? "").trim();
  if (summary) lines.push("", "Summary:", summary);
  lines.push("", "Conversation:");
  for (const message of conversation || []) {
    lines.push(`${speakerLabel(message.role)}: ${String(message.content ?? "")}`);
  }
  return lines.join("\n").slice(0, LEAD_EMAIL_MAX_CHARS);
}

/** HTML note. Visitor text is escaped before any newline becomes a break. */
export function leadNoteHtml(row, conversation) {
  const details = contactLines(row, { html: true })
    .map(([label, value]) => `${escapeHtml(label)}: ${value}`)
    .join("<br>");
  const summary = String(row.summary ?? "").trim();
  const summaryHtml = summary
    ? `<br><br><b>Summary</b><br>${escapeHtml(summary).replace(/\n/g, "<br>")}`
    : "";
  const transcript = (conversation || [])
    .map((message) => {
      const body = escapeHtml(String(message.content ?? "")).replace(/\n/g, "<br>");
      return `<b>${speakerLabel(message.role)}:</b> ${body}`;
    })
    .join("<br><br>");
  const session = String(row.session_id ?? "").trim();
  const sessionHtml = session ? `<br>Chat session: ${escapeHtml(session)}` : "";
  return (
    `<b>From site chat</b><br>${details}${sessionHtml}${summaryHtml}` +
    (transcript ? `<br><br><b>Conversation</b><br>${transcript}` : "")
  );
}
