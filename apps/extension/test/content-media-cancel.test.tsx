import { afterAll, expect, it, vi } from "vitest";
import { act } from "react";
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("stops Studio media preflight when AI uploads are disabled", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fixture = createChromeFixture();
  fixture.settings.allowAiMediaUploads = true;
  fixture.settings.showHeaderWidget = false;
  const sent: ExtensionRequest[] = [];
  const sendMessage = fixture.chrome.runtime.sendMessage.bind(fixture.chrome.runtime);
  fixture.chrome.runtime.sendMessage = async (message: ExtensionRequest) => {
    sent.push(message);
    return sendMessage(message);
  };
  vi.stubGlobal("chrome", fixture.chrome);
  vi.stubGlobal(
    "location",
    new URL("https://studio.youtube.com/video/abcdefghijk/edit"),
  );
  const createObjectURL = vi.fn(() => "blob:channelpilot-test");
  const revokeObjectURL = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectURL,
  });
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  document.body.innerHTML = '<input id="studio-upload" type="file">';
  await act(async () => {
    await import("../src/content/index");
  });
  const input = document.querySelector<HTMLInputElement>("#studio-upload")!;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File(["video"], "clip.mp4", { type: "video/mp4" })],
  });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await vi.waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce());
  await act(async () => {
    fixture.settings.allowAiMediaUploads = false;
    fixture.emitSettings(false);
  });
  await vi.waitFor(() => expect(revokeObjectURL).toHaveBeenCalledOnce());
  expect(sent.some((request) => request.type === "CREATE_MEDIA_BRIDGE_SESSION")).toBe(
    false,
  );
});
