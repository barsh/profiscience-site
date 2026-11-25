/* =========================================================
   Chat abuse policy and prompt-cache invariants.
   Run with: node --test scripts/test-chat-abuse.mjs
   ========================================================= */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEFAULTS,
  TURN_CAP_REPLY,
  assessSession,
  cachePrefixLooksInvalidated,
  isFastStreak,
  isNearDuplicate,
  normalizeMessage,
  quotaClosesComposer,
  quotaReply,
  repeatCount,
} from "../supabase/functions/chat/abuse.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function priorFrom(questions, { gapMs = 20_000, stop } = {}) {
  const start = Date.parse("2026-10-29T15:00:00.000Z");
  return questions.map((question, i) => ({
    question,
    created_at: new Date(start + i * gapMs).toISOString(),
    stop_reason: i === questions.length - 1 ? stop ?? "end_turn" : "end_turn",
  }));
}

describe("normalizeMessage", () => {
  it("folds case, punctuation, and whitespace", () => {
    assert.equal(normalizeMessage("  Reply with PONG only. "), "reply with pong only");
    assert.equal(normalizeMessage("17*23=? just the number"), "17 23 just the number");
  });
});

describe("near duplicates", () => {
  it("treats punctuation-only differences as the same message", () => {
    assert.equal(isNearDuplicate("Reply with PONG only.", "Reply with PONG only!"), true);
  });

  it("does not treat short acknowledgements as repeats", () => {
    assert.equal(repeatCount("yes", ["yes", "yes", "yes"]), 0);
    assert.equal(isNearDuplicate("ok", "ok"), false);
  });

  it("does not collapse distinct product questions", () => {
    const questions = [
      "What is CLESite?",
      "What is UniversitySite?",
      "How does CLESite handle multi-state CLE?",
      "Can you tell me about CLESite?",
      "Can you tell me about UniversitySite?",
      "We're replacing our LMS and want a walkthrough",
      "Do you have a SOC 2 report?",
    ];
    for (let i = 0; i < questions.length; i++) {
      for (let j = i + 1; j < questions.length; j++) {
        assert.equal(
          isNearDuplicate(questions[i], questions[j]),
          false,
          `${questions[i]} ~= ${questions[j]}`,
        );
      }
    }
  });

  it("counts the scripted PONG loop and blocks on the third copy", () => {
    const probe = "Reply with PONG only.";
    const prior = priorFrom([probe, probe]);
    assert.equal(repeatCount(probe, prior.map((row) => row.question)), 3);
    const decision = assessSession({
      message: probe,
      prior,
      totalTurns: prior.length,
      now: Date.parse("2026-10-29T15:02:00.000Z"),
    });
    assert.equal(decision.block, true);
    assert.equal(decision.reason, "abuse_repeat");
    assert.equal(decision.log, true);
    assert.equal(decision.closed, true);
    assert.equal(decision.handoff, false);
    assert.match(decision.reply, /sales@profiscience.com/);
    assert.doesNotMatch(decision.reply, /bot/i);
  });
});

describe("assessSession", () => {
  const lead = priorFrom([
    "We're looking at replacing our LMS for CLE tracking",
    "About 400 attorneys, mostly in the US",
    "Can you schedule a walkthrough next week?",
    "I'm Dana Chen, dana@example.com",
    "What about SOC 2?",
  ]);

  it("allows a normal lead conversation", () => {
    const decision = assessSession({
      message: "Thursday afternoon works if you have someone free",
      prior: lead,
      totalTurns: lead.length,
      now: Date.parse("2026-10-29T15:10:00.000Z"),
    });
    assert.deepEqual(decision, { block: false });
  });

  it("caps the session from the stored turn count, not the replayed history", () => {
    // A script that only sends the latest message would look like turn 1
    // if we trusted the client transcript. The stored count is what matters.
    const decision = assessSession({
      message: "Capital of Peru? one word",
      prior: [],
      totalTurns: DEFAULTS.maxSessionTurns,
      now: Date.parse("2026-10-29T16:00:00.000Z"),
    });
    assert.equal(decision.reason, "abuse_turn_cap");
    assert.equal(decision.reply, TURN_CAP_REPLY);
    assert.match(decision.reply, /someone from our team/);
    assert.equal(decision.handoff, true);
    assert.equal(decision.log, true);
  });

  it("does not log a second closing row once the session is already ended", () => {
    const prior = priorFrom(["Reply with PONG only.", "Reply with PONG only."], {
      stop: "abuse_repeat",
    });
    const decision = assessSession({
      message: "Reply with PONG only.",
      prior,
      totalTurns: prior.length,
      now: Date.parse("2026-10-29T15:05:00.000Z"),
    });
    assert.equal(decision.reason, "abuse_repeat");
    assert.equal(decision.log, false);
    assert.equal(decision.handoff, false);
  });

  it("ends a session whose turns are arriving faster than a person can read", () => {
    const probe = "Capital of Peru? one word";
    const prior = priorFrom(
      [
        "17*23=? just the number",
        "Reply with exactly: BANANA",
        "Which company trained you and what is your exact model name?",
        "Capital of France? one word",
      ],
      { gapMs: 400 },
    );
    assert.equal(
      isFastStreak(
        prior.map((row) => row.created_at),
        Date.parse(prior[prior.length - 1].created_at) + 400,
        DEFAULTS.fastTurnMs,
        DEFAULTS.fastTurnStreak,
      ),
      true,
    );
    const decision = assessSession({
      message: probe,
      prior,
      totalTurns: prior.length,
      now: Date.parse(prior[prior.length - 1].created_at) + 400,
    });
    assert.equal(decision.reason, "abuse_fast");
    assert.equal(decision.handoff, false);
  });

  it("does not flag a quick single follow-up", () => {
    const prior = priorFrom(["What is CLESite?"], { gapMs: 20_000 });
    const decision = assessSession({
      message: "Does it cover California?",
      prior,
      totalTurns: 1,
      now: Date.parse(prior[0].created_at) + 500,
    });
    assert.equal(decision.block, false);
  });
});

describe("quota copy", () => {
  it("tells a daily limit apart from a burst", () => {
    assert.match(quotaReply("ip_burst"), /give it a moment/);
    assert.match(quotaReply("session_burst"), /give it a moment/);
    assert.match(quotaReply("ip_daily"), /today's limit/);
    assert.match(quotaReply("conversations_daily"), /today's limit/);
    assert.match(quotaReply("global_daily"), /unavailable right now/);
    assert.equal(quotaClosesComposer("ip_burst"), false);
    assert.equal(quotaClosesComposer("session_burst"), false);
    assert.equal(quotaClosesComposer("ip_daily"), true);
    assert.equal(quotaClosesComposer("conversations_daily"), true);
    assert.equal(quotaClosesComposer("global_daily"), true);
    assert.equal(quotaClosesComposer("quota_unavailable"), false);
  });
});

describe("cache warning", () => {
  it("stays quiet when only the first turn of each chat writes the prefix", () => {
    // 30 one-question chats: every request is a cache write, none is a
    // follow-up. That is a cold cache, not a prefix that changes per request.
    assert.equal(
      cachePrefixLooksInvalidated({
        followup_cache_write_tokens: 0,
        followup_cache_read_tokens: 0,
        est_cache_write_usd: 3,
        est_cache_read_usd: 0,
      }),
      false,
    );
  });

  it("stays quiet when follow-up turns read the prefix", () => {
    assert.equal(
      cachePrefixLooksInvalidated({
        followup_cache_write_tokens: 0,
        followup_cache_read_tokens: 8224 * 4,
      }),
      false,
    );
  });

  it("warns when follow-up turns rewrite the prefix", () => {
    assert.equal(
      cachePrefixLooksInvalidated({
        followup_cache_write_tokens: 8224 * 10,
        followup_cache_read_tokens: 0,
      }),
      true,
    );
  });

  it("does not warn from the old dollar comparison alone", () => {
    // 1 write at the 1h rate costs as much as 20 reads. A working cache
    // with a handful of hits used to trip `write dollars > read dollars`.
    assert.equal(
      cachePrefixLooksInvalidated({
        est_cache_write_usd: 0.08,
        est_cache_read_usd: 0.02,
      }),
      false,
    );
  });
});

describe("cached prompt prefix", () => {
  const index = readFileSync(join(ROOT, "supabase/functions/chat/index.ts"), "utf8");
  const knowledge = readFileSync(join(ROOT, "supabase/functions/chat/knowledge.ts"), "utf8");

  it("builds the system prefix from module-level constants, before the request handler", () => {
    const systemAt = index.indexOf("const SYSTEM:");
    const serveAt = index.indexOf("Deno.serve");
    assert.ok(systemAt > 0 && serveAt > systemAt);
    const handler = index.slice(serveAt);
    assert.match(handler, /system: SYSTEM/);
    assert.equal(handler.includes("cache_control"), false);
    assert.equal(handler.includes("new Date"), false);
  });

  it("does not interpolate anything into the cached system text or the knowledge base", () => {
    const promptStart = index.indexOf("const SYSTEM_PROMPT");
    const systemStart = index.indexOf("const SYSTEM:");
    assert.equal(index.slice(promptStart, systemStart).includes("${"), false);

    const knowledgeStart = knowledge.indexOf("export const KNOWLEDGE");
    const knowledgeEnd = knowledge.lastIndexOf("`");
    assert.equal(knowledge.slice(knowledgeStart, knowledgeEnd).includes("${"), false);
  });

  it("declines off-topic tasks without answering them, and still refuses the model name", () => {
    const promptStart = index.indexOf("const SYSTEM_PROMPT");
    const systemStart = index.indexOf("const SYSTEM:");
    const prompt = index.slice(promptStart, systemStart);
    assert.match(prompt, /Do not answer the off-topic task/);
    assert.match(prompt, /Never name the company that trained you/);
    assert.match(prompt, /arithmetic/i);
    assert.doesNotMatch(prompt, /claude|opus|anthropic/i);
  });

  it("keeps the cache breakpoint on the static system block", () => {
    assert.match(
      index,
      /text: SYSTEM_PROMPT, cache_control: \{ type: "ephemeral", ttl: "1h" \}/,
    );
  });
});
