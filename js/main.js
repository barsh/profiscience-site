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
    { name: 'Akin Gump', url: 'assets/clients/akingump.png' },
    { name: 'Alberta Securities Commission', url: 'assets/clients/albertasecurities.png' },
    { name: 'Arnold & Block', url: 'assets/clients/arnoldblock.png' },
    { name: 'Baker Botts', url: 'assets/clients/bakerbotts.png' },
    { name: 'Baker Donelson', url: 'assets/clients/bakerdonelson.png' },
    { name: 'Balch & Bingham', url: 'assets/clients/balch.png' },
    { name: 'Bass Berry & Sims', url: 'assets/clients/Bass_Berry_Sims.jfif' },
    { name: 'Best Best & Krieger', url: 'assets/clients/bbk-logo.gif' },
    { name: 'Bilzin Sumberg', url: 'assets/clients/bilzin.gif' },
    { name: 'Bond, Schoeneck & King', url: 'assets/clients/Bond_Logo.jfif' },
    { name: 'Bracewell', url: 'assets/clients/bracewell.png' },
    { name: 'Bradley Arant', url: 'assets/clients/Bradley_Arant.png' },
    { name: 'Burns & Levinson', url: 'assets/clients/burns.PNG' },
    { name: 'Choate Hall & Stewart', url: 'assets/clients/choate.PNG' },
    { name: 'DLA Piper', url: 'assets/clients/dla.gif' },
    { name: 'Epstein Becker Green', url: 'assets/clients/epstein.gif' },
    { name: 'Eversheds Sutherland', url: 'assets/clients/Eversheds_Sutherland.png' },
    { name: 'Fish & Richardson', url: 'assets/clients/Fish_Richardson.png' },
    { name: 'Foley Hoag', url: 'assets/clients/foleyhoag.png' },
    { name: 'Fredrikson & Byron', url: 'assets/clients/freddrikosn.png' },
    { name: 'Gilbert + Tobin', url: 'assets/clients/Gilbert_Tobin.png' },
    { name: 'Godfrey & Kahn', url: 'assets/clients/Godfrey_Kahn.jfif' },
    { name: 'Goodwin', url: 'assets/clients/goodwin.png' },
    { name: 'Graydon', url: 'assets/clients/Graydon.png' },
    { name: 'Haynes Boone', url: 'assets/clients/Haynes_Boone.png' },
    { name: 'Hodgson Russ', url: 'assets/clients/hodgson.gif' },
    { name: 'Hogan Lovells', url: 'assets/clients/Hogan_Lovells.png' },
    { name: 'Irell & Manella', url: 'assets/clients/irell.png' },
    { name: 'Jackson Walker', url: 'assets/clients/Jackson_Walkier.png' },
    { name: 'JWS', url: 'assets/clients/jws.png' },
    { name: 'Kessler Collins', url: 'assets/clients/kessler.png' },
    { name: 'Lathrop GPM', url: 'assets/clients/lathrop.png' },
    { name: 'Littler Mendelson', url: 'assets/clients/littler.png' },
    { name: 'Loeb & Loeb', url: 'assets/clients/Loeb_Loeb.jfif' },
    { name: 'Lowenstein Sandler', url: 'assets/clients/lowenstein-logo.gif' },
    { name: 'Lowndes', url: 'assets/clients/lowndes.png' },
    { name: 'Maddocks', url: 'assets/clients/maddocks.jpg' },
    { name: 'Manatt, Phelps & Phillips', url: 'assets/clients/manatt-logo.png' },
    { name: 'McCabes', url: 'assets/clients/Mccabes.png' },
    { name: 'McGlinchey Stafford', url: 'assets/clients/Mcglinchey.png' },
    { name: 'Michael Best & Friedrich', url: 'assets/clients/Michael_Best.jfif' },
    { name: 'Munsch Hardt', url: 'assets/clients/Munsch_Hardt.jfif' },
    { name: 'Murtha Cullina', url: 'assets/clients/murtha.png' },
    { name: 'Neal Gerber Eisenberg', url: 'assets/clients/Neal_Gerber_Eisenberg.png' },
    { name: 'Nixon Peabody', url: 'assets/clients/nixon.png' },
    { name: 'Nutter', url: 'assets/clients/Nutter.png' },
    { name: 'O\'Melveny & Myers', url: 'assets/clients/om_logo-final.gif' },
    { name: 'Paul Hastings', url: 'assets/clients/paul.png' },
    { name: 'Perkins Coie', url: 'assets/clients/Perkins_Coie.png' },
    { name: 'Pillsbury Winthrop', url: 'assets/clients/pillsbury.jpg' },
    { name: 'Piper Sandler', url: 'assets/clients/piper.png' },
    { name: 'Pitcher Partners', url: 'assets/clients/pitcher.png' },
    { name: 'Robins Bradshaw', url: 'assets/clients/Robins_Bradshaw.png' },
    { name: 'Robins Kaplan', url: 'assets/clients/RobinsKaplan.png' },
    { name: 'Sandberg Phoenix', url: 'assets/clients/Sandberg_Phoenix.png' },
    { name: 'Schwabe', url: 'assets/clients/schwabe.jpg' },
    { name: 'Seyfarth Shaw', url: 'assets/clients/seyfarth.png' },
    { name: 'Sheppard Mullin', url: 'assets/clients/Sheppard_Mullin.png' },
    { name: 'Shook Hardy & Bacon', url: 'assets/clients/Shook_Hardy_Bacon.png' },
    { name: 'Shutts & Bowen', url: 'assets/clients/shutts.png' },
    { name: 'Sills Cummis & Gross', url: 'assets/clients/sills.PNG' },
    { name: 'Steptoe & Johnson', url: 'assets/clients/steptoe.png' },
    { name: 'Stikeman Elliott', url: 'assets/clients/Stikeman.png' },
    { name: 'Stinson', url: 'assets/clients/Stinson.png' },
    { name: 'Stites & Harbison', url: 'assets/clients/stites.png' },
    { name: 'Sullivan & Worcester', url: 'assets/clients/Sullivan_Worcester.png' },
    { name: 'Ulmer & Berne', url: 'assets/clients/Ulmer_Berne.png' },
    { name: 'Venable LLP', url: 'assets/clients/venable.gif' },
    { name: 'Verrill', url: 'assets/clients/verrill.png' },
    { name: 'Wachtell Lipton', url: 'assets/clients/watchell.PNG' },
    { name: 'Winstead', url: 'assets/clients/winstead.png' },
    { name: 'Womble Bond Dickinson', url: 'assets/clients/womble.png' },
    { name: 'Young Conaway', url: 'assets/clients/young.gif' },
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

  // --- Resources cards are rendered by js/resources.js (live from Supabase) ---

  // Auto-track CTA clicks
  document.querySelectorAll("[data-cta]").forEach((el) => {
    el.addEventListener("click", () => {
      track("cta_click", { cta: el.dataset.cta, label: el.textContent.trim() });
    });
  });

  // --- Lead forms: send submissions to the sales inbox ---
  // Interim (no backend yet): compose a pre-filled email to sales@.
  // To upgrade to real background delivery / CRM later, set LEAD_FORM_ENDPOINT
  // to a POST URL (Formspree, Web3Forms, or an Azure Function) — submissions
  // will POST there as JSON instead of opening a mail client.
  const LEAD_EMAIL = "sales@profiscience.com";
  const LEAD_FORM_ENDPOINT = ""; // e.g. "https://formspree.io/f/xxxxxxx"
  const fieldLabel = (k) => k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  document.querySelectorAll("form[data-track]").forEach((f) => {
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      const data = Object.fromEntries(fd.entries());
      track("form_submit", { form: f.dataset.track, ...data });

      const showSuccess = () => {
        const msg = f.querySelector(".form-success");
        if (msg) msg.style.display = "block";
        f.reset();
      };

      const isNewsletter = f.dataset.track === "newsletter";
      const who = data.first_name
        ? " — " + (data.first_name + " " + (data.last_name || "")).trim()
        : data.name ? " — " + data.name : "";
      const subject = (isNewsletter ? "Newsletter signup" : "Demo request") + who;

      if (LEAD_FORM_ENDPOINT) {
        fetch(LEAD_FORM_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ _subject: subject, form: f.dataset.track, to: LEAD_EMAIL, ...data }),
        }).then(showSuccess).catch(showSuccess);
      } else {
        const body = Object.keys(data).map((k) => fieldLabel(k) + ": " + data[k]).join("\n");
        window.location.href =
          "mailto:" + LEAD_EMAIL +
          "?subject=" + encodeURIComponent(subject) +
          "&body=" + encodeURIComponent(body);
        showSuccess();
      }
    });
  });

  // Fire page_view
  track("page_view");
  } // end init()

})();
