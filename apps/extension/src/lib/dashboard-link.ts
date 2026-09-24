import {
  DASHBOARD_PAGE_REQUEST_KEY,
  type DashboardPage,
  type DashboardPageRequest,
} from "@channelpilot/shared";

/**
 * Opens the dashboard, optionally on one section.
 *
 * For extension pages and the service worker only: content scripts have no
 * `chrome.runtime.openOptionsPage` and send `OPEN_OPTIONS_PAGE` instead, which
 * lands here. A failed hand-over still opens the dashboard, on its default page.
 */
export async function openDashboardPage(page?: DashboardPage): Promise<void> {
  if (page) {
    await chrome.storage.session
      ?.set({
        [DASHBOARD_PAGE_REQUEST_KEY]: {
          page,
          at: Date.now(),
        } satisfies DashboardPageRequest,
      })
      .catch(() => undefined);
  }
  await chrome.runtime.openOptionsPage();
}
