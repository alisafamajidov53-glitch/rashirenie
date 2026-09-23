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
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("explains a failed first analytics load and recovers on retry", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const fixture = createChromeFixture();
  fixture.setOffline(true);
  vi.stubGlobal("chrome", fixture.chrome);
  vi.stubGlobal("location", new URL("https://www.youtube.com/watch?v=abcdefghijk"));
  document.body.innerHTML = "";
  await act(async () => {
    await import("../src/content/index");
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_500);
  });
  const shadow = () =>
    document.getElementById("channelpilot-extension-root")!.shadowRoot!;
  await act(async () => {
    shadow()
      .querySelector<HTMLButtonElement>('button[aria-label="Open detailed analytics"]')!
      .click();
  });
  const failure = shadow().querySelector('.cp-widget-login[role="alert"]');
  expect(failure?.textContent).toContain("Could not load analytics");
  expect(failure?.textContent).toContain("Offline test");

  fixture.setOffline(false);
  await act(async () => {
    failure!.querySelector("button")!.click();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
  expect(shadow().querySelector('.cp-widget-login[role="alert"]')).toBeNull();
  // The optimisation tab must not inherit the analytics error either.
  expect(shadow().querySelector(".cp-error")).toBeNull();
});
