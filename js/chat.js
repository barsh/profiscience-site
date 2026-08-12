/* =========================================================
   Profiscience chat widget
   ---------------------------------------------------------
   Front end for the agent in supabase/functions/chat. Keeps the
   transcript in localStorage, posts it to the Edge Function, renders
   the reply. No keys live here — the browser only ever sees the public
   function URL, and all the credentials stay server-side.

   The server is stateless: it answers from whatever history the client
   replays. So "remember the conversation" is entirely a client-side
   question, and the answer is localStorage — it survives a refresh, a
   navigation to another page on the origin, and closing the tab
   overnight, which sessionStorage does not.

   Loaded by every page via <script src="js/chat.js" defer>; the
   markup it drives is injected with the footer partial, so setup
   waits for that to land.
   ========================================================= */

(function () {
  "use strict";

  // The deployed Edge Function. Public by design — it is an endpoint, not
  // a credential; every secret stays server-side. Access is controlled by
  // the CORS allow-list and the quota check, not by hiding this URL.
  var PROD_ENDPOINT = "https://rqkbjvyxhdknbjhaszya.supabase.co/functions/v1/chat";

  // Served from localhost? Talk to the locally running function instead.
  // Without this the widget silently hits production even while a local
  // function is running, so you end up testing the deployed agent and
  // concluding your changes did nothing. The hostname check means this can
  // never affect a real visitor, and there is nothing to remember to revert
  // before deploying.
  var IS_LOCAL =
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    location.hostname === "[::1]";

  // Port 8000 is where the README's local workflow puts it — `deno run` on
  // the function directly, no Docker. This used to point at 54321, the
  // `supabase functions serve` port, which meant following the documented
  // steps still left the widget unable to reach anything: the fetch failed
  // and the panel blamed the visitor's connection. If you do run it through
  // `supabase functions serve`, change this to
  // http://localhost:54321/functions/v1/chat.
  var CHAT_ENDPOINT = IS_LOCAL ? "http://localhost:8000" : PROD_ENDPOINT;

  var MAX_TURNS = 24; // trim client-side too; the server enforces its own cap

  var STORAGE_KEY = "pf-chat";
  var STORAGE_VERSION = 1;

  // How long a dormant conversation is kept. Long enough that "I'll come
  // back to this tomorrow" works, short enough that a shared machine in a
  // firm's library isn't holding someone's exchange indefinitely. Idle
  // time, not age: every message pushes the expiry out.
  var MAX_IDLE_MS = 30 * 24 * 60 * 60 * 1000;

  // localStorage throws on access — not just on write — in Safari's private
  // mode and wherever site data is blocked. Probe once, and treat "no
  // storage" as a supported configuration: the widget then behaves exactly
  // as it did before persistence existed rather than breaking.
  var store = (function () {
    try {
      var ls = window.localStorage;
      ls.setItem(STORAGE_KEY + "-probe", "1");
      ls.removeItem(STORAGE_KEY + "-probe");
      return ls;
    } catch (e) {
      return null;
    }
  })();

  // Groups this conversation's turns together in the transcript table so a
  // reviewer can read an exchange in order.
  //
  // This is now persisted alongside the transcript, so it outlives a page
  // load — that is the point, since a resumed conversation logging under a
  // fresh id would land in the admin as unrelated fragments. It is still
  // not an identity: it is generated in the browser, never tied to the
  // visitor or their IP, cleared by "New chat" or by clearing site data,
  // and expires with the conversation.
  function newSessionId() {
    try {
      if (window.crypto && window.crypto.randomUUID) {
        return window.crypto.randomUUID();
      }
    } catch (e) {
      /* fall through to the non-crypto id below */
    }
    return "s-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function isMessage(m) {
    return (
      m &&
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string" &&
      m.content.trim().length > 0
    );
  }

  /**
   * Read the saved conversation, or null for "start fresh".
   *
   * Everything here is defensive. The payload is ours, but it is sitting in
   * a store the visitor and any other script on the origin can edit, it may
   * have been written by an older version of this file, and a half-written
   * value survives a crash. A malformed record is dropped, never repaired:
   * the cost is one lost conversation, and the alternative is shipping junk
   * into the model's history.
   */
  function loadSaved() {
    if (!store) return null;
    var raw;
    try {
      raw = store.getItem(STORAGE_KEY);
    } catch (e) {
      return null;
    }
    if (!raw) return null;

    var saved;
    try {
      saved = JSON.parse(raw);
    } catch (e) {
      clearSaved();
      return null;
    }

    if (
      !saved ||
      saved.v !== STORAGE_VERSION ||
      typeof saved.id !== "string" ||
      !saved.id ||
      typeof saved.at !== "number" ||
      !Array.isArray(saved.msgs)
    ) {
      clearSaved();
      return null;
    }

    if (Date.now() - saved.at > MAX_IDLE_MS) {
      clearSaved();
      return null;
    }

    var msgs = saved.msgs.filter(isMessage).slice(-MAX_TURNS);
    if (!msgs.length) {
      clearSaved();
      return null;
    }

    return {
      id: saved.id.slice(0, 64),
      // The running count of visitor messages, used for transcript ordering.
      // Trust it only as a number that is at least as large as what we can
      // see, so a tampered or absent value can't renumber history backwards.
      turn: typeof saved.turn === "number" && saved.turn >= 0
        ? Math.floor(saved.turn)
        : msgs.filter(function (m) { return m.role === "user"; }).length,
      msgs: msgs,
    };
  }

  function clearSaved() {
    if (!store) return;
    try {
      store.removeItem(STORAGE_KEY);
    } catch (e) {
      /* nothing useful to do — the next load validates whatever is there */
    }
  }

  function init() {
    var launcher = document.querySelector(".bot-launcher");
    var panel = document.querySelector(".bot-panel");
    if (!launcher || !panel) return;

    var body = panel.querySelector(".bot-body");
    var form = panel.querySelector(".bot-foot");
    var input = form.querySelector("input");
    var sendBtn = form.querySelector("button");
    var closeBtn = panel.querySelector(".bot-close");
    var resetBtn = panel.querySelector(".bot-reset");
    var chatBadges = document.querySelectorAll(".ai-powered-badge");

    // Transcript sent to the model. The greeting in the markup is
    // presentational only — it is deliberately not in here, so the model
    // isn't told it already said something it didn't.
    var history = [];
    var busy = false;

    var saved = loadSaved();
    var sessionId = saved ? saved.id : newSessionId();
    // Counts visitor messages across the whole conversation, including the
    // ones already trimmed out of `history`. The server used to derive this
    // by counting the replayed history, which silently stops incrementing
    // once a conversation is longer than MAX_TURNS — rare when a refresh
    // reset everything, routine now that conversations resume.
    var turn = saved ? saved.turn : 0;

    // The greeting bubble as authored in partials/footer.html, captured
    // before a restore appends to it. "New chat" puts this back, so the
    // panel returns to its first-visit state rather than an empty box.
    var greetingHTML = body.innerHTML;
    // Whether the visitor still had the field focused when a request began —
    // disabling an input blurs it, so it has to be captured before that.
    var wasFocused = false;

    // Matches the sheet breakpoint in styles.css. Read per call so a rotation
    // is picked up without re-binding.
    var phoneSheet = window.matchMedia("(max-width: 600px)");

    function scroll() {
      body.scrollTop = body.scrollHeight;
    }

    function addMessage(text, kind) {
      var el = document.createElement("div");
      el.className = "bot-msg " + kind;
      // textContent, never innerHTML: this string comes from a model
      // responding to attacker-controllable input.
      el.textContent = text;
      body.appendChild(el);
      scroll();
      return el;
    }

    // Marks where a resumed conversation starts, so someone returning to an
    // already-populated panel understands why. Without it, a week-old
    // exchange just looks like the widget replying to nothing.
    function addDivider(text) {
      var el = document.createElement("div");
      el.className = "bot-divider";
      el.setAttribute("role", "separator");
      el.textContent = text;
      body.appendChild(el);
    }

    /**
     * Persist the conversation. Called after every message — the visitor's
     * as well as the model's — because the interesting failure is a refresh
     * mid-request, and only the write that already happened survives it.
     */
    function save() {
      if (!store) return;
      try {
        store.setItem(
          STORAGE_KEY,
          JSON.stringify({
            v: STORAGE_VERSION,
            id: sessionId,
            turn: turn,
            at: Date.now(),
            msgs: history,
          })
        );
      } catch (e) {
        // Full quota, or site data revoked mid-session. The conversation
        // carries on in memory; only its persistence is lost, and there is
        // nothing to tell the visitor about that.
      }
    }

    // Nothing to reset before the first message, and an always-visible
    // control in a small header is clutter.
    function syncResetBtn() {
      if (resetBtn) resetBtn.hidden = history.length === 0;
    }

    /**
     * Start over: new transcript, new session id, saved copy dropped.
     *
     * This is the counterweight to persisting anything. A visitor on a
     * shared machine needs one obvious way to remove what they typed, and
     * the new session id means the next exchange is logged as a genuinely
     * separate conversation rather than appended to the one they discarded.
     */
    function reset() {
      history = [];
      turn = 0;
      sessionId = newSessionId();
      clearSaved();
      // Back to exactly the markup the page shipped with — the greeting,
      // captured before anything was restored into the log.
      body.innerHTML = greetingHTML;
      syncResetBtn();
      if (!phoneSheet.matches) input.focus();
    }

    function showTyping() {
      var el = document.createElement("div");
      el.className = "bot-typing";
      el.setAttribute("aria-label", "Assistant is typing");
      el.innerHTML = "<span></span><span></span><span></span>";
      body.appendChild(el);
      scroll();
      return el;
    }

    function setBusy(state) {
      if (state) wasFocused = document.activeElement === input;
      busy = state;
      input.disabled = state;
      sendBtn.disabled = state;
      // Resetting mid-flight would drop the pending reply into a transcript
      // it doesn't belong to, so the control is unavailable until it lands.
      if (resetBtn) resetBtn.disabled = state;
      // Re-focusing after a reply is right when the visitor is still typing,
      // but on a phone it drags the keyboard back over the answer they were
      // waiting to read. Only take focus back if it was never given up.
      if (!state && (!phoneSheet.matches || wasFocused)) input.focus();
    }

    function open() {
      panel.classList.add("open");
      // A restored conversation is rendered into a panel that is still
      // display:none, where scrollHeight is 0 and the scroll in addMessage
      // does nothing. Without this, opening it lands on the greeting from
      // last week instead of the last thing that was said.
      scroll();
      // The class drives the scroll lock and hides the launcher, both of
      // which only apply at phone widths — the CSS scopes them, not this.
      document.body.classList.add("bot-open");
      // Autofocus opens the on-screen keyboard, which on a phone covers half
      // the sheet before the visitor has read a word of it. Let them tap the
      // field when they are ready; on desktop a focused input costs nothing.
      if (!phoneSheet.matches) input.focus();
      if (window.pfTrack) window.pfTrack("chat_opened");
    }

    function close() {
      panel.classList.remove("open");
      document.body.classList.remove("bot-open");
      launcher.focus();
    }

    launcher.addEventListener("click", function () {
      if (panel.classList.contains("open")) close();
      else open();
    });

    Array.prototype.forEach.call(chatBadges, function (badge) {
      badge.addEventListener("click", function () {
        if (!panel.classList.contains("open")) open();
        else input.focus();
      });
      badge.addEventListener("keydown", function (e) {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        if (!panel.classList.contains("open")) open();
        else input.focus();
      });
    });

    if (closeBtn) closeBtn.addEventListener("click", close);

    if (resetBtn) {
      resetBtn.addEventListener("click", function () {
        // Mid-request: the in-flight reply would otherwise land in the fresh
        // transcript and be saved into it.
        if (busy) return;
        reset();
        if (window.pfTrack) window.pfTrack("chat_reset");
      });
    }

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && panel.classList.contains("open")) close();
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (busy) return;

      var question = input.value.trim();
      if (!question) return;

      if (!CHAT_ENDPOINT) {
        addMessage(
          "Profiscience AI isn't configured yet. Email sales@profiscience.com and someone will help.",
          "error"
        );
        input.value = "";
        return;
      }

      addMessage(question, "user");
      history.push({ role: "user", content: question });
      if (history.length > MAX_TURNS) history = history.slice(-MAX_TURNS);
      turn++;
      save();
      syncResetBtn();
      input.value = "";
      setBusy(true);

      var typing = showTyping();
      if (window.pfTrack) window.pfTrack("chat_message_sent");

      fetch(CHAT_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: history,
          session_id: sessionId,
          turn: turn,
        }),
      })
        .then(function (r) {
          // A 429 or 502 still carries a usable body, so parse either way
          // and let the payload decide what the visitor sees.
          return r.json().then(function (data) {
            return { ok: r.ok, status: r.status, data: data };
          });
        })
        .then(function (res) {
          typing.remove();

          // The server distinguishes "slow down" from "closed for the day",
          // so prefer its wording over a generic one.
          if (res.status === 429) {
            addMessage(
              (res.data && res.data.reply) ||
                "You're sending messages faster than I can answer — give it a moment.",
              "error"
            );
            return;
          }

          var reply = res.data && res.data.reply;
          if (!reply) {
            addMessage(
              "Something went wrong on my end. Email sales@profiscience.com and someone will pick it up.",
              "error"
            );
            return;
          }

          addMessage(reply, "bot");
          // Only record turns the model actually produced, so the history
          // we replay matches what it believes it said.
          if (res.ok) {
            history.push({ role: "assistant", content: reply });
            if (history.length > MAX_TURNS) history = history.slice(-MAX_TURNS);
            save();
          }
        })
        .catch(function () {
          typing.remove();
          addMessage(
            "I couldn't reach the server. Check your connection, or email sales@profiscience.com.",
            "error"
          );
        })
        .finally(function () {
          setBusy(false);
        });
    });

    // Replay the saved conversation into both the log and the history the
    // model sees, so the panel a returning visitor opens and the transcript
    // the server is sent are the same conversation.
    if (saved) {
      addDivider("Picking up where you left off");
      saved.msgs.forEach(function (m) {
        history.push({ role: m.role, content: m.content });
        addMessage(m.content, m.role === "user" ? "user" : "bot");
      });
    }
    syncResetBtn();

    // Setup is finished, restore included. Because the markup arrives with
    // the footer partial and this file polls for it, "the panel exists" is
    // not "the panel is live" — anything waiting on the widget (a browser
    // test, another script) needs a signal for the difference.
    panel.setAttribute("data-ready", "");
  }

  // The launcher ships inside partials/footer.html, which main.js injects
  // asynchronously — poll briefly rather than race it.
  function waitForMarkup(attempts) {
    if (document.querySelector(".bot-launcher")) return init();
    if (attempts <= 0) return;
    setTimeout(function () {
      waitForMarkup(attempts - 1);
    }, 100);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      waitForMarkup(50);
    });
  } else {
    waitForMarkup(50);
  }
})();
