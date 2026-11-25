/* =========================================================
   Sales-email body for a chat lead. Nothing here sends mail —
   Pipedrive does that when a lead is created. These tests cover
   the text that creation puts in the email.
   ========================================================= */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULTS } from "../supabase/functions/chat/abuse.mjs";
import { handoffLeadFields, validateHandoff } from "../supabase/functions/chat/handoff.mjs";
import {
  LEAD_EMAIL_MAX_CHARS,
  conversationFromTranscript,
  leadChatText,
  leadNoteHtml,
  shouldSendLeadEmail,
} from "../supabase/functions/chat/lead-email.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function turns(n, visitorText = (i) => `Question ${i} about CLESite`) {
  const prior = [];
  for (let i = 1; i <= n; i++) {
    prior.push({
      question: visitorText(i),
      reply: `Answer ${i} about UniversitySite`,
      stop_reason: "end_turn",
    });
  }
  return prior;
}

const handoff = validateHandoff({
  name: "Dana Chen",
  email: "dana@firm.example",
  firm: "Example LLP",
  phone: "+1 (415) 555-0100",
  note: "We need to move CLE tracking off a spreadsheet.",
  route: "support",
});

describe("lead notification text", () => {
  const fields = handoffLeadFields(handoff.value);
  const conversation = [
    ...conversationFromTranscript(turns(3)),
    { role: "user", content: handoff.value.note },
    { role: "assistant", content: "Thanks. Someone from the team will contact you." },
  ];
  const row = { ...fields, session_id: "session-1" };

  it("lists contact details, the sales/support choice, and the transcript in order", () => {
    const text = leadChatText(row, conversation);
    const html = leadNoteHtml(row, conversation);
    for (const body of [text, html]) {
      const visitorAt = (n) => body.indexOf(n === 4 ? handoff.value.note : `Question ${n} about CLESite`);
      assert.ok(visitorAt(1) > -1 && visitorAt(1) < visitorAt(2) && visitorAt(2) < visitorAt(3));
      assert.ok(body.indexOf("Answer 1 about UniversitySite") < body.indexOf("Answer 3 about UniversitySite"));
      // The note is also quoted in the summary, above the transcript.
      // The copy inside the transcript is the later one.
      assert.ok(body.indexOf("Answer 3 about UniversitySite") < body.lastIndexOf(handoff.value.note));
    }
    assert.match(text, /Name: Dana Chen/);
    assert.match(text, /Email: dana@firm\.example/);
    assert.match(text, /Firm: Example LLP/);
    assert.match(text, /Phone: \+1 \(415\) 555-0100/);
    assert.match(text, /Interest: Support/);
    assert.match(html, /Interest: Support/);
    assert.match(html, /dana@firm\.example/);
    // The choice and the contact block come before the transcript.
    assert.ok(text.indexOf("Interest: Support") < text.indexOf("Question 1 about CLESite"));
    assert.ok(html.indexOf("Interest: Support") < html.indexOf("Question 1 about CLESite"));
  });

  it("labels each line as Visitor or Assistant", () => {
    const text = leadChatText(row, conversation);
    const html = leadNoteHtml(row, conversation);
    assert.match(text, /^Visitor: Question 1 about CLESite$/m);
    assert.match(text, /^Assistant: Answer 1 about UniversitySite$/m);
    assert.match(html, /<b>Visitor:<\/b> Question 1 about CLESite/);
    assert.match(html, /<b>Assistant:<\/b> Answer 1 about UniversitySite/);
    assert.equal(text.includes("Profiscience agent"), false);
  });

  it("escapes visitor text in the HTML note and leaves the plain-text email readable", () => {
    const hostile = `Hello <script>alert("x")</script> & Tom's firm`;
    const conversation = [{ role: "user", content: hostile }];
    const html = leadNoteHtml({ ...row, name: `Dana <b>Chen</b>` }, conversation);
    const text = leadChatText(row, conversation);
    assert.equal(html.includes("<script>"), false);
    assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
    assert.match(html, /&amp; Tom&#39;s firm/);
    assert.match(html, /Dana &lt;b&gt;Chen&lt;\/b&gt;/);
    assert.match(text, /Visitor: Hello <script>alert\("x"\)<\/script> & Tom's firm/);
  });

  it("keeps every turn of a conversation that ran up to the turn cap", () => {
    // Both sides are as long as a stored message. 24 of those is more
    // than the old 60,000-character trim, which cut the tail off.
    const prior = [];
    for (let i = 1; i <= DEFAULTS.maxSessionTurns; i++) {
      prior.push({
        question: `TURN-${i}-` + "q".repeat(2000),
        reply: `REPLY-${i}-` + "a".repeat(2000),
        stop_reason: i === DEFAULTS.maxSessionTurns ? "abuse_turn_cap" : "end_turn",
      });
    }
    const conversation = conversationFromTranscript(prior);
    assert.equal(conversation.length, DEFAULTS.maxSessionTurns * 2);
    const text = leadChatText(row, conversation);
    const html = leadNoteHtml(row, conversation);
    assert.ok(text.length > 60000);
    assert.ok(text.length <= LEAD_EMAIL_MAX_CHARS);
    for (const body of [text, html]) {
      let previous = -1;
      for (let i = 1; i <= DEFAULTS.maxSessionTurns; i++) {
        const at = body.indexOf(`TURN-${i}-`);
        assert.ok(at > previous, `turn ${i} missing or out of order`);
        previous = at;
        assert.ok(body.includes(`REPLY-${i}-`));
      }
    }
  });
});

describe("suspected bots do not send the sales email", () => {
  it("refuses repeat and fast sessions, and still allows a turn-cap conversation", () => {
    assert.equal(shouldSendLeadEmail([{ stop_reason: "abuse_repeat" }]), false);
    assert.equal(shouldSendLeadEmail([{ stop_reason: "abuse_fast" }]), false);
    assert.equal(
      shouldSendLeadEmail([
        { stop_reason: "end_turn" },
        { stop_reason: "abuse_turn_cap" },
      ]),
      true,
    );
    assert.equal(shouldSendLeadEmail([]), true);
  });

  it("returns from the handoff handler before a lead — and therefore an email — is created", () => {
    const src = readFileSync(join(ROOT, "supabase/functions/chat/index.ts"), "utf8");
    const body = src.slice(src.indexOf("async function handleHandoff"), src.indexOf("const SYSTEM_PROMPT"));
    const gate = body.indexOf("shouldSendLeadEmail(session.prior)");
    const save = body.indexOf("captureLead(fields");
    assert.ok(gate > -1 && save > gate);
  });
});
