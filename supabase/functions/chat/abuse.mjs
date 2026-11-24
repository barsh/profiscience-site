/* =========================================================
   Chat abuse policy — pure decisions, no I/O.
   ---------------------------------------------------------
   The Edge Function enforces these. They live here so they can be
   tested with node, without Deno, Supabase, or the model.

   Counts come from chat_transcripts, not from the transcript the
   browser replays. A script can omit history, resend the same window,
   or mint a new session id; the stored rows are the only record that
   survives that.
   ========================================================= */

export const DEFAULTS = {
  // A normal lead conversation is a handful of turns. 24 is enough for
  // someone working through a rollout and still ends a scripted loop
  // before it becomes an open-ended model session.
  maxSessionTurns: 24,
  // The Nth identical (or near-identical) visitor message ends the
  // session. 3 allows one retry — a failed send, a double-tap — and
  // stops the "Reply with PONG only" pattern on the next copy.
  repeatLimit: 3,
  // "yes" / "ok" / "thanks" are allowed to repeat. Only substantive
  // messages count, which is what the scripted probes are.
  repeatMinChars: 12,
  nearDuplicateRatio: 0.92,
  // Four gaps in a row under this, including model time, is not a
  // person reading the reply. A single quick follow-up is not enough.
  fastTurnMs: 1200,
  fastTurnStreak: 4,
  // Adaptive thinking shares this budget with the visible reply. 1024
  // is already a short cap (the API default is far higher) and is
  // enough for a few sentences plus thinking. Lower it only if empty
  // replies start showing up.
  maxOutputTokens: 1024,
  // Message ceilings. The SQL function has the same numbers as defaults
  // so a hand-run check matches the function. The Edge Function passes
  // them explicitly, and env vars override there.
  perMinuteIp: 10,
  perMinuteSession: 10,
  perDayIp: 40,
  perDayGlobal: 150,
  // Page loads mint a new session id, but a conversation is only counted
  // when a message is sent. 12 covers a visitor who refreshes and asks
  // something else several times in a day, and stops a script rotating
  // session ids on one address.
  conversationsPerDayIp: 12,
};

export const TURN_CAP_REPLY =
  "That's as far as I can take a conversation in this chat. If you'd like a walkthrough of UniversitySite or CLESite, email sales@profiscience.com or use the contact page and a specialist will follow up.";

export const REPEAT_REPLY =
  "I'm going to stop this chat here. I can help with questions about UniversitySite and CLESite, and a person is the right next step — email sales@profiscience.com or use the contact page and someone will follow up.";

export const FAST_REPLY =
  "I'm going to pause this chat here. If you have a question about UniversitySite or CLESite, email sales@profiscience.com or use the contact page and someone will follow up.";

const REPLIES = {
  abuse_turn_cap: TURN_CAP_REPLY,
  abuse_repeat: REPEAT_REPLY,
  abuse_fast: FAST_REPLY,
};

function withLimits(limits) {
  const cfg = { ...DEFAULTS };
  if (limits) {
    for (const [key, value] of Object.entries(limits)) {
      if (value != null) cfg[key] = value;
    }
  }
  return cfg;
}

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalizeMessage(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[b.length];
}

/**
 * 1 when the normalized texts are the same, otherwise 1 - edit distance
 * over the longer length. Capped so a huge pasted message can't turn the
 * check into a quadratic tax; past the cap, only an exact normalized
 * match (handled by the caller) counts.
 */
export function similarity(a, b) {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (!maxLen) return 1;
  if (maxLen > 500) return 0;
  const room = maxLen - Math.min(a.length, b.length);
  if (room / maxLen > 1 - DEFAULTS.nearDuplicateRatio) return 0;
  return 1 - levenshtein(a, b) / maxLen;
}

export function isNearDuplicate(a, b, limits) {
  const cfg = withLimits(limits);
  const na = normalizeMessage(a);
  const nb = normalizeMessage(b);
  if (na.length < cfg.repeatMinChars || nb.length < cfg.repeatMinChars) return false;
  if (na === nb) return true;
  return similarity(na, nb) >= cfg.nearDuplicateRatio;
}

/**
 * How many times this message has been seen, counting itself.
 * Short acknowledgements return 0 so they can never trip the limit.
 */
export function repeatCount(message, priorQuestions, limits) {
  const cfg = withLimits(limits);
  if (normalizeMessage(message).length < cfg.repeatMinChars) return 0;
  let n = 1;
  for (const question of priorQuestions || []) {
    if (isNearDuplicate(message, question, cfg)) n += 1;
  }
  return n;
}

/**
 * True when the last `streak` gaps, ending at `now`, are each shorter
 * than `gapMs`. `priorTimes` is oldest-first. A negative gap (clock
 * skew) does not count as fast.
 */
export function isFastStreak(priorTimes, now, gapMs, streak) {
  const times = [];
  for (const value of priorTimes || []) {
    const ms = typeof value === "number" ? value : Date.parse(value);
    if (Number.isFinite(ms)) times.push(ms);
  }
  const nowMs = typeof now === "number" ? now : Date.parse(now);
  if (!Number.isFinite(nowMs)) return false;
  times.push(nowMs);
  if (times.length < streak + 1) return false;
  const window = times.slice(-(streak + 1));
  for (let i = 1; i < window.length; i++) {
    const gap = window[i] - window[i - 1];
    if (gap < 0 || gap >= gapMs) return false;
  }
  return true;
}

function block(reason, log) {
  return {
    block: true,
    reason,
    reply: REPLIES[reason],
    log,
    closed: true,
  };
}

/**
 * Whether this message may be sent to the model.
 *
 * `prior` is recent stored turns, oldest first, including stop_reason.
 * `totalTurns` is the full stored count, which may be larger than
 * `prior` when the read is windowed.
 */
export function assessSession({ message, prior, totalTurns, now, limits } = {}) {
  const cfg = withLimits(limits);
  const rows = Array.isArray(prior) ? prior : [];
  const turns = Number.isFinite(totalTurns) ? totalTurns : rows.length;

  const already = rows.find(
    (row) => typeof row?.stop_reason === "string" && row.stop_reason.startsWith("abuse_"),
  );
  if (already && REPLIES[already.stop_reason]) {
    return block(already.stop_reason, false);
  }

  if (turns >= cfg.maxSessionTurns) {
    return block("abuse_turn_cap", true);
  }

  const questions = rows.map((row) => row?.question ?? "");
  if (repeatCount(message, questions, cfg) >= cfg.repeatLimit) {
    return block("abuse_repeat", true);
  }

  if (
    isFastStreak(
      rows.map((row) => row?.created_at),
      now ?? Date.now(),
      cfg.fastTurnMs,
      cfg.fastTurnStreak,
    )
  ) {
    return block("abuse_fast", true);
  }

  return { block: false };
}

/**
 * Visitor-facing copy for a quota refusal. Daily limits are not
 * something waiting will fix; burst limits are.
 */
export function quotaReply(reason) {
  switch (reason) {
    case "global_daily":
    case "quota_unavailable":
      return "Chat is unavailable right now. Email sales@profiscience.com and someone will pick it up.";
    case "ip_daily":
    case "conversations_daily":
      return "You've reached today's limit for this chat. Email sales@profiscience.com and someone will follow up.";
    default:
      return "You're sending messages faster than I can answer — give it a moment.";
  }
}

/** Daily ceilings should lock the composer. A burst clears in a minute. */
export function quotaClosesComposer(reason) {
  return reason === "ip_daily" || reason === "conversations_daily" || reason === "global_daily";
}

/**
 * The admin warning used to compare cache-write dollars to cache-read
 * dollars. A 1-hour write is billed at 20× a read, and the first turn of
 * a session is always a write, so a healthy month of short chats tripped
 * it constantly.
 *
 * The signal that the prefix is actually being invalidated is a follow-up
 * turn — the second message of a conversation, which should read the
 * prefix — writing more cached tokens than it reads. Months with no
 * multi-turn traffic stay quiet.
 */
export function cachePrefixLooksInvalidated(month) {
  if (!month) return false;
  if (month.followup_cache_write_tokens == null && month.followup_cache_read_tokens == null) {
    return false;
  }
  const written = Number(month.followup_cache_write_tokens) || 0;
  const read = Number(month.followup_cache_read_tokens) || 0;
  if (written === 0 && read === 0) return false;
  return written > read;
}
