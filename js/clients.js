/* =========================================================
   Clients page — testimonial reveal + region filter
   ========================================================= */

// Testimonials: reveal the rest on demand instead of showing all at once
(function () {
  var btn = document.getElementById("showAllTestimonials");
  var wall = document.querySelector(".testimonials-wall");
  if (!btn || !wall) return;
  var cards = Array.prototype.slice.call(wall.querySelectorAll(".test-card"));

  function label(card, open) {
    var who = card.querySelector(".who b");
    var name = who ? who.textContent.trim() : "this client";
    return open ? "Collapse the quote from " + name : "Read the full quote from " + name;
  }

  // Only meaningful while the clamp is applied: an already-expanded quote
  // (or a hidden 7th+ card) measures as zero overflow.
  function isClamped(q) {
    return q.scrollHeight - q.clientHeight > 2;
  }

  // Every tile carries a toggle so they all reserve the same vertical space;
  // the ones whose quote already fits get it hidden via .is-placeholder.
  // Which quotes overflow depends on the column width, so this re-runs on
  // resize.
  function syncToggles() {
    cards.forEach(function (card) {
      var q = card.querySelector("blockquote");
      if (!q) return;
      // A collapsed-away card (7th onward) measures as zero overflow — skip
      // it rather than mark it as fitting; it gets measured on reveal.
      if (!card.offsetParent) return;
      var toggle = card.querySelector(".quote-more");
      if (!toggle) {
        toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "quote-more";
        toggle.textContent = "Read more";
        toggle.setAttribute("aria-expanded", "false");
        // Identical "Read more" buttons are useless to a screen reader, so
        // each one names the person it belongs to.
        toggle.setAttribute("aria-label", label(card, false));
        q.insertAdjacentElement("afterend", toggle);
      }
      // An open quote reports no overflow — leave its toggle operable.
      if (card.classList.contains("quote-open")) return;
      toggle.classList.toggle("is-placeholder", !isClamped(q));
    });
  }

  wall.addEventListener("click", function (e) {
    var toggle = e.target && e.target.closest ? e.target.closest(".quote-more") : null;
    if (!toggle) return;
    var card = toggle.closest(".test-card");
    var open = card.classList.toggle("quote-open");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", label(card, open));
    toggle.textContent = open ? "Show less" : "Read more";
  });

  btn.addEventListener("click", function () {
    var open = wall.classList.toggle("show-all");
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.textContent = open ? "Show fewer client perspectives" : "Show more client perspectives";
    if (!open) {
      // Collapsing: bring the user back to the top of the section.
      document.getElementById("testimonials").scrollIntoView({ block: "start" });
    }
    // Expanding reveals the 7th card onward, which have never been measured.
    syncToggles();
  });

  var resizeTimer;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(syncToggles, 150);
  });

  syncToggles();
  // Webfonts land after first paint and change how the text wraps, so
  // measure again once they're in.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(syncToggles);
  }
})();

// Region filter for the Law Firm Partners grid
(function () {
  var grid = document.getElementById("clientsGrid");
  var btns = document.querySelectorAll(".client-filters .filter-btn");
  var empty = document.getElementById("clientsEmpty");
  var showAllBtn = document.getElementById("showAllPartners");
  if (!grid || !btns.length || !showAllBtn) return;
  var cards = Array.prototype.slice.call(grid.querySelectorAll(".client-card"));
  var activeFilter = "all";
  var expandedAll = false;
  var resizeTimer;

  function visibleLimit() {
    var cols = getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length;
    return (cols || 4) * 2;
  }

  function renderForAllFilter(matches) {
    var limit = visibleLimit();
    var shown = 0;

    matches.forEach(function (card, index) {
      var shouldShow = expandedAll || index < limit;
      card.style.display = shouldShow ? "" : "none";
      if (shouldShow) shown++;
    });

    var shouldHideToggle = matches.length <= limit;
    showAllBtn.hidden = shouldHideToggle;
    showAllBtn.style.display = shouldHideToggle ? "none" : "";
    showAllBtn.setAttribute("aria-expanded", expandedAll ? "true" : "false");
    showAllBtn.textContent = expandedAll ? "Show fewer partners" : "See more partners";

    return shown;
  }

  function apply(filter) {
    activeFilter = filter;
    var matches = [];

    cards.forEach(function (card) {
      // Suppressed cards (e.g. Orrick) stay hidden no matter the filter.
      if (card.hasAttribute("data-suppressed")) {
        card.style.display = "none";
        return;
      }
      var regions = (card.getAttribute("data-region") || "").split(/\s+/);
      var match = filter === "all" || regions.indexOf(filter) !== -1;
      if (match) {
        matches.push(card);
      } else {
        card.style.display = "none";
      }
    });

    var shown = 0;
    if (filter === "all") {
      shown = renderForAllFilter(matches);
    } else {
      // Region-specific filters always show the full matching set.
      matches.forEach(function (card) {
        card.style.display = "";
        shown++;
      });
      showAllBtn.hidden = true;
      showAllBtn.style.display = "none";
      showAllBtn.setAttribute("aria-expanded", "true");
      showAllBtn.textContent = "See more partners";
    }

    if (empty) empty.hidden = shown !== 0;
  }

  btns.forEach(function (b) {
    b.addEventListener("click", function () {
      btns.forEach(function (x) {
        x.classList.remove("is-active");
        x.setAttribute("aria-pressed", "false");
      });
      b.classList.add("is-active");
      b.setAttribute("aria-pressed", "true");
      apply(b.getAttribute("data-filter"));
    });
  });

  showAllBtn.addEventListener("click", function () {
    if (activeFilter !== "all") return;
    expandedAll = !expandedAll;
    apply("all");
  });

  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (activeFilter === "all") apply("all");
    }, 120);
  });

  apply("all");
  // Grid columns can change after first paint (and once webfonts load), so
  // re-apply to keep the default at exactly two rows.
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      if (activeFilter === "all") apply("all");
    });
  });
  window.addEventListener("load", function () {
    if (activeFilter === "all") apply("all");
  });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      if (activeFilter === "all") apply("all");
    });
  }
})();
