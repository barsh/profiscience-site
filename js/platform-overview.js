(function () {
  "use strict";

  var root = document.querySelector("[data-platform-overview]");
  if (!root) return;

  var overviewData = {
    university: {
      kicker: "Shared learning foundation",
      title: "UniversitySite",
      copy: "Bring learning programs, assignments, content, participation records, and reporting into one environment for attorneys, staff, and administrators.",
      whyItMatters: "When learning is spread across separate tools and processes, oversight becomes harder and administrative work increases. UniversitySite provides a connected foundation the firm can build on.",
      examplesHeading: "Core capabilities",
      examples: [
        "Programs",
        "Audiences",
        "Assignments",
        "Learning content",
        "Participation records",
        "Reporting"
      ]
    },
    instructor: {
      kicker: "Administration and coordination",
      title: "InstructorSite",
      copy: "Give learning administrators the tools to create programs, manage audiences, coordinate instructor-led learning, record participation, and report on activity.",
      whyItMatters: "How much time is lost moving information between calendars, spreadsheets, email, and separate learning records? InstructorSite keeps the administrative work connected."
    },
    learning: {
      kicker: "Learner experience",
      title: "LearningSite",
      copy: "Give attorneys and staff one place to find learning, complete assignments, access resources, and review their history.",
      whyItMatters: "Learners should not have to know which system holds a course, resource, or record. LearningSite provides one clear destination."
    },
    manager: {
      kicker: "Visibility for the right people",
      title: "ManagerSite",
      copy: "Provide designated managers and leaders with relevant learning insight without giving them full administrative access.",
      whyItMatters: "When leaders need visibility, should they have to request another report or rely on an administrator? ManagerSite gives appropriate access where it is useful.",
      examplesHeading: "Examples",
      examples: [
        "Practice area leaders",
        "Department heads",
        "Office managers",
        "Learning coordinators"
      ]
    },
    clesite: {
      kicker: "Specialized CLE administration",
      title: "CLESite",
      copy: "Connect CLE and CPD records, certificates, jurisdiction-specific requirements, attorney access, and firmwide compliance oversight.",
      whyItMatters: "When CLE is managed separately from learning, firms often duplicate records and rely on manual reconciliation. CLESite brings the two together on the UniversitySite foundation.",
      examplesHeading: "What it supports",
      examples: [
        "Jurisdiction-specific rules updated weekly",
        "CLE and CPD records and certificates",
        "Compliance reports for CLE and CPD globally",
        "Legal-learning providers: PLI, NBI, CeriFi",
        "Live and on-demand CLE programs",
        "Attorney access",
        "Firmwide oversight and reporting"
      ]
    },
    integrations: {
      kicker: "Connect the systems your firm relies on",
      title: "Integrations",
      copy: "Connect the platform with selected identity, HR, meeting, learning-content, and CLE-provider systems.",
      whyItMatters: "Where is your team still re-entering information or reconciling activity between systems? Integrations can reduce those points of friction and support more reliable records.",
      examplesHeading: "Examples",
      examples: [
        "Identity and HR systems",
        "Outlook, Teams, Webex, Zoom",
        "LinkedIn Learning",
        "Legal-learning providers: PLI, NBI, CeriFi"
      ],
    },
    extensions: {
      kicker: "Add capabilities where they are useful",
      title: "Extensions",
      copy: "Add focused capabilities for video delivery, evaluations, advanced reporting, APIs, mobile access, and AI-ready knowledge delivery.",
      whyItMatters: "Your firm may not need every option. Extensions allow Profiscience to address specific requirements without making the entire platform more complicated.",
      examplesHeading: "Examples",
      examples: [
        "Video Streaming and Compliance",
        "Knowledge checks and evaluations",
        "SQL Reporting",
        "API access",
        "AI Knowledge Connector",
        "Mobile learning"
      ]
    },
    beyond: {
      kicker: "Learning beyond the firm",
      title: "ProviderSite and ClientSite",
      copy: "Extend selected learning to clients and other external audiences through experiences designed for CLE programs or broader client education.",
      whyItMatters: "Could valuable firm knowledge serve clients as well as internal audiences? The same platform can support external learning without forcing every program into a CLE-provider workflow.",
      examplesHeading: "Available experiences",
      examples: [
        "ProviderSite: recorded CLE programs with eligible credit and certificate issuance",
        "ClientSite: broader client education and external learning that is not centered on CLE administration"
      ]
    }
  };

  var defaultKey = "university";
  var selectedKey = null;
  var nodes = Array.prototype.slice.call(root.querySelectorAll("[data-platform-node]"));
  var titleEl = root.querySelector("[data-platform-detail-title]");
  var kickerEl = root.querySelector("[data-platform-detail-kicker]");
  var copyEl = root.querySelector("[data-platform-detail-copy]");
  var pointEl = root.querySelector("[data-platform-detail-point]");
  var examplesEl = root.querySelector("[data-platform-detail-examples]");
  var detailEl = root.querySelector(".platform-overview-detail");
  var diagramEl = root.querySelector(".platform-overview-diagram");
  var toolbarEl = root.querySelector(".platform-overview-toolbar");
  var detailBackBtn = root.querySelector("[data-platform-detail-back]");
  var liveEl = root.querySelector("[data-platform-live]");
  var tourBtn = root.querySelector("[data-platform-tour-toggle]");
  var resetBtn = root.querySelector("[data-platform-reset]");

  var tourOrder = ["university", "clesite", "instructor", "learning", "manager", "integrations", "extensions", "beyond"];
  var tourTimer = null;
  var tourStepIndex = -1;
  var reduceMotionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
  var noteEl = root.querySelector(".platform-overview-note");
  var supportsHoverMedia = window.matchMedia("(hover: hover) and (pointer: fine)");

  var app = root.querySelector("[data-platform-app]");

  function setTourVisualState(active) {
    root.classList.toggle("platform-overview--tour-active", !!active);
  }

  function isStackedOverviewLayout() {
    return window.matchMedia("(max-width: 1160px)").matches;
  }

  function isMobileOverviewLayout() {
    return window.matchMedia("(max-width: 760px)").matches;
  }

  function hasTouchScreen() {
    return ("ontouchstart" in window) || (navigator.maxTouchPoints > 0) || (navigator.msMaxTouchPoints > 0);
  }

  function canHoverToPreview() {
    // Hybrid devices can support both touch and mouse; allow hover when a fine hover pointer exists.
    return supportsHoverMedia.matches && !isStackedOverviewLayout();
  }

  function getStickyHeaderOffset() {
    var value = window.getComputedStyle(document.documentElement).getPropertyValue("--pf-sticky-offset");
    var offset = parseFloat(value) + 20; // Add 10px for spacing between the header and the target element.
    return Number.isFinite(offset) ? offset : 72;
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function setPressedState(key) {
    nodes.forEach(function (node) {
      var active = node.getAttribute("data-platform-node") === key;
      node.setAttribute("aria-pressed", String(active));
      node.classList.toggle("is-selected", active);
    });
  }

  function renderEmptyState() {
    selectedKey = null;

    if (kickerEl) kickerEl.textContent = "Interactive overview";
    if (titleEl) titleEl.textContent = "Select a component";
    if (copyEl) {
      copyEl.textContent = "Choose any card in the diagram to see what it is and why it matters.";
    }
    if (pointEl) {
      pointEl.innerHTML = "<strong>Start here:</strong> Select UniversitySite, CLESite, or a supporting capability to explore the platform structure.";
    }
    if (examplesEl) examplesEl.innerHTML = "";
    setPressedState(null);
    if (liveEl) liveEl.textContent = "";
    updateResetVisibility();
  }

  function renderExamples(item) {
    if (!examplesEl) return;
    if (!item.examples || !item.examples.length) {
      examplesEl.innerHTML = "";
      return;
    }

    var heading = item.examplesHeading ? "<h5>" + escapeHtml(item.examplesHeading) + "</h5>" : "";
    var items = item.examples
      .map(function (entry) {
        return "<li>" + escapeHtml(entry) + "</li>";
      })
      .join("");
    var disclaimer = item.disclaimer
      ? "<p class=\"platform-overview-detail-disclaimer\">" + escapeHtml(item.disclaimer) + "</p>"
      : "";

    examplesEl.innerHTML = heading + "<ul>" + items + "</ul>" + disclaimer;
  }

  function renderDetail(key, announce) {
    var item = overviewData[key] || overviewData[defaultKey];
    selectedKey = key;

    if (kickerEl) kickerEl.textContent = item.kicker;
    if (titleEl) titleEl.textContent = item.title;
    if (copyEl) copyEl.innerHTML = "<strong>What it is:</strong> " + escapeHtml(item.copy || "");
    if (pointEl) {
      pointEl.innerHTML = "<strong>Why it matters:</strong> " + escapeHtml(item.whyItMatters || item.point || "");
    }

    renderExamples(item);
    setPressedState(key);
    updateResetVisibility();

    if (announce && liveEl) {
      liveEl.textContent = item.title + ": " + item.kicker;
    }
  }

  function updateResetVisibility() {
    if (!resetBtn) return;

    resetBtn.hidden = !selectedKey;
  }

  function selectNode(key, announce) {
    if (!overviewData[key]) return;
    renderDetail(key, announce !== false);
  }

  function getScrollContainer() {
    return window;
  }

  function revealDetailPanel() {
    if (!detailEl) return;
    if (!isStackedOverviewLayout()) return;

    var container = getScrollContainer();
    var detailRect = detailEl.getBoundingClientRect();

    if (container === window) {
      var targetTop = window.scrollY + detailRect.top - 90;
      window.scrollTo({
        top: Math.max(0, targetTop),
        behavior: reduceMotionMedia.matches ? "auto" : "smooth"
      });
      return;
    }

    var containerRect = container.getBoundingClientRect();
    var isContainerVisible = detailRect.top >= containerRect.top && detailRect.bottom <= containerRect.bottom - 12;
    if (isContainerVisible) return;

    var targetScrollTop = container.scrollTop + (detailRect.top - containerRect.top);
    if (container === window) {
      return;
    }

    container.scrollTop = Math.max(0, targetScrollTop);
  }

  function revealDiagramPanel() {
    if (!diagramEl) return;
    if (!isStackedOverviewLayout()) return;

    var container = getScrollContainer();

    if (container === window) {
      var appTarget = app || diagramEl;
      var appRect = appTarget.getBoundingClientRect();
      var targetTop = window.scrollY + appRect.top - 90;
      window.scrollTo({
        top: Math.max(0, targetTop),
        behavior: reduceMotionMedia.matches ? "auto" : "smooth"
      });
      return;
    }

    container.scrollTop = 0;
  }

  function revealToolbarPanel() {
    if (!toolbarEl) return;
    if (isStackedOverviewLayout()) return;

    var toolbarRect = toolbarEl.getBoundingClientRect();
    var targetTop = window.scrollY + toolbarRect.top - getStickyHeaderOffset();

    window.scrollTo({
      top: Math.max(0, targetTop),
      behavior: reduceMotionMedia.matches ? "auto" : "smooth"
    });
  }

  function stopTour() {
    if (tourTimer) {
      window.clearInterval(tourTimer);
      tourTimer = null;
    }
    if (tourBtn) {
      tourBtn.textContent = "Guided Tour";
      tourBtn.setAttribute("aria-pressed", "false");
    }
    setTourVisualState(false);
  }

  function stepTour() {
    tourStepIndex = (tourStepIndex + 1) % tourOrder.length;
    selectNode(tourOrder[tourStepIndex], true);
    revealDetailPanel();
  }

  function initializeTourFromSelection() {
    var selectedIndex = tourOrder.indexOf(selectedKey);
    tourStepIndex = selectedIndex >= 0 ? selectedIndex - 1 : -1;
  }

  function startManualTour() {
    if (!tourBtn) return;

    stopTour();
    tourBtn.textContent = "Next Tour Step";
    tourBtn.setAttribute("aria-pressed", "true");
    setTourVisualState(true);
    initializeTourFromSelection();
    stepTour();
  }

  function startTour() {
    if (!tourBtn) return;

    if (reduceMotionMedia.matches || isStackedOverviewLayout()) {
      startManualTour();
      return;
    }

    stopTour();
    tourBtn.textContent = "Stop Tour";
    tourBtn.setAttribute("aria-pressed", "true");
    setTourVisualState(true);

    initializeTourFromSelection();
    stepTour();

    tourTimer = window.setInterval(function () {
      stepTour();
    }, 3200);
  }

  nodes.forEach(function (node) {
    node.addEventListener("click", function () {
      stopTour();
      selectNode(node.getAttribute("data-platform-node"), true);
      if (isStackedOverviewLayout()) {
        revealDetailPanel();
      } else {
        revealToolbarPanel();
      }
    });

    node.addEventListener("mouseenter", function () {
      if (!canHoverToPreview()) return;

      stopTour();
      selectNode(node.getAttribute("data-platform-node"), true);
    });

    node.addEventListener("mouseleave", function (event) {
      if (!canHoverToPreview()) return;
      if (event.relatedTarget && event.relatedTarget.closest("[data-platform-node]")) return;

      renderEmptyState();
    });
  });

  function updateOverviewNote() {
    if (!noteEl) return;

    if (isMobileOverviewLayout() && hasTouchScreen()) {
      noteEl.textContent = "Tap any component to view details below.";
      return;
    }

    noteEl.textContent = canHoverToPreview()
      ? "Hover or select any component to update the explanation panel."
      : "Select any component to update the explanation panel.";
  }

  if (tourBtn) {
    tourBtn.addEventListener("click", function () {
      if (reduceMotionMedia.matches || isStackedOverviewLayout()) {
        if (!root.classList.contains("platform-overview--tour-active") || tourBtn.textContent !== "Next Tour Step") {
          startManualTour();
        } else {
          stepTour();
        }
        return;
      }

      if (tourTimer) {
        stopTour();
      } else {
        startTour();
      }
    });
  }

  if (detailBackBtn) {
    detailBackBtn.addEventListener("click", function () {
      revealDiagramPanel();
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", function () {
      stopTour();
      tourStepIndex = -1;
      selectedKey = null;
      renderEmptyState();
    });
  }

  if (reduceMotionMedia && typeof reduceMotionMedia.addEventListener === "function") {
    reduceMotionMedia.addEventListener("change", function () {
      stopTour();
    });
  }

  if (supportsHoverMedia && typeof supportsHoverMedia.addEventListener === "function") {
    supportsHoverMedia.addEventListener("change", updateOverviewNote);
  }

  window.addEventListener("resize", updateOverviewNote);

  renderEmptyState();
  updateOverviewNote();
})();
