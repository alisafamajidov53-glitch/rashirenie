import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  AnalyticsBreakdowns,
  AnalyticsTrust,
  ContentFormatFilter,
  PeriodComparison,
  VideoDetailsDialog,
} from "../src/options/analytics-panels";
import {
  createChromeFixture,
  dashboardFixture,
  historyFixture,
  videoFixture,
} from "./analytics-fixtures";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal("chrome", createChromeFixture().chrome);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(node: ReactNode) {
  await act(async () => root.render(node));
}
async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === text,
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
describe("analytics UI", () => {
  it("switches equal comparison periods and never invents percentages from zero", async () => {
    const history = historyFixture();
    history.slice(0, 14).forEach((day) => (day.views = 0));
    await render(<PeriodComparison history={history} language="en" />);
    await click("14d");
    expect(container.textContent).toContain("no percentage baseline");
    expect(container.textContent).toContain("2,800");
    expect(container.querySelector('button[aria-pressed="true"]')?.textContent).toBe(
      "14d",
    );
  });
  it("shows an honest incomplete-period state", async () => {
    await render(<PeriodComparison history={historyFixture(8)} language="en" />);
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "14 consecutive days",
    );
    expect(container.querySelectorAll(".comparison-grid strong")[0]?.textContent).toBe(
      "—",
    );
  });
  it("separates source time, history dates and partial coverage", async () => {
    const data = dashboardFixture();
    data.channelObservedMinutes = 12;
    data.stale = true;
    delete data.analyticsSampledAt;
    await render(<AnalyticsTrust data={data} language="en" />);
    expect(container.textContent).toContain("Saved snapshot");
    expect(container.textContent).toContain("time unknown");
    expect(container.querySelector("progress")?.value).toBe(12);
  });
  it("keeps the data-source summary quiet unless coverage needs attention", async () => {
    const data = dashboardFixture();
    await render(<AnalyticsTrust data={data} language="en" />);
    expect(container.querySelector(".trust-badge")).toBeNull();
    data.channelObservedMinutes = 12;
    await render(<AnalyticsTrust data={data} language="en" />);
    expect(container.querySelector(".trust-badge")?.textContent).toContain(
      "Partial hour",
    );
  });
  it("discloses when breakdown percentages use only reported categories", async () => {
    const data = dashboardFixture();
    data.countries = [
      {
        key: "US",
        label: "United States",
        views: 50,
        estimatedMinutesWatched: 20,
        share: 100,
        shareBasis: "reported_rows",
      },
    ];
    await render(<AnalyticsBreakdowns data={data} language="en" />);
    expect(container.querySelector(".share-basis-note")?.textContent).toContain(
      "returned by YouTube only",
    );
    data.countries[0]!.shareBasis = "all_views";
    await render(<AnalyticsBreakdowns data={data} language="en" />);
    expect(container.querySelector(".share-basis-note")).toBeNull();
  });
  it("exposes explicit format controls", async () => {
    const change = vi.fn();
    await render(<ContentFormatFilter value="all" onChange={change} language="en" />);
    expect(container.querySelector(".cohort-controls p")).toBeNull();
    await click("Shorts");
    expect(change).toHaveBeenCalledWith("shorts");
    await render(
      <ContentFormatFilter value="unknown" onChange={change} language="en" />,
    );
    expect(container.querySelector(".cohort-controls p")?.textContent).toContain(
      "not confirmed",
    );
  });
  it("does not render missing detailed metrics as zero", async () => {
    await render(
      <VideoDetailsDialog
        video={{ ...videoFixture(), analyticsDetailAvailable28Days: false }}
        videos={[]}
        language="en"
        onClose={vi.fn()}
        onAnalyze={vi.fn()}
        renderChart={() => null}
      />,
    );
    const metrics = container.querySelectorAll(".video-detail-kpis strong");
    expect(metrics[0]?.textContent).toBe("4,000");
    expect(metrics[2]?.textContent).toBe("—");
    expect(metrics[3]?.textContent).toBe("—");
  });
  it("explains the score on touch screens without a hover tooltip", async () => {
    await render(
      <VideoDetailsDialog
        video={{ ...videoFixture(), analyticsDetailAvailable28Days: false }}
        videos={[videoFixture()]}
        language="en"
        onClose={vi.fn()}
        onAnalyze={vi.fn()}
        renderChart={() => null}
      />,
    );
    const summary = container.querySelector<HTMLElement>(
      ".performance-details summary",
    );
    expect(summary?.textContent).toContain("Performance score");
    expect(summary?.textContent).toContain("Coverage");
    await act(async () => summary!.click());
    expect(
      container.querySelector<HTMLDetailsElement>(".performance-details")?.open,
    ).toBe(true);
    expect(container.querySelectorAll(".performance-factors > div")).toHaveLength(6);
    expect(
      container.querySelectorAll(".performance-factors .unavailable"),
    ).toHaveLength(6);
    expect(container.querySelector(".performance-factors")?.textContent).toContain(
      "Watch time per view",
    );
    expect(container.querySelector(".performance-details")?.textContent).toContain(
      "coverage reaches 70/100",
    );
    expect(container.querySelector(".performance-factors")?.textContent).toContain(
      "Needs 3 same-format peers",
    );
  });
  it("opens the score breakdown immediately from a table score", async () => {
    await render(
      <VideoDetailsDialog
        video={videoFixture()}
        videos={[videoFixture()]}
        language="en"
        initialPerformanceOpen
        onClose={vi.fn()}
        onAnalyze={vi.fn()}
        renderChart={() => null}
      />,
    );
    expect(
      container.querySelector<HTMLDetailsElement>(".performance-details")?.open,
    ).toBe(true);
    expect(container.querySelector(".performance-factors")?.textContent).toContain(
      "Needs 3 same-format peers",
    );
  });
  it("opens details, loads scoped data, retries offline and handles Escape", async () => {
    const fixture = createChromeFixture();
    fixture.setOffline(true);
    vi.stubGlobal("chrome", fixture.chrome);
    const close = vi.fn();
    const props = {
      video: videoFixture(),
      videos: dashboardFixture().videos,
      language: "en" as const,
      onClose: close,
      onAnalyze: vi.fn(),
      renderChart: (history: unknown[]) => <p>{history.length} days loaded</p>,
    };
    await render(<VideoDetailsDialog {...props} />);
    expect(container.querySelector("dialog")?.open).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Offline test",
    );
    fixture.setOffline(false);
    await click("Retry");
    expect(container.textContent).toContain("28 days loaded");
    expect(container.textContent).toContain("YouTube Search");
    await act(async () => {
      container
        .querySelector("dialog")!
        .dispatchEvent(new Event("cancel", { cancelable: true }));
    });
    expect(close).toHaveBeenCalledOnce();
  });
  it("reloads localized video details when the interface language changes", async () => {
    const fixture = createChromeFixture();
    const send = vi.spyOn(fixture.chrome.runtime, "sendMessage");
    vi.stubGlobal("chrome", fixture.chrome);
    const props = {
      video: videoFixture(),
      videos: dashboardFixture().videos,
      onClose: vi.fn(),
      onAnalyze: vi.fn(),
      renderChart: () => null,
    };
    await render(<VideoDetailsDialog {...props} language="en" />);
    await render(<VideoDetailsDialog {...props} language="ru" />);
    expect(
      send.mock.calls.filter(([message]) => message.type === "GET_VIDEO_ANALYTICS"),
    ).toHaveLength(2);
    expect(container.textContent).toContain("ДЕТАЛЬНАЯ АНАЛИТИКА");
  });
});
