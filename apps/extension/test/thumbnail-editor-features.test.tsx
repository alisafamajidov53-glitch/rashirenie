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

const click = async (element: Element | null | undefined) => {
  expect(element).toBeTruthy();
  await act(async () => (element as HTMLElement).click());
};
const setValue = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const tab = (name: string) => document.querySelector(`#editor-tab-${name}`);

it("highlights words, places elements, saves styles and compares variants", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  const fixture = createChromeFixture();
  vi.stubGlobal("chrome", fixture.chrome);
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    await import("../src/options/main");
  });
  await click(document.querySelector('button[data-page="thumbnail"]'));

  // Accent words: clicking a word wraps it in the accent markup.
  const headline = document.querySelector<HTMLInputElement>(
    ".editor-tab-panel .control-section input",
  )!;
  await setValue(headline, "I built the longest railway");
  const longest = [...document.querySelectorAll(".accent-words button")].find(
    (button) => button.textContent === "longest",
  );
  await click(longest);
  expect(headline.value).toBe("I built the *longest* railway");
  expect(longest?.getAttribute("aria-pressed")).toBe("true");

  // Elements: added from the Elements tab, selected, removable.
  await click(tab("elements"));
  await click(document.querySelectorAll(".element-add-grid button")[0]);
  await click(document.querySelectorAll(".emoji-grid button")[0]);
  expect(document.querySelectorAll(".element-list button")).toHaveLength(2);
  expect(tab("elements")?.textContent).toContain("2");
  expect(document.querySelector(".element-inspector")).not.toBeNull();
  await click(
    [...document.querySelectorAll(".element-actions button")].find((button) =>
      button.textContent?.includes("Delete"),
    ),
  );
  expect(document.querySelectorAll(".element-list button")).toHaveLength(1);

  // My styles: saved to local storage and listed.
  await click(tab("style"));
  await setValue(
    document.querySelector<HTMLInputElement>(".save-style-row input")!,
    "Channel look",
  );
  await click(document.querySelector(".save-style-row button"));
  expect(localStorage.getItem("channelpilot.thumbnailStyles.v1")).toContain(
    "Channel look",
  );
  expect(document.body.textContent).toContain("Channel look");

  // Variants: saved for comparison and restorable.
  await click(
    [...document.querySelectorAll(".feed-actions button")].find((button) =>
      button.textContent?.includes("variant"),
    ),
  );
  expect(document.querySelectorAll(".feed-variant")).toHaveLength(1);
  await setValue(
    await (async () => {
      await click(tab("text"));
      return document.querySelector<HTMLInputElement>(
        ".editor-tab-panel .control-section input",
      )!;
    })(),
    "Changed later",
  );
  await click(document.querySelector(".feed-variant-open"));
  expect(
    document.querySelector<HTMLInputElement>(
      ".editor-tab-panel .control-section input",
    )!.value,
  ).toBe("I built the *longest* railway");
});
