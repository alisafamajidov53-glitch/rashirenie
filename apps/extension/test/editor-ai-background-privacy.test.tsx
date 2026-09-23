import { act } from "react";
import { afterAll, expect, it, vi } from "vitest";
import type { ExtensionRequest } from "@channelpilot/shared";
import { createChromeFixture } from "./analytics-fixtures";

const mounted = vi.hoisted(() => ({ roots: [] as Array<{ unmount: () => void }> }));
const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

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
  if (originalCreateObjectURL)
    Object.defineProperty(URL, "createObjectURL", originalCreateObjectURL);
  else Reflect.deleteProperty(URL, "createObjectURL");
  if (originalRevokeObjectURL)
    Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectURL);
  else Reflect.deleteProperty(URL, "revokeObjectURL");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("generates from text without sending a loaded frame when media uploads are off", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fixture = createChromeFixture();
  fixture.settings.allowAiMediaUploads = false;
  fixture.settings.geminiApiKey = "test-gemini-key";
  const originalSend = fixture.chrome.runtime.sendMessage.bind(fixture.chrome.runtime);
  fixture.chrome.runtime.sendMessage = async (message: ExtensionRequest) =>
    message.type === "GET_AI_PROVIDER_COOLDOWNS"
      ? { ok: true, data: { gemini: 0, groq: 0, twelveLabs: 0 } }
      : originalSend(message);
  vi.stubGlobal("chrome", fixture.chrome);
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:local-editor-frame"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  const fetchMock = vi.fn(
    async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ error: { message: "Expected test response" } }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    await import("../src/options/main");
  });
  const editorTab = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.includes("Thumbnail editor"),
  );
  expect(editorTab).toBeDefined();
  await act(async () => editorTab!.click());

  const fileInput = document.querySelector<HTMLInputElement>(
    '.canvas-hint input[type="file"]',
  )!;
  Object.defineProperty(fileInput, "files", {
    configurable: true,
    value: [new File(["image"], "frame.jpg", { type: "image/jpeg" })],
  });
  await act(async () =>
    fileInput.dispatchEvent(new Event("change", { bubbles: true })),
  );
  expect(document.querySelector(".editor-media-source")).not.toBeNull();

  // The AI background lives on its own tab of the control panel.
  await act(async () =>
    document.querySelector<HTMLButtonElement>("#editor-tab-ai")!.click(),
  );
  const prompt = document.querySelector<HTMLTextAreaElement>(
    ".ai-background-control textarea",
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      prompt,
      "A bright cinematic landscape",
    );
    prompt.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const generate = document.querySelector<HTMLButtonElement>(
    ".ai-background-actions button",
  )!;
  expect(generate.disabled).toBe(false);
  await act(async () => generate.click());
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  const [, request] = fetchMock.mock.calls[0]!;
  const body = JSON.parse(String(request?.body)) as {
    input: Array<{ type: string; data?: string }>;
  };
  expect(body.input).toHaveLength(1);
  expect(body.input[0]?.type).toBe("text");
});
