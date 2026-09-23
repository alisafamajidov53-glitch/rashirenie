import { act } from "react";
import { afterAll, expect, it, vi } from "vitest";
import { createChromeFixture } from "./analytics-fixtures";

const mounted = vi.hoisted(() => ({ roots: [] as Array<{ unmount: () => void }> }));
vi.mock("react-dom/client", async (original) => {
  const module = await original<typeof import("react-dom/client")>();
  return {
    ...module,
    createRoot: (...args: Parameters<typeof module.createRoot>) => {
      const root = module.createRoot(...args);
      mounted.roots.push(root);
      return root;
    },
  };
});

afterAll(async () => {
  await act(async () => mounted.roots.forEach((root) => root.unmount()));
  vi.unstubAllGlobals();
});

it("does not present fallback retention zero as a real channel metric", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fixture = createChromeFixture();
  fixture.dashboard.historyDetailAvailable = false;
  fixture.dashboard.analyticsWarnings = [
    "Average retention and shares are unavailable: YouTube returned a reduced report.",
  ];
  fixture.dashboard.history.forEach((day) => {
    day.averageViewPercentage = null;
    day.shares = null;
  });
  vi.stubGlobal("chrome", fixture.chrome);
  document.body.innerHTML = '<div id="root"></div>';
  let historyCsv: (data: typeof fixture.dashboard) => string;
  let videosCsv: (data: typeof fixture.dashboard) => string;
  await act(async () => {
    ({ historyCsv, videosCsv } = await import("../src/options/main"));
  });

  const retention = [...document.querySelectorAll(".secondary-metrics article")].find(
    (article) => article.textContent?.includes("Average retention"),
  );
  expect(retention?.querySelector("strong")?.textContent).toBe("—");
  expect(retention?.textContent).toContain("Metric unavailable");
  expect(document.querySelector(".analytics-api-warning")?.textContent).toContain(
    "reduced report",
  );
  const csv = historyCsv!(fixture.dashboard).replace(/^\uFEFF/u, "");
  const cells = csv.split("\r\n")[1]!.split(";");
  expect(cells[1]).toBe('"100"');
  expect(cells[5]).toBe('""');
  expect(cells[8]).toBe('""');

  const missing = fixture.dashboard.videos[0]!;
  missing.analyticsAvailable28Days = false;
  const reduced = fixture.dashboard.videos[1]!;
  reduced.analyticsDetailAvailable28Days = false;
  const videoRows = videosCsv!(fixture.dashboard)
    .replace(/^\uFEFF/u, "")
    .split("\r\n")
    .slice(1)
    .map((row) => row.split(";"));
  expect(videoRows[0]?.[3]).toBe('"12000"');
  expect(videoRows[0]?.slice(18, 27)).toEqual(Array(9).fill('""'));
  expect(videoRows[1]?.[18]).toBe('"4000"');
  expect(videoRows[1]?.slice(19, 22)).toEqual(Array(3).fill('""'));
  expect(videoRows[1]?.[22]).toBe('"60"');
});
