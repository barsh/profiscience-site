/* =========================================================
   Profiscience chat widget
   ---------------------------------------------------------
   Front end for the agent in supabase/functions/chat. Keeps the
   transcript in memory, posts it to the Edge Function, renders the
   reply. No keys live here — the browser only ever sees the public
   function URL, and all the credentials stay server-side.

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

  // Served from localhost? Talk to `supabase functions serve` instead.
  // Without this the widget silently hits production even while a local
  // function is running, so you end up testing the deployed agent and
  // concluding your changes did nothing. The hostname check means this can
  // never affect a real visitor, and there is nothing to remember to revert
  // before deploying.
  var IS_LOCAL =
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    location.hostname === "[::1]";

  var CHAT_ENDPOINT = IS_LOCAL
    ? "http://localhost:54321/functions/v1/chat"
    : PROD_ENDPOINT;

  var MAX_TURNS = 24; // trim client-side too; the server enforces its own cap

  // Groups this conversation's turns together in the transcript table so a
  // reviewer can read an exchange in order. Deliberately NOT an identity:
  // generated per page load, never stored, never sent anywhere else, and
  // not tied to the visitor or their IP. A refresh starts a new one, which
  // is the intended trade — grouping for review, not tracking.
  var SESSION_ID = (function () {
    try {
      if (window.crypto && window.crypto.randomUUID) {
        return window.crypto.randomUUID();
      }
    } catch (e) {
      /* fall through to the non-crypto id below */
    }
    return "s-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  })();

  function init() {
    var launcher = document.querySelector(".bot-launcher");
    var panel = document.querySelector(".bot-panel");
    if (!launcher || !panel) return;

    var body = panel.querySelector(".bot-body");
    var form = panel.querySelector(".bot-foot");
    var input = form.querySelector("input");
    var sendBtn = form.querySelector("button");
    var closeBtn = panel.querySelector(".bot-close");
    var chatBadges = document.querySelectorAll(".ai-powered-badge");

    // Transcript sent to the model. The greeting in the markup is
    // presentational only — it is deliberately not in here, so the model
    // isn't told it already said something it didn't.
    var history = [];
    var busy = false;
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
      // Re-focusing after a reply is right when the visitor is still typing,
      // but on a phone it drags the keyboard back over the answer they were
      // waiting to read. Only take focus back if it was never given up.
      if (!state && (!phoneSheet.matches || wasFocused)) input.focus();
    }

    function open() {
      panel.classList.add("open");
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
      input.value = "";
      setBusy(true);

      var typing = showTyping();
      if (window.pfTrack) window.pfTrack("chat_message_sent");

      fetch(CHAT_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history, session_id: SESSION_ID }),
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
          if (res.ok) history.push({ role: "assistant", content: reply });
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
