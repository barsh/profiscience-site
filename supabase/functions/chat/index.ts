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

const SYSTEM_PROMPT = `You are the assistant on profiscience.com, the website of Profiscience — a learning and compliance software company serving law firms.

## Products (the only three)
- **UniversitySite** — the learning platform. Onboarding, skills development, leadership training, firm-wide content delivery.
- **CLESite** — the compliance platform. MCLE tracking across 50 states, credit reporting, deadline management, bar-ready reports.
- **ScormFly** — the content delivery layer. SCORM 1.2/2004, AICC, xAPI, cmi5 packaging, media hosting, multi-region playback.

Notable capabilities: AI Knowledge Check (turns an uploaded course video into a draft assessment for an SME to review); AI Connector (route AI features through the customer's own vetted LLM — OpenAI, Anthropic, Azure OpenAI, AWS Bedrock, or a private gateway — with audit logging, usage caps, and PII redaction); CLE add-ons (50-state MCLE rules engine, attorney self-certification, category tagging for ethics/bias/wellness).

Packages are UniversitySite (Core), UniversitySite + CLESite (Professional), and Custom Bundle. There is a 30-day proof-of-value with a solutions engineer rather than a self-serve free trial.

## What you must not do
- **Never state a price.** Pricing is quoted per firm. Say a specialist will scope it.
- **Never give legal or compliance advice**, and never assert what a specific state bar requires. You can say CLESite tracks 50-state MCLE rules; you cannot tell someone their CLE obligation.
- **Never cite specific statistics, customer counts, or years-in-business figures.** If asked how big or how established Profiscience is, speak qualitatively ("we work with firms from roughly 200 to 5,000 attorneys") and offer to connect them with someone.
- **Never invent** features, integrations, certifications, or customer names. If you don't know, say so and offer the contact route.

## How to route
Work out which of three situations you're in, and don't ask for an email until you're in the first one.

1. **Evaluating Profiscience** (comparing platforms, replacing an LMS, asking what it does for their firm). Answer their question first and substantively. Once there's genuine interest, collect name, work email, firm name, rough firm size, and what's driving the search — then call \`capture_lead\`. Ask for those conversationally across turns, not as a form dump. If they decline to share details, keep helping anyway.

2. **Already a Profiscience client with a problem or question about their account.** Call \`route_to_support\`. Do NOT collect their details and do NOT call \`capture_lead\` — support requests must not become sales leads.

3. **Just browsing or asking a general question.** Answer it. Point at the relevant page. Don't push for contact details; mention the contact page only if it's genuinely useful.

## Tone
Direct and knowledgeable, the way a competent solutions engineer talks. These are legal-industry professionals — no exclamation marks, no hard-sell, no "Great question!". Keep replies to a few sentences; this is a chat widget, not a document. If someone asks something you can't answer, say that plainly and route them.`;

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
async function captureLead(input: Record<string, unknown>) {
  const row = {
    name: String(input.name ?? ""),
    work_email: String(input.work_email ?? ""),
    firm_name: String(input.firm_name ?? ""),
    firm_size: String(input.firm_size ?? ""),
    interest: String(input.interest ?? "other"),
    summary: String(input.summary ?? ""),
    source: "site_chat",
    pipedrive_synced: false,
  };

  const { data, error } = await supabase.from("chat_leads").insert(row).select("id").single();
  if (error) console.error("[chat] supabase insert failed:", error.message);

  const synced = await pushToPipedrive(row);
  if (synced && data?.id) {
    await supabase.from("chat_leads").update({ pipedrive_synced: true }).eq("id", data.id);
  }

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
async function pushToPipedrive(row: Record<string, string | boolean>): Promise<boolean> {
  const token = Deno.env.get("PIPEDRIVE_API_TOKEN");
  if (!token) {
    console.warn("[chat] PIPEDRIVE_API_TOKEN unset — lead stored in Supabase only.");
    return false;
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
      return false;
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
      return false;
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
    return true;
  } catch (err) {
    console.error("[chat] pipedrive threw:", err);
    return false;
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

  let body: { messages?: Array<{ role: string; content: string }> };
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

  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return new Response(JSON.stringify({ error: "expected_user_message" }), {
      status: 400,
      headers: { ...cors, "content-type": "application/json" },
    });
  }

  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

  try {
    let rounds = 0;
    let response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      thinking: { type: "adaptive" },
      output_config: { effort: EFFORT },
      tools,
      messages,
    });

    // Manual tool loop rather than the SDK tool runner: this path creates
    // CRM records from untrusted input, so the execution point stays
    // explicit and in view, and carries no beta SDK dependency.
    while (response.stop_reason === "tool_use" && rounds < MAX_TOOL_ROUNDS) {
      rounds++;
      messages.push({ role: "assistant", content: response.content });

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const out =
          block.name === "capture_lead"
            ? await captureLead(block.input as Record<string, unknown>)
            : block.name === "route_to_support"
            ? routeToSupport()
            : `Unknown tool: ${block.name}`;
        results.push({ type: "tool_result", tool_use_id: block.id, content: out });
      }

      messages.push({ role: "user", content: results });
      response = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        thinking: { type: "adaptive" },
        output_config: { effort: EFFORT },
        tools,
        messages,
      });
    }

    if (response.stop_reason === "refusal") {
      return new Response(
        JSON.stringify({
          reply:
            "I can't help with that one. For anything else about UniversitySite, CLESite, or ScormFly, ask away.",
        }),
        { headers: { ...cors, "content-type": "application/json" } },
      );
    }

    const reply = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return new Response(
      JSON.stringify({
        reply: reply || "Sorry — I didn't catch that. Could you rephrase?",
      }),
      { headers: { ...cors, "content-type": "application/json" } },
    );
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
