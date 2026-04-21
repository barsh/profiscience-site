/* =========================================================
   Profiscience — shared JS
   - Partial injection (header / footer)
   - Active nav link detection
   - Mobile nav toggle
   - Scroll reveal (IntersectionObserver)
   - Animated counters
   - Questions bot widget (demo stub)
   - Lightweight event tracker scaffold for CRM/CMS
   ========================================================= */

(function () {
  "use strict";

  // --- Lightweight tracker scaffold ---
  window.pfTrack = function track(event, data) {
    data = data || {};
    var payload = Object.assign(
      { event: event, ts: new Date().toISOString(), page: location.pathname },
      data
    );
    if (window.__pfDebug) console.log("[pfTrack]", payload);
  };
  var track = window.pfTrack;

  // --- Partial injection ---
  function loadPartial(url, targetId) {
    return fetch(url)
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var el = document.getElementById(targetId);
        if (el) el.outerHTML = html;
      });
  }

  var base = "./";

  Promise.all([
    loadPartial(base + "partials/header.html", "site-header"),
    loadPartial(base + "partials/footer.html", "site-footer"),
  ]).then(function () {
    var el = document.getElementById("footer-year");
    if (el) el.textContent = new Date().getFullYear();
    setActiveNav();
    init();
  });

  function setActiveNav() {
    var raw = location.pathname.split("/").pop() || "index.html";
    // normalise: add .html if missing (some servers strip the extension)
    var page = raw.includes(".") ? raw : (raw === "" ? "index.html" : raw + ".html");
    document.querySelectorAll(".nav-links a").forEach(function (a) {
      var href = a.getAttribute("href").split("#")[0];
      if (href === page) a.classList.add("active");
    });
  }

  function init() {
  // --- Mobile nav ---
  const nav = document.querySelector(".nav");
  const toggle = document.querySelector(".nav-toggle");
  if (toggle && nav) {
    toggle.addEventListener("click", () => nav.classList.toggle("open"));
  }

  // --- Scroll reveal ---
  const revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("in"));
  }

  // --- Animated counters ---
  const counters = document.querySelectorAll("[data-count]");
  const animateCount = (el) => {
    const target = parseFloat(el.dataset.count);
    const suffix = el.dataset.suffix || "";
    const duration = 1600;
    const start = performance.now();
    const startVal = 0;
    const step = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = startVal + (target - startVal) * eased;
      el.textContent =
        (target % 1 === 0 ? Math.round(v).toLocaleString() : v.toFixed(1)) +
        suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  if ("IntersectionObserver" in window) {
    const cio = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            animateCount(e.target);
            cio.unobserve(e.target);
          }
        });
      },
      { threshold: 0.5 }
    );
    counters.forEach((el) => cio.observe(el));
  }

  // --- Questions bot widget ---
  // (Front-end only demo. Wire to your real AI endpoint in production.)
  const launcher = document.querySelector(".bot-launcher");
  const panel = document.querySelector(".bot-panel");
  if (launcher && panel) {
    launcher.addEventListener("click", () => {
      panel.classList.toggle("open");
      track("bot_toggled", { open: panel.classList.contains("open") });
    });
    const form = panel.querySelector(".bot-foot");
    const input = panel.querySelector("input");
    const body = panel.querySelector(".bot-body");
    const canned = {
      pricing:
        "Profiscience pricing scales with seats and modules. A specialist will reach out — or you can request a demo anytime.",
      demo:
        "Happy to set up a demo. Head to the Contact page or drop your email and we'll reach out.",
      cle:
        "Yes — our CLE add-ons handle accreditation tracking, attorney reporting, and state-specific credit rules out of the box.",
      ai:
        "Our AI Knowledge Check builder can turn any uploaded video into a validated assessment in minutes. No authoring required.",
    };
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      const userMsg = document.createElement("div");
      userMsg.className = "bot-msg user";
      userMsg.textContent = q;
      body.appendChild(userMsg);
      input.value = "";
      body.scrollTop = body.scrollHeight;
      track("bot_asked", { q });

      setTimeout(() => {
        const lc = q.toLowerCase();
        let answer =
          "Great question — a specialist can answer that in detail. Want me to route you to someone on the team?";
        for (const k of Object.keys(canned)) {
          if (lc.includes(k)) {
            answer = canned[k];
            break;
          }
        }
        const botMsg = document.createElement("div");
        botMsg.className = "bot-msg bot";
        botMsg.textContent = answer;
        body.appendChild(botMsg);
        body.scrollTop = body.scrollHeight;
      }, 650);
    });
  }

  // --- Logo ticker ---
  const TICKER_LOGOS = [
    { name: 'Arnold & Block',        url: 'https://www.profiscience.com/Images/Default/Clients/arnoldblock.png' },
    { name: 'Steptoe & Johnson',     url: 'https://www.profiscience.com/Images/Default/Clients/steptoe.png' },
    { name: 'Verrill',               url: 'https://www.profiscience.com/Images/Default/Clients/verrill.png' },
    { name: 'Womble Bond Dickinson', url: 'https://www.profiscience.com/Images/Default/Clients/womble.png' },
    { name: 'Choate Hall & Stewart', url: 'https://www.profiscience.com/Images/Default/Clients/choate.PNG' },
    { name: 'Hodgson Russ',          url: 'https://www.profiscience.com/Images/Default/Clients/hodgson.gif' },
    { name: 'Manatt',                url: 'https://www.profiscience.com/Images/Default/Clients/manatt-logo.png' },
    { name: 'McGlinchey Stafford',   url: 'https://www.profiscience.com/Images/Default/Clients/Mcglinchey.png' },
    { name: 'Robins Bradshaw',       url: 'https://www.profiscience.com/Images/Default/Clients/Robins%20Bradshaw.png' },
    { name: 'Venable LLP',           url: 'https://www.profiscience.com/Images/Default/Clients/venable.gif' },
    { name: 'Wachtell Lipton',       url: 'https://www.profiscience.com/Images/Default/Clients/watchell.PNG' },
    { name: 'JWS',                   url: 'https://www.profiscience.com/Images/Default/Clients/jws.png' },
  ];
  const TICKER_SLOTS = 5;
  const tickerEl = document.getElementById('logoTicker');
  if (tickerEl) {
    // Shuffle so first view feels random
    const pool = [...TICKER_LOGOS].sort(() => Math.random() - 0.5);
    const slots = [];
    let poolIdx = 0;
    // Build slots
    for (let i = 0; i < TICKER_SLOTS; i++) {
      const slot = document.createElement('div');
      slot.className = 'logo-slot';
      const inner = document.createElement('div');
      inner.className = 'ls-inner';
      const img = document.createElement('img');
      const logo = pool[poolIdx++ % pool.length];
      img.src = logo.url;
      img.alt = logo.name;
      inner.appendChild(img);
      slot.appendChild(inner);
      tickerEl.appendChild(slot);
      slots.push({ el: slot, inner });
    }
    let swapIdx = 0;
    setInterval(() => {
      const s = slots[swapIdx];
      const oldInner = s.inner;
      const logo = pool[poolIdx++ % pool.length];
      // New inner starts below
      const newInner = document.createElement('div');
      newInner.className = 'ls-inner enter-below';
      const newImg = document.createElement('img');
      newImg.src = logo.url;
      newImg.alt = logo.name;
      newInner.appendChild(newImg);
      s.el.appendChild(newInner);
      // Force reflow so transition fires
      newInner.getBoundingClientRect();
      // Exit old up, enter new
      oldInner.classList.add('exit-up');
      newInner.classList.remove('enter-below');
      s.inner = newInner;
      setTimeout(() => oldInner.remove(), 500);
      swapIdx = (swapIdx + 1) % TICKER_SLOTS;
    }, 1800);
  }

  // Auto-track CTA clicks
  document.querySelectorAll("[data-cta]").forEach((el) => {
    el.addEventListener("click", () => {
      track("cta_click", { cta: el.dataset.cta, label: el.textContent.trim() });
    });
  });

  // Auto-track form submits
  document.querySelectorAll("form[data-track]").forEach((f) => {
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      const data = Object.fromEntries(fd.entries());
      track("form_submit", { form: f.dataset.track, ...data });
      const msg = f.querySelector(".form-success");
      if (msg) msg.style.display = "block";
      f.reset();
    });
  });

  // Fire page_view
  track("page_view");
  } // end init()

})();
