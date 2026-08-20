(function () {
  var path = window.location.pathname.replace(/\/+$/, '') || '/';

  var exactRedirects = {
    '/products.aspx': '/platform',
    '/about.aspx': '/about',
    '/contact.aspx': '/contact',
    '/request-demo.aspx': '/contact',
    '/testimonials.aspx': '/clients#what-clients-say',
    '/opt-in.aspx': '/stay-clever#the-cle-corner',
    '/opt-out.aspx': '/unsubscribe',
    '/UniversitySite-Public-API-Documentation': 'https://documenter.getpostman.com/view/3947254/2sB3dVLmrv'
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

  if (/^\/stay-clever-book(?:\/.*)?$/i.test(path)) {
    go('/stay-clever');
    return;
  }

  if (Object.prototype.hasOwnProperty.call(exactRedirects, path)) {
    go(exactRedirects[path]);
    return;
  }

  for (var index = 0; index < caseStudyRedirects.length; index += 1) {
    if (caseStudyRedirects[index].test.test(path)) {
      go(caseStudyRedirects[index].to);
      return;
    }
  }
}());
