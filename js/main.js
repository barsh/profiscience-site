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

  // --- Leadfeeder / Dealfront visitor tracking ---
  // Identifies visiting companies and feeds Pipedrive. Same tracker the old
  // ASP.NET site used (MasterPage.master). Loaded once here so it applies to
  // every page without repeating the snippet in 16 HTML files.
  (function (ss, s, d) {
    var lf = function () {
      var sc = d.createElement(s);
      sc.async = true;
      sc.src = ss;
      var fs = d.getElementsByTagName(s)[0];
      fs.parentNode.insertBefore(sc, fs);
    };
    lf();
  })("https://sc.lfeeder.com/lftracker_v1_DzLR5a50zgn4BoQ2.js", "script", document);

  // --- Chat ---
  // Our own agent now (js/chat.js → supabase/functions/chat), not Pipedrive
  // LeadBooster. Free-text in, routed to lead capture or support without
  // manufacturing a CRM record for people who just need help.

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
    // Compare without the .html extension so active state works for the site’s
    // extensionless URLs.
    var page = (location.pathname.split("/").pop() || "").replace(/\.html$/, "");
    // Only the top-level link gets the underline — dropdown entries share the
    // same base href and would all light up otherwise.
    document.querySelectorAll(".nav-item > a, .nav-links > a").forEach(function (a) {
      var href = a.getAttribute("href").split("#")[0].replace(/\.html$/, "");
      if (href && href === page) a.classList.add("active");
    });
  }

  function init() {
  initSectionNavigation();

  // --- Mobile nav ---
  const nav = document.querySelector(".nav");
  const toggle = document.querySelector(".nav-toggle");
  if (toggle && nav) {
    toggle.addEventListener("click", () => nav.classList.toggle("open"));
  }

  // --- Section dropdowns ---
  // Desktop opens them on hover (CSS). The caret is for touch/keyboard, where
  // hover never fires: it toggles the panel instead of following the link.
  //
  // Matches the 960px breakpoint in styles.css where .nav-links becomes the
  // mobile sheet. Read per click rather than cached, so a rotation or a
  // resize is picked up without re-binding anything.
  const mobileNav = window.matchMedia("(max-width: 960px)");

  function closeDropdowns() {
    document.querySelectorAll(".nav-item.open").forEach((o) => {
      o.classList.remove("open");
      const c = o.querySelector(".nav-caret");
      if (c) c.setAttribute("aria-expanded", "false");
    });
  }

  function toggleDropdown(item) {
    const caret = item.querySelector(".nav-caret");
    const open = !item.classList.contains("open");
    // One panel at a time so the mobile sheet doesn't become a wall of links.
    closeDropdowns();
    item.classList.toggle("open", open);
    if (caret) caret.setAttribute("aria-expanded", String(open));
  }

  /**
   * Does tapping this top-level label open its dropdown instead of leaving?
   *
   * On a phone the caret is a 44px target next to a full-width label, so the
   * label is what gets hit — and navigating away is the one thing that makes
   * the sections undiscoverable. Every dropdown carries its own page as an
   * entry (Platform → "The Platform", Pricing → "Why no price tag"), so the
   * page itself is still one tap further in, never stranded.
   *
   * Desktop is untouched: there the label is a link and hover reveals the panel.
   */
  function opensDropdownOnTap(a) {
    const item = a.parentElement;
    return (
      mobileNav.matches &&
      item &&
      item.classList.contains("nav-item") &&
      !!item.querySelector(".nav-caret")
    );
  }

  document.querySelectorAll(".nav-item").forEach((item) => {
    const caret = item.querySelector(".nav-caret");
    if (!caret) return;

    caret.addEventListener("click", (e) => {
      e.preventDefault();
      toggleDropdown(item);
    });

    const link = item.querySelector(":scope > a");
    if (!link) return;
    link.addEventListener("click", (e) => {
      if (!opensDropdownOnTap(link)) return;
      e.preventDefault();
      toggleDropdown(item);
    });
  });

  // Close the mobile sheet after picking a section; a same-page hash link
  // doesn't reload, so the menu would otherwise stay covering the target.
  document.querySelectorAll(".nav-menu a, .nav-item > a").forEach((a) => {
    a.addEventListener("click", () => {
      // ...but not when the tap only expanded a dropdown, which would tear
      // the sheet away the instant it opened.
      if (opensDropdownOnTap(a)) return;
      if (nav) nav.classList.remove("open");
      closeDropdowns();
    });
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".nav-item")) closeDropdowns();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDropdowns();
  });

  function initSectionNavigation() {
    var reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    var excludes = ".cta-band, .logos-section, .trust-strip, .stat-strip-section";
    var rawBlocks = Array.from(document.querySelectorAll("[data-page-section], section, article"));
    var usedIds = new Set(Array.from(document.querySelectorAll("[id]")).map(function (el) { return el.id; }));
    var sections = [];

    function sanitizeLabel(label) {
      return (label || "")
        .replace(/\s+/g, " ")
        .replace(/[\u2013\u2014]/g, "-")
        .replace(/\u00a0/g, " ")
        .trim();
    }

    function slugify(text) {
      var normalized = sanitizeLabel(text)
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
      return normalized || "section";
    }

    function buildUniqueId(seed) {
      var base = slugify(seed);
      var candidate = base;
      var n = 2;
      while (usedIds.has(candidate)) {
        candidate = base + "-" + n;
        n += 1;
      }
      usedIds.add(candidate);
      return candidate;
    }

    function isEligibleBlock(block) {
      if (!block || !(block instanceof HTMLElement)) return false;
      if (block.closest("header, footer, nav")) return false;
      if (block.matches(excludes)) return false;
      if (block.dataset.pageSection === "false") return false;
      if (block.classList.contains("nav")) return false;
      return true;
    }

    function findPrimaryEyebrow(block) {
      var eyebrows = block.querySelectorAll(".eyebrow");
      for (var i = 0; i < eyebrows.length; i += 1) {
        var eyebrow = eyebrows[i];
        if (eyebrow.closest("footer, nav, .nav, .bot-panel, .modal-overlay")) continue;
        var owner = eyebrow.closest("[data-page-section], section, article");
        if (owner === block) return eyebrow;
      }
      return null;
    }

    function deriveLabel(block, eyebrow) {
      if (block.dataset.sectionNavLabel) return sanitizeLabel(block.dataset.sectionNavLabel);
      if (eyebrow) return sanitizeLabel(eyebrow.textContent);
      if (block.id) return sanitizeLabel(block.id.replace(/-/g, " "));
      return "Section";
    }

    rawBlocks.forEach(function (block) {
      if (!isEligibleBlock(block)) return;

      var eyebrow = findPrimaryEyebrow(block);
      if (!eyebrow) return;

      var label = deriveLabel(block, eyebrow);
      var id = block.id || buildUniqueId(label);
      if (!block.id) block.id = id;

      if (!block.hasAttribute("data-page-section")) {
        block.setAttribute("data-page-section", "");
      }

      if (sections.some(function (entry) { return entry.id === id; })) return;

      sections.push({
        el: block,
        id: id,
        label: label,
        eyebrow: eyebrow,
      });
    });

    sections.forEach(function (entry) {
      if (!entry.eyebrow || entry.eyebrow.closest("a")) return;

      var link = document.createElement("a");
      link.href = "#" + entry.id;
      link.className = entry.eyebrow.className + " eyebrow-link";
      link.setAttribute("data-section-eyebrow-link", "");
      link.setAttribute("aria-label", "Jump to section: " + entry.label);
      link.innerHTML = entry.eyebrow.innerHTML;
      entry.eyebrow.replaceWith(link);
      entry.eyebrow = link;
    });

    if (sections.length <= 1) return sections;

    var root = document.documentElement;
    var headerEl = document.querySelector(".nav");

    function getHeaderOffset() {
      var height = headerEl ? headerEl.getBoundingClientRect().height : 72;
      return Math.max(64, Math.round(height + 14));
    }

    function refreshHeaderOffsetVar() {
      root.style.setProperty("--pf-sticky-offset", getHeaderOffset() + "px");
    }

    refreshHeaderOffsetVar();

    var control = document.createElement("nav");
    control.className = "section-nav-control";
    control.setAttribute("aria-label", "Page sections");
    control.innerHTML = [
      '<a class="section-nav-btn section-nav-prev" href="#" aria-label="Previous section"><span aria-hidden="true">\u2191</span><span class="visually-hidden">Previous section</span></a>',
      '<button class="section-nav-count" type="button" aria-haspopup="true" aria-expanded="false"><span class="section-nav-count-text">1 of ' + sections.length + '</span></button>',
      '<a class="section-nav-btn section-nav-next" href="#" aria-label="Next section"><span aria-hidden="true">\u2193</span><span class="visually-hidden">Next section</span></a>',
      '<span class="section-nav-tip section-nav-tip-prev" aria-hidden="true"></span>',
      '<span class="section-nav-tip section-nav-tip-next" aria-hidden="true"></span>',
      '<div class="section-nav-menu" hidden><ul class="section-nav-menu-list"></ul></div>'
    ].join("");
    document.body.appendChild(control);

    var prevLink = control.querySelector(".section-nav-prev");
    var nextLink = control.querySelector(".section-nav-next");
    var countButton = control.querySelector(".section-nav-count");
    var countText = control.querySelector(".section-nav-count-text");
    var menu = control.querySelector(".section-nav-menu");
    var menuList = control.querySelector(".section-nav-menu-list");
    var prevTip = control.querySelector(".section-nav-tip-prev");
    var nextTip = control.querySelector(".section-nav-tip-next");

    sections.forEach(function (entry, index) {
      var li = document.createElement("li");
      var link = document.createElement("a");
      link.href = "#" + entry.id;
      link.textContent = (index + 1) + ". " + entry.label;
      link.className = "section-nav-menu-link";
      link.dataset.index = String(index);
      li.appendChild(link);
      menuList.appendChild(li);
    });

    var activeIndex = 0;
    var rafPending = false;
    var lockTargetId = "";
    var lockExpiresAt = 0;
    var mobileControlQuery = window.matchMedia("(max-width: 900px)");

    function getIndexById(id) {
      return sections.findIndex(function (entry) { return entry.id === id; });
    }

    function setMenuState(open) {
      countButton.setAttribute("aria-expanded", String(open));
      menu.hidden = !open;
      control.classList.toggle("section-nav-menu-open", open);
    }

    function setAnchorState(anchor, enabled, destinationId, fallbackLabel) {
      if (enabled) {
        anchor.href = "#" + destinationId;
        anchor.removeAttribute("aria-disabled");
        anchor.removeAttribute("tabindex");
        anchor.classList.remove("is-disabled");
      } else {
        anchor.removeAttribute("href");
        anchor.setAttribute("aria-disabled", "true");
        anchor.setAttribute("tabindex", "-1");
        anchor.classList.add("is-disabled");
      }
      if (fallbackLabel) {
        anchor.setAttribute("aria-label", fallbackLabel);
      }
    }

    function syncControl() {
      var total = sections.length;
      var current = sections[activeIndex];
      if (!current) return;

      countText.textContent = (activeIndex + 1) + " of " + total;
      countButton.setAttribute("aria-label", "Current section " + (activeIndex + 1) + " of " + total + ": " + current.label + ". Open section list");

      var prev = sections[activeIndex - 1] || null;
      var next = sections[activeIndex + 1] || null;

      setAnchorState(
        prevLink,
        !!prev,
        prev ? prev.id : "",
        prev ? "Previous section: " + prev.label : "Previous section unavailable"
      );
      setAnchorState(
        nextLink,
        !!next,
        next ? next.id : "",
        next ? "Next section: " + next.label : "Next section unavailable"
      );

      prevTip.textContent = prev ? "Previous: " + prev.label : "";
      nextTip.textContent = next ? "Next: " + next.label : "";

      menuList.querySelectorAll(".section-nav-menu-link").forEach(function (link, idx) {
        var isActive = idx === activeIndex;
        link.classList.toggle("is-active", isActive);
        if (isActive) {
          link.setAttribute("aria-current", "true");
        } else {
          link.removeAttribute("aria-current");
        }
      });
    }

    function getActiveSectionFromViewport() {
      var offset = getHeaderOffset();
      var viewport = Math.max(480, window.innerHeight || 0);
      var bestIndex = 0;
      var bestScore = -Infinity;

      sections.forEach(function (entry, index) {
        var rect = entry.el.getBoundingClientRect();
        var visibleTop = Math.max(rect.top, offset);
        var visibleBottom = Math.min(rect.bottom, viewport);
        var visibleHeight = Math.max(0, visibleBottom - visibleTop);
        var normalizedVisible = visibleHeight / Math.max(1, Math.min(rect.height, viewport));
        var distance = Math.abs(rect.top - offset);
        var passedBonus = rect.top <= offset ? 5 : 0;
        var score = normalizedVisible * 100 - distance * 0.04 + passedBonus;

        if (score > bestScore) {
          bestScore = score;
          bestIndex = index;
        }
      });

      return bestIndex;
    }

    function replaceHashWithoutHistory(id) {
      if (!id) return;
      // Preserve structured hash state (for example filter hashes like
      // #type=Case+Study) used by page-specific scripts.
      var currentRawHash = window.location.hash.replace(/^#/, "");
      if (currentRawHash.indexOf("=") !== -1) return;
      var nextHash = "#" + id;
      if (window.location.hash === nextHash) return;
      history.replaceState(null, "", nextHash);
    }

    function syncActiveFromViewport() {
      rafPending = false;
      var nextIndex = getActiveSectionFromViewport();
      if (nextIndex !== activeIndex) {
        activeIndex = nextIndex;
        syncControl();
      }

      if (lockTargetId) {
        if (sections[activeIndex].id === lockTargetId || Date.now() > lockExpiresAt) {
          lockTargetId = "";
        }
        return;
      }

      replaceHashWithoutHistory(sections[activeIndex].id);
    }

    function requestViewportSync() {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(syncActiveFromViewport);
    }

    function syncBottomControlVisibility() {
      if (!mobileControlQuery.matches) {
        control.classList.remove("section-nav-hidden-end");
        return;
      }

      var scrollingEl = document.scrollingElement || document.documentElement;
      var scrollTop = scrollingEl.scrollTop || window.scrollY || window.pageYOffset || 0;
      var viewportBottom = scrollTop + (window.innerHeight || 0);
      var documentHeight = scrollingEl.scrollHeight || document.documentElement.scrollHeight;
      var threshold = 12;
      var atBottom = viewportBottom >= documentHeight - threshold;
      control.classList.toggle("section-nav-hidden-end", atBottom);
    }

    function navigateToSection(id, fromExplicitClick) {
      if (!id) return;
      var target = document.getElementById(id);
      if (!target) return;
      if (fromExplicitClick) {
        lockTargetId = id;
        lockExpiresAt = Date.now() + 1400;
      }

      var behavior = reducedMotionQuery.matches ? "auto" : "smooth";
      target.scrollIntoView({ block: "start", behavior: behavior });
    }

    document.addEventListener("click", function (event) {
      var anchor = event.target.closest("a[href^='#']");
      if (!anchor) return;
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      var href = anchor.getAttribute("href");
      if (!href || href.length < 2) return;
      var rawId = href.slice(1);
      var id = decodeURIComponent(rawId);
      if (getIndexById(id) === -1) return;

      lockTargetId = id;
      lockExpiresAt = Date.now() + 1400;

      if (anchor.classList.contains("section-nav-menu-link")) {
        setMenuState(false);
      }
    });

    control.addEventListener("click", function (event) {
      var link = event.target.closest("a");
      if (!link) return;
      if (link.classList.contains("is-disabled")) {
        event.preventDefault();
      }
    });

    countButton.addEventListener("click", function () {
      setMenuState(menu.hidden);
    });

    document.addEventListener("click", function (event) {
      if (!control.contains(event.target)) setMenuState(false);
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") setMenuState(false);
    });

    window.addEventListener("hashchange", function () {
      var id = decodeURIComponent(window.location.hash.replace(/^#/, ""));
      if (!id) return;
      var idx = getIndexById(id);
      if (idx === -1) return;
      activeIndex = idx;
      syncControl();
      navigateToSection(id, false);
    });

    var sectionObserver;

    function resetObserver() {
      if (sectionObserver) sectionObserver.disconnect();
      sectionObserver = new IntersectionObserver(
        function () {
          requestViewportSync();
        },
        {
          root: null,
          rootMargin: "-" + getHeaderOffset() + "px 0px -45% 0px",
          threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
        }
      );

      sections.forEach(function (entry) {
        sectionObserver.observe(entry.el);
      });
    }

    resetObserver();

    window.addEventListener("resize", function () {
      refreshHeaderOffsetVar();
      resetObserver();
      requestViewportSync();
    });

    window.addEventListener("orientationchange", function () {
      refreshHeaderOffsetVar();
      requestViewportSync();
      syncBottomControlVisibility();
    });

    window.addEventListener("scroll", requestViewportSync, { passive: true });
    window.addEventListener("scroll", syncBottomControlVisibility, { passive: true });

    if (typeof mobileControlQuery.addEventListener === "function") {
      mobileControlQuery.addEventListener("change", syncBottomControlVisibility);
    } else if (typeof mobileControlQuery.addListener === "function") {
      mobileControlQuery.addListener(syncBottomControlVisibility);
    }

    var initialHash = decodeURIComponent(window.location.hash.replace(/^#/, ""));
    var initialIndex = getIndexById(initialHash);
    if (initialIndex >= 0) {
      activeIndex = initialIndex;
    }

    syncControl();
    requestViewportSync();
    syncBottomControlVisibility();

    if (initialIndex >= 0) {
      window.addEventListener("load", function () {
        navigateToSection(initialHash, false);
      });
    }

    return sections;
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

  // --- Years-since counters (e.g. "15 yrs / Serving law firms since 2010") ---
  // Keeps elapsed-year figures current without hand-editing each year.
  document.querySelectorAll("[data-years-since]").forEach((el) => {
    const since = parseInt(el.dataset.yearsSince, 10);
    if (!since) return;
    const years = new Date().getFullYear() - since;
    el.textContent = years + (el.dataset.suffix || "");
  });

  // --- Leadership show more/less ---
  function initLeadershipToggle() {
    const section = document.getElementById("leadership");
    if (!section) return;

    const cards = section.querySelectorAll(".team-card");
    const button = section.querySelector("[data-leadership-toggle]");
    if (!cards.length || !button) return;

    const visibleWhenCollapsed = () => 3;

    function setExpanded(expanded) {
      section.classList.toggle("leadership-collapsed", !expanded);
      button.setAttribute("aria-expanded", String(expanded));
      button.textContent = expanded ? "Show fewer leaders" : "Show more leaders";
    }

    function syncButtonVisibility() {
      const shouldShowButton = cards.length > visibleWhenCollapsed();
      button.hidden = !shouldShowButton;
      if (!shouldShowButton) setExpanded(true);
    }

    setExpanded(false);
    syncButtonVisibility();

    button.addEventListener("click", () => {
      const currentlyCollapsed = section.classList.contains("leadership-collapsed");
      setExpanded(currentlyCollapsed);
    });

    window.addEventListener("resize", syncButtonVisibility);
  }

  initLeadershipToggle();

  // --- Logo ticker ---
  const TICKER_LOGOS = [
    { name: 'Akin Gump', url: 'assets/clients/akingump.png' },
    { name: 'Alberta Securities Commission', url: 'assets/clients/albertasecurities.png' },
    { name: 'Arnold & Block', url: 'assets/clients/arnoldblock.png' },
    { name: 'Baker Botts', url: 'assets/clients/bakerbotts.png' },
    { name: 'Balch & Bingham', url: 'assets/clients/balch.png' },
    { name: 'Bass Berry & Sims', url: 'assets/clients/Bass_Berry_Sims.jfif' },
    { name: 'Best Best & Krieger', url: 'assets/clients/bbk-logo.gif' },
    { name: 'Bilzin Sumberg', url: 'assets/clients/bilzin.gif' },
    { name: 'Bond, Schoeneck & King', url: 'assets/clients/Bond_Logo.jfif' },
    { name: 'Bradley Arant', url: 'assets/clients/Bradley_Arant.png' },
    { name: 'DLA Piper', url: 'assets/clients/dla.gif' },
    { name: 'Epstein Becker Green', url: 'assets/clients/epstein.gif' },
    { name: 'Eversheds Sutherland', url: 'assets/clients/Eversheds_Sutherland.png' },
    { name: 'Fish & Richardson', url: 'assets/clients/Fish_Richardson.png' },
    { name: 'Foley Hoag', url: 'assets/clients/foleyhoag.png' },
    { name: 'Fredrikson & Byron', url: 'assets/clients/freddrikosn.png' },
    { name: 'Gilbert + Tobin', url: 'assets/clients/Gilbert_Tobin.png' },
    { name: 'Goodwin', url: 'assets/clients/goodwin.png' },
    { name: 'Graydon', url: 'assets/clients/Graydon.png' },
    { name: 'Haynes Boone', url: 'assets/clients/Haynes_Boone.png' },
    { name: 'Hodgson Russ', url: 'assets/clients/hodgson.gif' },
    { name: 'Irell & Manella', url: 'assets/clients/irell.png' },
    { name: 'Jackson Walker', url: 'assets/clients/Jackson_Walkier.png' },
    { name: 'JWS', url: 'assets/clients/jws.png' },
    { name: 'Lathrop GPM', url: 'assets/clients/lathrop.png' },
    { name: 'Littler Mendelson', url: 'assets/clients/littler.png' },
    { name: 'Lowenstein Sandler', url: 'assets/clients/lowenstein-logo.gif' },
    { name: 'Lowndes', url: 'assets/clients/lowndes.png' },
    { name: 'Maddocks', url: 'assets/clients/maddocks.jpg' },
    { name: 'Manatt, Phelps & Phillips', url: 'assets/clients/manatt-logo.png' },
    { name: 'McCabes', url: 'assets/clients/Mccabes.png' },
    { name: 'McGlinchey Stafford', url: 'assets/clients/Mcglinchey.png' },
    { name: 'Michael Best & Friedrich', url: 'assets/clients/Michael_Best.jfif' },
    { name: 'Munsch Hardt', url: 'assets/clients/Munsch_Hardt.jfif' },
    { name: 'Neal Gerber Eisenberg', url: 'assets/clients/Neal_Gerber_Eisenberg.png' },
    { name: 'Nixon Peabody', url: 'assets/clients/nixon.png' },
    { name: 'Nutter', url: 'assets/clients/Nutter.png' },
    { name: 'O\'Melveny & Myers', url: 'assets/clients/om_logo-final.gif' },
    { name: 'Paul Hastings', url: 'assets/clients/paul.png' },
    { name: 'Perkins Coie', url: 'assets/clients/Perkins_Coie.png' },
    { name: 'Pillsbury Winthrop', url: 'assets/clients/pillsbury.jpg' },
    { name: 'Robins Bradshaw', url: 'assets/clients/Robins_Bradshaw.png' },
    { name: 'Robins Kaplan', url: 'assets/clients/RobinsKaplan.png' },
    { name: 'Sandberg Phoenix', url: 'assets/clients/Sandberg_Phoenix.png' },
    { name: 'Schwabe', url: 'assets/clients/schwabe.jpg' },
    { name: 'Seyfarth Shaw', url: 'assets/clients/seyfarth.png' },
    { name: 'Sheppard Mullin', url: 'assets/clients/Sheppard_Mullin.png' },
    { name: 'Shook Hardy & Bacon', url: 'assets/clients/Shook_Hardy_Bacon.png' },
    { name: 'Shutts & Bowen', url: 'assets/clients/shutts.png' },
    { name: 'Steptoe & Johnson', url: 'assets/clients/steptoe.png' },
    { name: 'Stikeman Elliott', url: 'assets/clients/Stikeman.png' },
    { name: 'Stinson', url: 'assets/clients/Stinson.png' },
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

  // Lead forms are handled elsewhere now: the demo form is a Pipedrive embed
  // (contact.html), and the newsletter writes to Supabase (js/resources.js).

  // Fire page_view
  track("page_view");
  } // end init()

})();
