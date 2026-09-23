import { afterAll, expect, it, vi } from "vitest";
import { act } from "react";
import { analyzeMediaDirect } from "../src/lib/ai-direct";
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

vi.mock("../src/lib/ai-direct", async (original) => {
  const module = await original<typeof import("../src/lib/ai-direct")>();
  return {
    ...module,
    analyzeMediaDirect: vi.fn(
      (...args: Parameters<typeof module.analyzeMediaDirect>) =>
        new Promise((_resolve, reject) => {
          args[4]?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    ),
  };
});

afterAll(async () => {
  await act(async () => mounted.roots.forEach((root) => root.unmount()));
  vi.unstubAllGlobals();
});

it("aborts an in-flight media analysis when the file is removed", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fixture = createChromeFixture();
  fixture.settings.allowAiMediaUploads = true;
  vi.stubGlobal("chrome", fixture.chrome);
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    await import("../src/options/main");
  });
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>('button[aria-label="AI Studio"]')!
      .click();
  });
  const input = document.querySelector<HTMLInputElement>(".ai-media-upload input")!;
  const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const signal = vi.mocked(analyzeMediaDirect).mock.calls[0]?.[4];
  expect(signal).toBeDefined();
  expect(signal?.aborted).toBe(false);
  await act(async () => {
    document.querySelector<HTMLButtonElement>(".ai-media-upload > button")!.click();
  });
  expect(signal?.aborted).toBe(true);
  expect(document.querySelector(".ai-media-upload.has-file")).toBeNull();

  const secondFile = new File(["second video"], "second.mp4", {
    type: "video/mp4",
  });
  Object.defineProperty(input, "files", { configurable: true, value: [secondFile] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  const secondSignal = vi.mocked(analyzeMediaDirect).mock.calls[1]?.[4];
  expect(secondSignal?.aborted).toBe(false);
  await act(async () => {
    fixture.settings.allowAiMediaUploads = false;
    fixture.emitStoredSettings();
  });
  expect(secondSignal?.aborted).toBe(true);
  expect(document.querySelector(".ai-media-upload")).toBeNull();
  expect(document.querySelector(".ai-media-disabled")).not.toBeNull();

  await act(async () => {
    fixture.settings.allowAiMediaUploads = true;
    fixture.emitStoredSettings();
  });
  const staleSettings = { ...fixture.settings };
  const originalSend = fixture.chrome.runtime.sendMessage.bind(fixture.chrome.runtime);
  let releaseSettings:
    ((response: Awaited<ReturnType<typeof originalSend>>) => void) | undefined;
  fixture.chrome.runtime.sendMessage = async (message) =>
    message.type === "GET_SETTINGS"
      ? new Promise((resolve) => {
          releaseSettings = resolve;
        })
      : originalSend(message);
  const thirdInput = document.querySelector<HTMLInputElement>(
    ".ai-media-upload input",
  )!;
  Object.defineProperty(thirdInput, "files", {
    configurable: true,
    value: [new File(["third video"], "third.mp4", { type: "video/mp4" })],
  });
  await act(async () =>
    thirdInput.dispatchEvent(new Event("change", { bubbles: true })),
  );
  expect(releaseSettings).toBeDefined();
  await act(async () => {
    fixture.settings.allowAiMediaUploads = false;
    fixture.emitStoredSettings();
    releaseSettings!({ ok: true, data: staleSettings });
  });
  expect(vi.mocked(analyzeMediaDirect)).toHaveBeenCalledTimes(2);
});
