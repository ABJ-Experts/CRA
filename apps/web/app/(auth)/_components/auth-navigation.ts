/**
 * Complete a cookie-setting login with a document navigation. This deliberately
 * starts a fresh client query cache, so unauthorized public-page snapshots can
 * never shape the authenticated workspace rail.
 */
export function navigateToDashboard(): void {
  window.location.assign("/dashboard");
}
