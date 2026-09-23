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

it("recovers the real widget after fullscreen, masthead replacement and settings toggles", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const fixture = createChromeFixture();
  vi.stubGlobal("chrome", fixture.chrome);
  vi.stubGlobal("location", new URL("https://www.youtube.com/watch?v=abcdefghijk"));
  document.body.innerHTML =
    '<ytd-masthead><div id="end"><div id="buttons"><button>Create</button></div></div></ytd-masthead>';
  let fullscreen: Element | null = null;
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreen,
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const visible = this.isConnected && !fullscreen;
    return {
      x: 100,
      y: 8,
      left: 100,
      top: 8,
      right: 356,
      bottom: 48,
      width: visible ? 256 : 0,
      height: visible ? 40 : 0,
      toJSON: () => ({}),
    };
  });
  await act(async () => {
    await import("../src/content/index");
  });
  const tick = async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
  };
  await tick();
  const host = () => document.getElementById("channelpilot-top-dock-host");
  expect(host()?.style.display).toBe("block");
  expect(document.querySelector("#end > #channelpilot-top-dock-spacer")).not.toBeNull();
  await act(async () => {
    fullscreen = document.createElement("video");
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  await tick();
  expect(host()?.style.display).toBe("none");
  document.querySelector("ytd-masthead")!.innerHTML =
    '<div id="end"><div id="buttons"><button>Create</button></div></div>';
  await act(async () => {
    fullscreen = null;
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  await tick();
  expect(host()?.style.display).toBe("block");
  expect(host()?.shadowRoot?.querySelector(".cp-realtime")).not.toBeNull();
  await act(async () => fixture.emitSettings(false));
  await tick();
  expect(host()?.style.display).toBe("none");
  await act(async () => fixture.emitSettings(true));
  await tick();
  expect(host()?.style.display).toBe("block");
  document.querySelector("ytd-masthead")!.innerHTML =
    '<div id="end"><div id="buttons"></div></div>';
  await act(async () => document.dispatchEvent(new Event("yt-navigate-finish")));
  await tick();
  expect(document.querySelector("#end > #channelpilot-top-dock-spacer")).not.toBeNull();

  // On a narrow watch page the dock must release masthead space and become a
  // floating capsule; resizing back should dock it again without a reload.
  const desktopWidth = window.innerWidth;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  await act(async () => window.dispatchEvent(new Event("resize")));
  await tick();
  expect(document.querySelector("#channelpilot-top-dock-spacer")).toBeNull();
  expect(
    document
      .querySelector("#channelpilot-extension-root")
      ?.shadowRoot?.querySelector(".cp-realtime.undocked"),
  ).not.toBeNull();
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: desktopWidth,
  });
  await act(async () => window.dispatchEvent(new Event("resize")));
  await tick();
  expect(document.querySelector("#end > #channelpilot-top-dock-spacer")).not.toBeNull();
  expect(host()?.shadowRoot?.querySelector(".cp-realtime.docked")).not.toBeNull();
});
