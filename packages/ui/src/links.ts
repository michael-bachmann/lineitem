// Canonical outbound links + contact, shared by the landing site and the
// extension's Help & About. Single source of truth — neither app should
// redefine these. The chrome/firefox entries point at the published store
// listings — each only resolves once that store approves the submission.
export const LINKS = {
  chrome: "https://chromewebstore.google.com/detail/lineitem/fdikkjmkmjpebngnehhhnjlkiadlbhfh",
  firefox: "https://addons.mozilla.org/firefox/addon/lineitem/",
  readme: "https://github.com/michael-bachmann/lineitem#readme",
  issues: "https://github.com/michael-bachmann/lineitem/issues/new",
  website: "https://lineitem.dev",
  privacy: "https://lineitem.dev/privacy",
  ynab: "https://www.ynab.com",
  coffee: "https://ko-fi.com/mbachmann",
  email: "support@lineitem.dev",
};
