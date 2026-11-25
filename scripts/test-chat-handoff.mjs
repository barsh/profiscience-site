/* =========================================================
   Human handoff decisions.
   Run with: node --test scripts/test-chat-handoff.mjs
   ========================================================= */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HANDOFF_OFFER,
  assistantCantResolve,
  handoffLeadFields,
  responseOffersHandoff,
  sessionIsSuspectedBot,
  validateHandoff,
  visitorWantsPerson,
  withHandoffOffer,
} from "../supabase/functions/chat/handoff.mjs";

const valid = {
  name: "Dana Chen",
  email: "Dana@Firm.Example",
  firm: "Example LLP",
  phone: "+1 (415) 555-0100",
  note: "We need help moving CLE tracking off a spreadsheet.",
  route: "not_sure",
};

describe("visitorWantsPerson", () => {
  it("catches a request for a person, sales, or support", () => {
    for (const message of [
      "Can I talk to a person?",
      "I'd like to speak with a human",
      "Connect me with sales",
      "I need customer support",
      "Please have someone from support contact me",
      "I want to talk to sales about a rollout",
      "real person please",
    ]) {
      assert.equal(visitorWantsPerson(message), true, message);
    }
  });

  it("does not treat a product question that mentions support or sales as a request", () => {
    for (const message of [
      "What is CLESite?",
      "What are your support hours?",
      "How does the sales process work?",
      "Do you support Australian CPD?",
      "17*23=? just the number",
      "Reply with exactly: BANANA",
    ]) {
      assert.equal(visitorWantsPerson(message), false, message);
    }
  });
});

describe("assistantCantResolve", () => {
  it("opens a handoff when the assistant cannot answer", () => {
    assert.equal(assistantCantResolve({ toolCalled: "route_to_support", reply: "Email support." }), true);
    assert.equal(assistantCantResolve({ stopReason: "refusal", reply: "No." }), true);
    assert.equal(
      assistantCantResolve({
        reply: "I can't help with that — I'm here for questions about UniversitySite and CLESite.",
      }),
      true,
    );
    assert.equal(
      assistantCantResolve({
        reply: "I'd rather get you a solutions engineer than guess at that integration.",
      }),
      true,
    );
  });

  it("stays closed for an ordinary answer, and when a lead was just captured", () => {
    assert.equal(
      assistantCantResolve({
        reply: "CLESite tracks credits across jurisdictions and sits on UniversitySite.",
      }),
      false,
    );
    assert.equal(
      assistantCantResolve({
        toolCalled: "capture_lead",
        reply: "A specialist will follow up by email.",
      }),
      false,
    );
  });
});

describe("responseOffersHandoff", () => {
  it("offers the form at the turn cap and not for a suspected bot", () => {
    assert.equal(responseOffersHandoff({ blockedReason: "abuse_turn_cap", prior: [] }), true);
    assert.equal(responseOffersHandoff({ blockedReason: "abuse_repeat", prior: [] }), false);
    assert.equal(responseOffersHandoff({ blockedReason: "abuse_fast", prior: [] }), false);
    assert.equal(
      responseOffersHandoff({
        blockedReason: "abuse_turn_cap",
        prior: [{ stop_reason: "abuse_repeat" }],
      }),
      false,
    );
    assert.equal(sessionIsSuspectedBot([{ stop_reason: "abuse_turn_cap" }]), false);
    assert.equal(sessionIsSuspectedBot([{ stop_reason: "abuse_fast" }]), true);
  });

  it("offers the form when the visitor asks for a person or the answer is a handoff", () => {
    assert.equal(responseOffersHandoff({ message: "Can I talk to a human?", prior: [] }), true);
    assert.equal(
      responseOffersHandoff({
        message: "What about SOC 2?",
        prior: [],
        reply: "Security reviews get a definite answer from our solutions engineers.",
      }),
      true,
    );
    assert.equal(
      responseOffersHandoff({
        message: "What is CLESite?",
        prior: [],
        reply: "CLESite is the CLE administration product built on UniversitySite.",
      }),
      false,
    );
  });
});

describe("withHandoffOffer", () => {
  it("adds the offer once", () => {
    assert.equal(withHandoffOffer("CLESite tracks credits."), "CLESite tracks credits.\n\n" + HANDOFF_OFFER);
    assert.equal(withHandoffOffer("Want someone from our team to contact you?"), HANDOFF_OFFER);
    assert.equal(withHandoffOffer(""), HANDOFF_OFFER);
  });
});

describe("validateHandoff", () => {
  it("accepts a complete request and normalizes the email", () => {
    const result = validateHandoff(valid);
    assert.equal(result.ok, true);
    assert.equal(result.value.email, "dana@firm.example");
    assert.equal(result.value.route, "not_sure");
    const lead = handoffLeadFields(result.value);
    assert.equal(lead.source, "site_chat_handoff");
    assert.equal(lead.interest, "not_sure");
    assert.equal(lead.work_email, "dana@firm.example");
    assert.equal(lead.firm_name, "Example LLP");
    assert.match(lead.summary, /Not sure/);
    assert.match(lead.summary, /415/);
    assert.match(lead.summary, /spreadsheet/);
  });

  it("allows an empty firm and phone", () => {
    const result = validateHandoff({ ...valid, firm: "  ", phone: "", route: "support" });
    assert.equal(result.ok, true);
    assert.equal(result.value.firm, "");
    assert.equal(result.value.phone, "");
    assert.doesNotMatch(handoffLeadFields(result.value).summary, /Phone:/);
  });

  it("rejects a bad email, a missing note, a bad phone, and an unknown route", () => {
    assert.match(validateHandoff({ ...valid, email: "not-an-email" }).error, /email/i);
    assert.match(validateHandoff({ ...valid, email: "a@b" }).error, /email/i);
    assert.match(validateHandoff({ ...valid, name: "  " }).error, /name/i);
    assert.match(validateHandoff({ ...valid, note: "no" }).error, /what you need/i);
    assert.match(validateHandoff({ ...valid, phone: "12" }).error, /phone/i);
    assert.match(validateHandoff({ ...valid, phone: "call me maybe" }).error, /phone/i);
    assert.match(validateHandoff({ ...valid, route: "billing" }).error, /sales, support/i);
  });
});
