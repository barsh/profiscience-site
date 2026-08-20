// Prefill from ?email= in a plain script so it works even if the module below
// (which loads Supabase from a CDN) is slow. Never auto-submit: email clients
// prefetch links and would unsubscribe people by accident — the visitor clicks.
(function () {
  var pre = new URLSearchParams(location.search).get("email");
  if (pre) { var el = document.getElementById("unsub-email"); if (el) el.value = pre; }
})();
