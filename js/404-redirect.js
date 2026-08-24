(function () {
  var path = window.location.pathname.replace(/\/+$/, '') || '/';
  var pathLower = path.toLowerCase();

  // Keys are lowercase because pathLower is matched against them below —
  // old links get capitalized inconsistently (e.g. /Products, /About.aspx).
  var exactRedirects = {
    '/products.aspx': '/platform',
    '/products': '/platform',
    '/about.aspx': '/about',
    '/contact.aspx': '/contact',
    '/request-demo.aspx': '/contact',
    '/testimonials.aspx': '/clients#what-clients-say',
    '/opt-in.aspx': '/stay-clever#the-cle-corner',
    '/opt-out.aspx': '/unsubscribe',
    '/universitysite-public-api-documentation': 'https://documenter.getpostman.com/view/3947254/2sB3dVLmrv'
  };

  var caseStudyRedirects = [
    { test: /^\/CaseStudies\/Bond.*\.pdf$/i, to: '/case-study-bond-schoeneck-king' },
    { test: /^\/CaseStudies\/Foley.*\.pdf$/i, to: '/case-study-foley-lardner' },
    { test: /^\/CaseStudies\/Haynes.*\.pdf$/i, to: '/case-study-haynes-boone-sdk' },
    { test: /^\/CaseStudies\/Steptoe.*\.pdf$/i, to: '/case-study-steptoe-johnson' },
    { test: /^\/CaseStudies\/Verrill.*\.pdf$/i, to: '/case-study-verrill' },
    { test: /^\/CaseStudies\/WBD.*\.pdf$/i, to: '/case-study-womble-bond-dickinson' },
    { test: /^\/CaseStudies\/.*\.pdf$/i, to: '/clients' }
  ];

  function go(target) {
    window.location.replace(target);
  }

  // Stay CLEver book: chapter pages -> the matching accordion card on the new
  // landing page. Old numbering (chapter0 = Intro, chapter1-12, chapter13 =
  // Conclusion, chapter14 = Appendix A) maps onto the new page's chapter-card ids.
  var chapterMatch = /^\/stay-clever-book\/chapter(1[0-2]|[1-9])\.aspx$/i.exec(path);
  if (chapterMatch) {
    go('/stay-clever#chapter' + chapterMatch[1]);
    return;
  }
  if (/^\/stay-clever-book\/chapter0\.aspx$/i.test(path)) {
    go('/stay-clever#chapter-intro');
    return;
  }
  if (/^\/stay-clever-book\/chapter13\.aspx$/i.test(path)) {
    go('/stay-clever#chapter-conclusion');
    return;
  }
  if (/^\/stay-clever-book\/chapter14\.aspx$/i.test(path)) {
    go('/stay-clever#chapter-appendix-a');
    return;
  }
  if (/^\/stay-clever-book\/Chapters\.aspx$/i.test(path)) {
    go('/stay-clever#chapter-by-chapter');
    return;
  }
  if (/^\/stay-clever-book\/CLE-Corner\.aspx$/i.test(path)) {
    go('/stay-clever#the-cle-corner');
    return;
  }

  // Anything else under the book folder (Default.aspx, contact.aspx,
  // images/downloads) -> the landing page.
  if (/^\/stay-clever-book(?:\/.*)?$/i.test(path)) {
    go('/stay-clever');
    return;
  }

  if (Object.prototype.hasOwnProperty.call(exactRedirects, pathLower)) {
    go(exactRedirects[pathLower]);
    return;
  }

  for (var index = 0; index < caseStudyRedirects.length; index += 1) {
    if (caseStudyRedirects[index].test.test(path)) {
      go(caseStudyRedirects[index].to);
      return;
    }
  }
}());
