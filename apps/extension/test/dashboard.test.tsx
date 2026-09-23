import { afterAll, expect, it, vi } from "vitest";
import { act } from "react";
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
it("renders the real dashboard, filters formats, opens details and signs out", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fixture = createChromeFixture();
  vi.stubGlobal("chrome", fixture.chrome);
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    await import("../src/options/main");
  });
  // Structural, not copy. This test used to assert on two section headings
  // ("Behind the numbers", "Growth in context") and silently went stale the
  // moment they were reworded — neither string exists in the source any more.
  // What the test actually cares about is that the dashboard mounted and bound
  // the fixture data, so assert on the shell, the metric grid and the channel
  // name that only the fixture can produce.
  expect(document.querySelector(".dashboard-shell")).not.toBeNull();
  expect(document.querySelectorAll(".metric-card").length).toBeGreaterThan(0);
  expect(document.querySelectorAll(".analytics-video-row").length).toBeGreaterThan(0);
  expect(document.body.textContent).toContain("Demo · ChannelPilot");
  const click = async (label: string) => {
    const button = [...document.querySelectorAll("button")].find(
      (item) =>
        item.getAttribute("aria-label") === label || item.textContent?.trim() === label,
    );
    expect(button).toBeDefined();
    await act(async () => button!.click());
  };
  expect(document.querySelectorAll(".metric-card")).toHaveLength(4);
  expect(document.querySelectorAll(".analytics-video-row")).toHaveLength(3);
  expect(document.querySelector(".video-totals")).toBeNull();
  expect(document.querySelector(".live-badge")).toBeNull();
  expect(document.querySelector<HTMLDetailsElement>(".analytics-trust")?.open).toBe(
    false,
  );
  await click("AI Studio");
  expect(document.querySelector(".ai-media-disabled")?.textContent).toContain(
    "Media analysis is off",
  );
  expect(document.querySelector(".ai-media-upload")).toBeNull();
  expect(document.querySelector<HTMLButtonElement>(".ai-generate")?.disabled).toBe(
    true,
  );
  expect(document.querySelector(".composer-settings")?.textContent).toContain("Auto");
  expect(document.querySelector(".composer-settings")?.textContent).not.toContain(
    "3 APIs",
  );
  const scrollTo = vi.spyOn(window, "scrollTo");
  scrollTo.mockClear();
  await act(async () => {
    document.querySelector<HTMLButtonElement>(".ai-media-disabled > button")!.click();
  });
  expect(document.querySelector(".settings-page")).not.toBeNull();
  expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: expect.any(String) });
  scrollTo.mockRestore();
  await click("Overview");
  await click("All videos & filters →");
  await click("Shorts");
  expect(document.querySelectorAll(".analytics-video-row")).toHaveLength(1);
  expect(document.querySelector(".analytics-video-row")?.textContent).toContain(
    "shorts00001",
  );
  await act(async () => {
    document.querySelector<HTMLButtonElement>(".video-detail-link")!.click();
  });
  expect(document.querySelector("dialog")?.open).toBe(true);
  expect(document.querySelector("dialog")?.textContent).toContain("YouTube Search");
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>('[aria-label="Close video analytics"]')!
      .click();
  });
  expect(document.querySelector("dialog")).toBeNull();
  fixture.dashboard.videos.forEach((video) => {
    video.analyticsDetailAvailable28Days = false;
  });
  fixture.dashboard.videos[0]!.analyticsDetailAvailable28Days = true;
  await click("All formats");
  const summary = () => document.querySelector(".video-totals")!;
  expect(summary().textContent).toContain("over 1 video");
  await click("Shorts");
  expect(summary().textContent).not.toContain("over 1 video");
  expect(summary().querySelectorAll("b")[3]?.textContent).toBe("—");
  fixture.dashboard.videos.forEach((video) => {
    video.analyticsAvailable28Days = false;
  });
  await click("All formats");
  expect(summary().querySelectorAll("b")[2]?.textContent).toBe("—");
  fixture.setOffline(true);
  // A failed refresh keeps the last good snapshot visible.
  const refresh = [...document.querySelectorAll("button")].find(
    (item) =>
      item.textContent?.includes("Refresh") && !item.textContent?.includes("packaging"),
  );
  expect(refresh).toBeDefined();
  await act(async () => refresh!.click());
  expect(document.body.textContent).toContain("Offline test");
  expect(document.querySelector(".topbar-title span")?.textContent).toContain(
    "Saved snapshot",
  );
  expect(document.querySelector(".analytics-video-row")).not.toBeNull();
  await click("Sign out");
  // The first click asks: signing out deletes the collected statistics.
  expect(document.body.textContent).toContain(
    "Collected view statistics will be deleted",
  );
  expect(document.body.textContent).not.toContain("Google account disconnected");
  await click("Yes, sign out");
  expect(document.body.textContent).toContain("Google account disconnected");
});
