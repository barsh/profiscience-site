/* =========================================================
   Profiscience chat agent — Supabase Edge Function (Deno)
   ---------------------------------------------------------
   Replaces the Pipedrive LeadBooster chatbot. The visitor types
   free text; Claude decides which funnel it belongs in and calls
   the matching tool:

     capture_lead     → real buying intent. Writes to Supabase,
                        then pushes a Lead into Pipedrive.
     route_to_support → existing client with a problem. Answers
                        with the support contact and deliberately
                        creates NO CRM record.

   That second path is the whole reason this exists: a support
   question should not manufacture a sales lead.

   SECRETS (never in the browser — set with `supabase secrets set`):
     ANTHROPIC_API_KEY   Claude API key
     PIPEDRIVE_API_TOKEN Pipedrive personal API token
     ALLOWED_ORIGIN      e.g. https://www.profiscience.com
   Injected by the platform, no need to set:
     SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
   ========================================================= */

import Anthropic from "npm:@anthropic-ai/sdk@0.70.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { KNOWLEDGE } from "./knowledge.ts";

const MODEL = "claude-opus-4-8";

// Chat is latency-sensitive, so this runs below the API default of
// "high". Raise to "high" if routing decisions start looking sloppy —
// it costs response time, not correctness.
const EFFORT = "medium";

const MAX_MESSAGE_CHARS = 2000;
const MAX_HISTORY_TURNS = 24;
const MAX_TOOL_ROUNDS = 4;

// Service-role key: bypasses RLS, so chat_leads and chat_rate_limit stay
// entirely unreachable from the browser. Never expose this client-side.
const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

/**
 * Quota check, backed by Postgres (see supabase/add-chat-quota.sql).
 * Counts a per-IP burst bucket, a per-IP daily bucket, and a GLOBAL daily
 * bucket. The global one is the actual spend ceiling — per-IP limits fall
 * to rotating addresses, a global count doesn't care who is calling.
 *
 * Fails CLOSED. If the quota check itself errors we refuse the request
 * rather than wave it through: an unavailable limiter in front of a
 * metered API is exactly when you least want to be permissive.
 */
async function checkQuota(ip: string): Promise<{ allowed: boolean; reason: string }> {
  try {
    const { data, error } = await supabase.rpc("chat_check_quota", { p_ip: ip });
    if (error) {
      console.error("[chat] quota check failed:", error.message);
      return { allowed: false, reason: "quota_unavailable" };
    }
    const row = Array.isArray(data) ? data[0] : data;
    return { allowed: !!row?.allowed, reason: row?.reason ?? "unknown" };
  } catch (err) {
    console.error("[chat] quota check threw:", err);
    return { allowed: false, reason: "quota_unavailable" };
  }
}

/**
 * Behavioural rules only. Everything factual lives in knowledge.ts and is
 * sent as a separate, cached system block ahead of this one.
 *
 * The split is deliberate and the order matters: reference material first,
 * rules last. Instructions that FOLLOW the data they constrain are followed
 * more reliably than instructions that precede it — and the whole risk of
 * shipping a knowledge base is that it out-argues the guardrails.
 */
const SYSTEM_PROMPT = `You are the assistant on profiscience.com, the website of Profiscience — a learning and compliance software company serving law firms.

The reference document above is what you know. It is authoritative, and it
is also the boundary: where it is silent, you are too.

## What you must not do
- **Never state a price.** Pricing is quoted per firm. Say a specialist will scope it.
- **Never give legal or compliance advice**, and never assert what a regulator requires of someone. You can say CLESite applies jurisdiction-specific rules; you cannot tell a visitor what their own CLE or CPD obligation is.
- **Never deny a capability.** If the reference document doesn't describe something, you don't know whether Profiscience offers it — hand off. A false "we don't do that" sends a real prospect to a competitor and nobody at Profiscience ever finds out.
- **Never cite specific statistics, customer counts, or years-in-business figures**, and never name a client firm — including the ones in the reference document's case-study material. Asked how big or established Profiscience is, answer qualitatively (firms from a few hundred to several thousand attorneys) and offer to connect them.
- **Never invent** features, integrations, certifications, packages, or customer names. The reference document lists what is contested or unverified; on those, route to the team rather than picking an answer.
- **Never promise a free trial, self-serve signup, or a named pricing tier.** None exist.

If you catch yourself reaching for a plausible-sounding detail that isn't in
the reference document, that is the moment to hand off to a human — see
"Hand off, don't stonewall" above for how. A technical question you can't
answer is a buying signal, not a dead end: route it warmly, name who will
answer it, and offer the next step. Never answer with a bare "I don't know."

## How to route
Work out which of three situations you're in, and don't ask for an email until you're in the first one.

1. **Evaluating Profiscience** (comparing platforms, replacing an LMS, asking what it does for their firm). Answer their question first and substantively. Once there's genuine interest, collect name, work email, firm name, rough firm size, and what's driving the search — then call \`capture_lead\`. Ask for those conversationally across turns, not as a form dump. If they decline to share details, keep helping anyway.

2. **Already a Profiscience client with a problem or question about their account.** Call \`route_to_support\`. Do NOT collect their details and do NOT call \`capture_lead\` — support requests must not become sales leads.

3. **Just browsing or asking a general question.** Answer it. Point at the relevant page. Don't push for contact details; mention the contact page only if it's genuinely useful.

## Tone
Direct and knowledgeable, the way a competent solutions engineer talks. These are legal-industry professionals — no exclamation marks, no hard-sell, no "Great question!". Keep replies to a few sentences; this is a chat widget, not a document. When a question is beyond you, hand it off warmly rather than declining flatly.`;

/**
 * The cached prefix. Prompt caching is a prefix match over the rendered
 * request — tools, then system, then messages — so the breakpoint on the
 * LAST system block covers the tool definitions and both system blocks in
 * one entry.
 *
 * Nothing here varies per request or per visitor: no timestamps, no session
 * IDs, no interpolation. That is what makes a single cache entry shared by
 * every visitor to the site rather than one entry per conversation. Keep it
 * that way — splicing anything dynamic in front of the breakpoint would give
 * each visitor their own entry and turn every cache read into a write.
 *
 * The 1-hour TTL costs 2x on a write instead of 1.25x, which is the right
 * trade here precisely because the entry is shared: writes are paid a few
 * times a day across all traffic, not once per visitor. The window also
 * slides — each read refreshes it — so steady traffic keeps it warm and the
 * only writes are after genuine gaps or a deploy of this file.
 */
const SYSTEM: Anthropic.MessageCreateParams["system"] = [
  { type: "text", text: KNOWLEDGE },
  { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral", ttl: "1h" } },
];

const tools: Anthropic.Tool[] = [
  {
    name: "capture_lead",
    description:
      "Record a qualified sales lead and hand it to the Profiscience team. Call this ONLY when someone is evaluating Profiscience AND has given at least a name and work email. Never call it for existing-client support requests.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The person's full name." },
        work_email: { type: "string", description: "Their work email address." },
        firm_name: { type: "string", description: "Their firm or organization name, if given." },
        firm_size: {
          type: "string",
          description: "Rough size, e.g. '400 attorneys' or '1000-2000'. Empty string if not given.",
        },
        interest: {
          type: "string",
          enum: [
            "replacing_or_improving_lms",
            "cle_administration",
            "connecting_learning_and_compliance",
            "migration_or_implementation",
            "other",
          ],
          description: "What is driving their search.",
        },
        summary: {
          type: "string",
          description:
            "Two or three sentences of context for the sales team: what they asked about and what they need. Written for a human reader.",
        },
      },
      required: ["name", "work_email", "interest", "summary"],
    },
  },
  {
    name: "route_to_support",
    description:
      "Hand an EXISTING Profiscience client to the support team. Creates no CRM record. Call this as soon as it's clear the person is already a customer with a problem, rather than a prospect.",
    input_schema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "One line describing what they need help with, for your own reply.",
        },
      },
      required: ["topic"],
    },
  },
];

/* ---------- tool implementations ---------- */

/**
 * Persist first, then sync. If the Pipedrive call fails — bad token, a
 * changed API shape, an outage — the lead is already durably in Postgres
 * and can be replayed. Losing a qualified lead to a third-party 500 is
 * the one failure mode worth engineering against here.
 */
async function captureLead(input: Record<string, unknown>, sessionId: string) {
  const row = {
    name: String(input.name ?? ""),
    work_email: String(input.work_email ?? ""),
    firm_name: String(input.firm_name ?? ""),
    firm_size: String(input.firm_size ?? ""),
    interest: String(input.interest ?? "other"),
    summary: String(input.summary ?? ""),
    source: "site_chat",
    // Ties the lead to the conversation that produced it, so the admin can
    // show the actual exchange next to the agent's summary of it.
    session_id: sessionId,
    pipedrive_synced: false,
  };

  const { data, error } = await supabase.from("chat_leads").insert(row).select("id").single();
  if (error) console.error("[chat] supabase insert failed:", error.message);

  const pipedriveLeadId = await pushToPipedrive(row);
  if (pipedriveLeadId && data?.id) {
    await supabase
      .from("chat_leads")
      .update({ pipedrive_synced: true, pipedrive_lead_id: pipedriveLeadId })
      .eq("id", data.id);
  }
  const synced = Boolean(pipedriveLeadId);

  // The model only needs to know whether to promise a follow-up. It must
  // not learn about our storage internals, so the result stays coarse.
  return synced || !error
    ? "Lead recorded. Tell them a Profiscience specialist will follow up by email, and offer to keep answering questions in the meantime."
    : "Could not record the lead. Apologise briefly and ask them to email sales@profiscience.com directly.";
}

/**
 * Pipedrive's REST shape: create a Person, then a Lead pointing at it.
 * Written against the v1 API. Verify against current Pipedrive docs before
 * relying on it — this is the part most likely to drift.
 */
async function pushToPipedrive(
  row: Record<string, string | boolean>,
): Promise<string | null> {
  const token = Deno.env.get("PIPEDRIVE_API_TOKEN");
  if (!token) {
    console.warn("[chat] PIPEDRIVE_API_TOKEN unset — lead stored in Supabase only.");
    return null;
  }
  const base = "https://api.pipedrive.com/v1";
  try {
    const personRes = await fetch(`${base}/persons?api_token=${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: row.name,
        email: [{ value: row.work_email, primary: true, label: "work" }],
      }),
    });
    const person = await personRes.json();
    if (!personRes.ok || !person?.data?.id) {
      console.error("[chat] pipedrive person failed:", personRes.status, JSON.stringify(person));
      return null;
    }

    const title = row.firm_name
      ? `${row.firm_name} — site chat`
      : `${row.name} — site chat`;

    const leadRes = await fetch(`${base}/leads?api_token=${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, person_id: person.data.id }),
    });
    const lead = await leadRes.json();
    if (!leadRes.ok || !lead?.data?.id) {
      console.error("[chat] pipedrive lead failed:", leadRes.status, JSON.stringify(lead));
      return null;
    }

    // Context goes on a note so the sales team sees why this person came in.
    await fetch(`${base}/notes?api_token=${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lead_id: lead.data.id,
        content:
          `<b>From site chat</b><br>Firm: ${row.firm_name || "not given"}<br>` +
          `Size: ${row.firm_size || "not given"}<br>Interest: ${row.interest}<br><br>${row.summary}`,
      }),
    });
    // The lead id, not just success: the admin uses it to deep-link into
    // the CRM record instead of making someone search Pipedrive by email.
    return String(lead.data.id);
  } catch (err) {
    console.error("[chat] pipedrive threw:", err);
    return null;
  }
}

/**
 * Record one exchange for review. See supabase/add-chat-transcripts.sql for
 * the schema, the review views, and the retention caveat — this table holds
 * whatever visitors type, which on a law-firm site includes names, work
 * emails, and firm names.
 *
 * The agent's worst failures are silent: it invents a limitation, the
 * prospect leaves, and nothing is logged as an error. This is the only way
 * those surface without someone testing the exact question by hand.
 *
 * Never throws. A logging failure must not cost the visitor their answer —
 * losing a row of review data is a nuisance, losing the reply is the actual
 * product breaking.
 */
async function logTranscript(row: {
  session_id: string;
  turn: number;
  question: string;
  reply: string;
  tool_called: string | null;
  stop_reason: string | null;
  usage: Anthropic.Usage;
}) {
  try {
    const { error } = await supabase.from("chat_transcripts").insert({
      session_id: row.session_id,
      turn: row.turn,
      question: row.question,
      reply: row.reply,
      tool_called: row.tool_called,
      stop_reason: row.stop_reason,
      model: MODEL,
      input_tokens: row.usage.input_tokens ?? null,
      output_tokens: row.usage.output_tokens ?? null,
      cache_read_tokens: row.usage.cache_read_input_tokens ?? null,
      cache_write_tokens: row.usage.cache_creation_input_tokens ?? null,
    });
    if (error) console.error("[chat] transcript insert failed:", error.message);
  } catch (err) {
    console.error("[chat] transcript insert threw:", err);
  }
}

function routeToSupport(): string {
  return (
    "This is an existing client. Point them to support@profiscience.com, or their " +
    "Profiscience team directly. Do not ask for their details and do not treat this " +
    "as a sales enquiry. Offer to answer general product questions if useful."
  );
}

/* ---------- request handling ---------- */

function corsHeaders(origin: string | null) {
  // Comma-separated so a localhost origin can be allowed alongside production
  // while testing, e.g.
  //   ALLOWED_ORIGIN=https://www.profiscience.com,http://localhost:8899
  const allowed = (Deno.env.get("ALLOWED_ORIGIN") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Echo the origin back only on an exact match, so the browser enforces the
  // lock. Anything else gets the first configured origin, which a foreign
  // page can't satisfy.
  const ok = origin && allowed.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : allowed[0] ?? "null",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin", // don't let a CDN cache one origin's header for another
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...cors, "content-type": "application/json" },
    });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const quota = await checkQuota(ip);
  if (!quota.allowed) {
    // Distinct copy per reason: "slow down" is recoverable in a moment,
    // "we're done for today" is not, and telling someone to wait when
    // waiting won't help just wastes their time.
    const reply =
      quota.reason === "global_daily" || quota.reason === "quota_unavailable"
        ? "Chat is unavailable right now. Email sales@profiscience.com and someone will pick it up."
        : "You're sending messages faster than I can answer — give it a moment.";
    return new Response(JSON.stringify({ error: quota.reason, reply }), {
      status: 429,
      headers: { ...cors, "content-type": "application/json" },
    });
  }

  let body: {
    messages?: Array<{ role: string; content: string }>;
    session_id?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "bad_json" }), {
      status: 400,
      headers: { ...cors, "content-type": "application/json" },
    });
  }

  // The client sends the whole transcript, so validate it rather than trust
  // it: only two roles, plain strings, bounded length, bounded history.
  const incoming = Array.isArray(body.messages) ? body.messages : [];
  const messages: Anthropic.MessageParam[] = incoming
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0,
    )
    .slice(-MAX_HISTORY_TURNS)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content.slice(0, MAX_MESSAGE_CHARS),
    }));

  // Client-supplied and therefore untrusted: bound it and don't let it into
  // the database unchecked. It groups turns of one conversation for review;
  // it is not an identity and is not tied to a person or an IP.
  const sessionId =
    typeof body.session_id === "string" && body.session_id.trim()
      ? body.session_id.trim().slice(0, 64)
      : "unknown";

  // Turn number for the review views. Counts user messages in the history
  // the client replayed, so it survives the server being stateless.
  const turn = messages.filter((m) => m.role === "user").length;

  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return new Response(JSON.stringify({ error: "expected_user_message" }), {
      status: 400,
      headers: { ...cors, "content-type": "application/json" },
    });
  }

  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

  // Hoisted so the initial call and every tool-loop continuation send a
  // byte-identical prefix. If these drifted apart, each would write its own
  // cache entry and neither would ever read the other's.
  const request = {
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM,
    // SDK 0.70.0 predates adaptive thinking: its ThinkingConfigParam union
    // is still "enabled" | "disabled". The wire value here is the correct
    // one — adaptive is what Opus 4.8 expects, and it is what this function
    // has been sending in production — so assert past the stale type rather
    // than downgrade the request to match an old type definition.
    // Remove the assertion once the pinned SDK version is raised.
    thinking: { type: "adaptive" } as unknown as NonNullable<
      Anthropic.MessageCreateParams["thinking"]
    >,
    output_config: { effort: EFFORT },
    tools,
  };

  // The visitor's message, captured before the tool loop appends to
  // `messages`, so the logged question is what they actually asked.
  const question = String(messages[messages.length - 1].content);
  let toolCalled: string | null = null;

  try {
    let rounds = 0;
    let response = await client.messages.create({ ...request, messages });

    // Manual tool loop rather than the SDK tool runner: this path creates
    // CRM records from untrusted input, so the execution point stays
    // explicit and in view, and carries no beta SDK dependency.
    while (response.stop_reason === "tool_use" && rounds < MAX_TOOL_ROUNDS) {
      rounds++;
      messages.push({ role: "assistant", content: response.content });

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        toolCalled = block.name;
        const out =
          block.name === "capture_lead"
            ? await captureLead(block.input as Record<string, unknown>, sessionId)
            : block.name === "route_to_support"
            ? routeToSupport()
            : `Unknown tool: ${block.name}`;
        results.push({ type: "tool_result", tool_use_id: block.id, content: out });
      }

      messages.push({ role: "user", content: results });
      response = await client.messages.create({ ...request, messages });
    }

    // Cache health at a glance while developing. The durable version of
    // this lives in the chat_cache_health view; this line is what you watch
    // during `supabase functions serve`. Steady reads are the expected
    // state — persistent zeroes mean the prefix is being invalidated and
    // every visitor is paying full price for the knowledge base.
    const { cache_read_input_tokens: read, cache_creation_input_tokens: written } =
      response.usage;
    console.log(`[chat] cache read=${read ?? 0} write=${written ?? 0}`);

    const reply =
      response.stop_reason === "refusal"
        ? "I can't help with that one. For anything else about UniversitySite, CLESite, or ScormFly, ask away."
        : response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim() || "Sorry — I didn't catch that. Could you rephrase?";

    // Awaited rather than fired-and-forgotten: the Edge Function's runtime
    // can be torn down as soon as the response is returned, which would
    // drop an un-awaited insert. It's one row, and logTranscript can't
    // throw, so the cost is a few milliseconds and the risk is nil.
    await logTranscript({
      session_id: sessionId,
      turn,
      question,
      reply,
      tool_called: toolCalled,
      stop_reason: response.stop_reason ?? null,
      usage: response.usage,
    });

    return new Response(JSON.stringify({ reply }), {
      headers: { ...cors, "content-type": "application/json" },
    });
  } catch (err) {
    console.error("[chat] anthropic call failed:", err);
    return new Response(
      JSON.stringify({
        error: "upstream",
        reply:
          "I'm having trouble responding right now. Email sales@profiscience.com and someone will pick it up.",
      }),
      { status: 502, headers: { ...cors, "content-type": "application/json" } },
    );
  }
});
