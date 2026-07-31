/* =========================================================
   Cost sync — Anthropic Admin API → chat_actual_costs
   ---------------------------------------------------------
   Pulls the authoritative monthly spend from Anthropic's Cost API and
   records it next to our own estimate, so chat_cost_reconciliation can
   show the variance.

   WHY THIS IS A SERVER FUNCTION AND NOT A FETCH IN THE ADMIN PAGE
   The Admin API key is organization-wide. It can read every workspace's
   usage and manage API keys — it is far more powerful than the anon key
   the admin panel holds, and it must never reach a browser. So the key
   lives in Supabase secrets, this function holds it, and the admin calls
   this function with the editor's own Supabase session.

   REQUIRES AN ORGANIZATION ACCOUNT
   The Admin API is unavailable to individual accounts. The definitive
   test is whether platform.claude.com/settings/admin-keys loads — a 404
   means the account is still individual. Note that every account has an
   organization ID, including individual ones, so seeing an org ID in the
   Console proves nothing on its own.

   If this is ever unavailable again, the fallback is unchanged: record the
   monthly figure by hand from the Console usage page into
   chat_actual_costs. See add-chat-costs.sql for the insert.

   SECRETS (supabase secrets set ...):
     ANTHROPIC_ADMIN_KEY      sk-ant-admin01-...  (NOT the chat API key)
     ANTHROPIC_WORKSPACE_ID   optional, wrkspc_... — see the scoping note
   Injected by the platform:
     SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY

   ⚠️ SCOPING — READ THIS BEFORE TRUSTING THE NUMBER
   The Cost API groups by `workspace_id` and `description` ONLY. There is
   no api_key_id grouping. That means a dedicated API key for the chat
   function does NOT isolate its cost — only a dedicated WORKSPACE does.

   Without ANTHROPIC_WORKSPACE_ID set, this records your whole
   organization's spend, which is an upper bound on the chat widget, not
   its cost. The row is marked key_isolated = false so the reconciliation
   view cannot be misread as estimate error.
   ========================================================= */

import { createClient } from "npm:@supabase/supabase-js@2";

const ADMIN_BASE = "https://api.anthropic.com/v1/organizations";

// The Cost API reports amounts in the currency's LOWEST UNIT as a decimal
// string: "123.45" in USD means $1.2345, not $123.45. Getting this wrong
// overstates every figure by 100x, which would look plausible enough on a
// small bill to go unnoticed. Convert once, here, and nowhere else.
const CENTS_PER_DOLLAR = 100;

function corsHeaders(origin: string | null) {
  const allowed = (Deno.env.get("ALLOWED_ORIGIN") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ok = origin && allowed.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : allowed[0] ?? "null",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

/**
 * Walk every page of the cost report between two instants.
 *
 * Pagination is has_more/next_page rather than an offset, and the bucket
 * width is fixed at 1d by the API, so a three-month pull is ~90 buckets
 * and usually one or two pages. The cap is a runaway guard, not a limit
 * anyone should hit.
 */
async function fetchCostReport(
  adminKey: string,
  startingAt: string,
  endingAt: string,
): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  let page: string | null = null;

  for (let guard = 0; guard < 25; guard++) {
    const url = new URL(`${ADMIN_BASE}/cost_report`);
    url.searchParams.set("starting_at", startingAt);
    url.searchParams.set("ending_at", endingAt);
    url.searchParams.set("bucket_width", "1d");
    // Grouping by workspace is what makes per-product attribution possible
    // at all; without it every bucket collapses to one org-wide figure.
    url.searchParams.append("group_by[]", "workspace_id");
    if (page) url.searchParams.set("page", page);

    const res = await fetch(url, {
      headers: {
        "x-api-key": adminKey,
        "anthropic-version": "2023-06-01",
        // Documented courtesy so Anthropic can see what integrations exist.
        "user-agent": "profiscience-site/1.0 (cost-sync)",
      },
    });

    if (!res.ok) {
      throw new Error(`cost_report ${res.status}: ${(await res.text()).slice(0, 400)}`);
    }

    const body = await res.json();
    for (const bucket of body.data ?? []) {
      for (const item of bucket.results ?? []) {
        rows.push({ ...item, starting_at: bucket.starting_at });
      }
    }

    if (!body.has_more) return rows;
    page = body.next_page;
    if (!page) return rows;
  }

  console.warn("[sync-costs] hit the page guard — result may be truncated");
  return rows;
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "content-type": "application/json" },
    });

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // ---- authorise the caller, not the key ----
  // The admin key is ours; the right to trigger a sync is the editor's.
  // Verify the caller's Supabase session against is_editor() before doing
  // anything, so this endpoint is not an unauthenticated way to read the
  // organization's billing.
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorised" }, 401);

  const asCaller = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: isEditor, error: editorErr } = await asCaller.rpc("is_editor");
  if (editorErr || !isEditor) return json({ error: "forbidden" }, 403);

  const adminKey = Deno.env.get("ANTHROPIC_ADMIN_KEY");
  if (!adminKey) {
    return json(
      { error: "not_configured", detail: "ANTHROPIC_ADMIN_KEY is not set on this project." },
      501,
    );
  }

  // ---- work out the window ----
  let months = 3;
  try {
    const body = await req.json();
    if (Number.isFinite(body?.months)) months = Math.min(Math.max(1, body.months), 12);
  } catch {
    /* body is optional */
  }

  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const workspaceId = Deno.env.get("ANTHROPIC_WORKSPACE_ID")?.trim() || null;

  let rows: Array<Record<string, unknown>>;
  try {
    rows = await fetchCostReport(adminKey, start.toISOString(), end.toISOString());
  } catch (err) {
    console.error("[sync-costs]", err);
    return json({ error: "upstream", detail: String(err).slice(0, 400) }, 502);
  }

  // ---- fold daily buckets into months ----
  // `workspace_id` is null for the DEFAULT workspace, which is a value and
  // not a missing field — so a configured id must compare exactly, and an
  // unconfigured sync must take everything.
  const byMonth = new Map<string, number>();
  let matched = 0;

  for (const r of rows) {
    if (workspaceId && r.workspace_id !== workspaceId) continue;
    matched++;
    const month = String(r.starting_at).slice(0, 7) + "-01";
    const dollars = Number(r.amount) / CENTS_PER_DOLLAR;
    if (!Number.isFinite(dollars)) continue;
    byMonth.set(month, (byMonth.get(month) ?? 0) + dollars);
  }

  if (workspaceId && matched === 0 && rows.length > 0) {
    // Silently writing zeroes here would look like "the chat cost nothing"
    // rather than "the filter matched nothing". Fail loudly instead.
    return json(
      {
        error: "workspace_not_found",
        detail:
          `ANTHROPIC_WORKSPACE_ID=${workspaceId} matched none of ${rows.length} cost rows. ` +
          "Check the id, or unset it to record organization-wide spend.",
      },
      400,
    );
  }

  // ---- record ----
  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const upserts = [...byMonth.entries()].map(([month, usd]) => ({
    month,
    actual_usd: Number(usd.toFixed(2)),
    source: "admin_api",
    // Only a workspace filter makes this comparable to our chat-only
    // estimate. Org-wide totals are an upper bound and are flagged as such.
    key_isolated: Boolean(workspaceId),
    note: workspaceId
      ? `Admin API, workspace ${workspaceId}`
      : "Admin API, ORGANIZATION-WIDE — includes every workload on this account",
  }));

  if (upserts.length) {
    const { error } = await admin
      .from("chat_actual_costs")
      .upsert(upserts, { onConflict: "month" });
    if (error) {
      console.error("[sync-costs] upsert failed:", error.message);
      return json({ error: "write_failed", detail: error.message }, 500);
    }
  }

  return json({
    ok: true,
    months_written: upserts.length,
    workspace_scoped: Boolean(workspaceId),
    months: upserts.map((u) => ({ month: u.month, actual_usd: u.actual_usd })),
  });
});
