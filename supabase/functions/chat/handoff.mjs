/* =========================================================
   Human handoff — pure decisions, no I/O.
   ---------------------------------------------------------
   The widget shows a small form ("Want someone from our team to
   contact you?") so a person can choose sales, support, or not sure.
   The Edge Function stores that as a chat_leads row and pushes it
   through the same Pipedrive path as capture_lead.

   Suspected-bot sessions (repeated or impossibly fast messages) do
   not get the form. Hitting the turn cap is not that: a long real
   conversation should still be able to reach a person, and the form
   stays usable after the chat composer locks.
   ========================================================= */

export const HANDOFF_OFFER = "Want someone from our team to contact you?";

export const HANDOFF_THANKS =
  "Thanks. Someone from the team will contact you and sort out whether this is sales or support.";

export const ROUTES = ["sales", "support", "not_sure"];

const ROUTE_LABEL = {
  sales: "Sales",
  support: "Support",
  not_sure: "Not sure",
};

/**
 * The visitor is asking to reach a person, not merely mentioning the
 * words "support" or "sales" in a product question.
 */
const PERSON_REQUESTS = [
  /\b(?:talk|speak|chat|meet)\s+(?:to|with)\s+(?:a\s+|an\s+)?(?:real\s+|live\s+|actual\s+)?(?:person|human|someone|somebody|representative|specialist|agent)\b/i,
  /\b(?:talk|speak|chat|meet)\s+(?:to|with)\s+(?:sales|support|your team|the team)\b/i,
  /\b(?:real|actual|live)\s+(?:person|human)\b/i,
  /\b(?:human|person)\s+(?:please|instead)\b/i,
  /\b(?:connect|transfer)\s+me\b/i,
  /\bhand me (?:to|off|over)\b/i,
  /\bhave\s+(?:someone|somebody|sales|support|a person|a human)(?:\s+\w+){0,5}\s+(?:contact|call|email|reach)\b/i,
  /\b(?:need|want)\s+(?:to\s+)?(?:speak|talk)\s+(?:to|with)\b/i,
  /\b(?:need|want|get)\s+(?:some\s+)?(?:support|a human|a person|sales)\b/i,
  /\bcustomer support\b/i,
  /\b(?:contact|reach)\s+(?:sales|support|a person|a human|someone|your team|the team)\b/i,
];

/** Phrases the assistant uses when it is handing the question off. */
const CANT_RESOLVE = [
  /can(?:not|'t) help/i,
  /rather not guess/i,
  /get you someone/i,
  /put you in touch/i,
  /definite answer/i,
  /solutions engineer/i,
  /someone from (?:our|the) team/i,
  /team can contact/i,
];

export function visitorWantsPerson(message) {
  const text = String(message ?? "");
  if (!text.trim()) return false;
  return PERSON_REQUESTS.some((pattern) => pattern.test(text));
}

/**
 * The model could not finish the question itself: it called the support
 * tool, the API refused, or the reply is a handoff rather than an answer.
 * A lead already captured in this turn does not need the form as well.
 */
export function assistantCantResolve({ reply, toolCalled, stopReason } = {}) {
  if (toolCalled === "capture_lead") return false;
  if (toolCalled === "route_to_support") return true;
  if (stopReason === "refusal") return true;
  const text = String(reply ?? "");
  return CANT_RESOLVE.some((pattern) => pattern.test(text));
}

export function sessionIsSuspectedBot(prior) {
  return (prior || []).some(
    (row) => row?.stop_reason === "abuse_repeat" || row?.stop_reason === "abuse_fast",
  );
}

/**
 * Whether this chat response should open the form. A suspected-bot
 * session never does, including one that also hit the turn cap.
 */
export function responseOffersHandoff({ message, prior, reply, toolCalled, stopReason, blockedReason } = {}) {
  if (sessionIsSuspectedBot(prior)) return false;
  if (blockedReason === "abuse_repeat" || blockedReason === "abuse_fast") return false;
  if (blockedReason === "abuse_turn_cap") return true;
  if (visitorWantsPerson(message)) return true;
  return assistantCantResolve({ reply, toolCalled, stopReason });
}

export function alreadyOffersHandoff(reply) {
  return /someone from (?:our|the) team/i.test(String(reply ?? ""));
}

/** Append the offer once, as its own sentence, when the form will open. */
export function withHandoffOffer(reply) {
  const text = String(reply ?? "").trim();
  if (!text) return HANDOFF_OFFER;
  if (alreadyOffersHandoff(text)) return text;
  return text + "\n\n" + HANDOFF_OFFER;
}

function clean(value, max) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function digitCount(value) {
  return (value.match(/\d/g) || []).length;
}

const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

/**
 * Validate the form. Firm and phone are optional. Email is checked
 * here, not trusted from the browser.
 */
export function validateHandoff(input) {
  const raw = input && typeof input === "object" ? input : {};
  const name = clean(raw.name, 120);
  const email = clean(raw.email, 200).toLowerCase();
  const firm = clean(raw.firm, 160);
  const phone = clean(raw.phone, 40);
  const note = clean(raw.note, 1000);
  const route = String(raw.route ?? "").trim();

  if (name.length < 1) return { ok: false, error: "Please enter your name." };
  if (!EMAIL.test(email) || email.includes("..")) {
    return { ok: false, error: "Please enter a valid email address." };
  }
  if (phone && (digitCount(phone) < 7 || digitCount(phone) > 15 || /[^0-9+\-().\s]/.test(phone))) {
    return { ok: false, error: "That phone number doesn't look right." };
  }
  if (note.length < 3) return { ok: false, error: "Tell us briefly what you need." };
  if (!ROUTES.includes(route)) {
    return { ok: false, error: "Choose sales, support, or not sure." };
  }

  return { ok: true, value: { name, email, firm, phone, note, route } };
}

/** The chat_leads columns this form writes. Phone lives in the summary. */
export function handoffLeadFields(value) {
  const label = ROUTE_LABEL[value.route] || value.route;
  const lines = [`Handoff (${label}).`];
  if (value.phone) lines.push("Phone: " + value.phone);
  lines.push("", value.note);
  return {
    name: value.name,
    work_email: value.email,
    firm_name: value.firm,
    firm_size: "",
    interest: value.route,
    summary: lines.join("\n"),
    source: "site_chat_handoff",
    // Not a chat_leads column. captureLead copies it onto the
    // notification only, so the sales email can list it on its own line.
    phone: value.phone,
  };
}

export function interestLabel(interest) {
  return ROUTE_LABEL[interest] || interest || "";
}
