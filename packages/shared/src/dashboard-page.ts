/** Sections of the extension dashboard (the options page). */
export const DASHBOARD_PAGES = [
  "overview",
  "videos",
  "competitors",
  "ideas",
  "planner",
  "comments",
  "seo",
  "ai",
  "thumbnail",
  "settings",
] as const;

export type DashboardPage = (typeof DASHBOARD_PAGES)[number];

export function isDashboardPage(value: unknown): value is DashboardPage {
  return (
    typeof value === "string" && (DASHBOARD_PAGES as readonly string[]).includes(value)
  );
}

/**
 * `chrome.storage.session` key through which a caller asks the dashboard to
 * show a specific section.
 *
 * `chrome.runtime.openOptionsPage` takes no URL — and it focuses a dashboard
 * tab that is already open instead of opening a second one — so the section
 * cannot travel in a query string. The dashboard reads the request on load and
 * while it is open, and removes it once acted on.
 */
export const DASHBOARD_PAGE_REQUEST_KEY = "dashboardPageRequestV1";

/** A request older than this was not acted on and must not redirect later. */
const DASHBOARD_PAGE_REQUEST_TTL_MS = 30_000;

export interface DashboardPageRequest {
  page: DashboardPage;
  at: number;
}

export function readDashboardPageRequest(
  value: unknown,
  now = Date.now(),
): DashboardPage | null {
  if (!value || typeof value !== "object") return null;
  const { page, at } = value as Partial<DashboardPageRequest>;
  if (!isDashboardPage(page) || typeof at !== "number") return null;
  const age = now - at;
  return age >= 0 && age <= DASHBOARD_PAGE_REQUEST_TTL_MS ? page : null;
}
