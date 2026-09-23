import { afterAll, expect, it, vi } from "vitest";
import { act } from "react";
import type { AnalysisResult } from "@channelpilot/shared";
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

vi.mock("../src/content/media-bridge", () => ({
  analyzeMediaInBridge: vi.fn(async (): Promise<AnalysisResult> => ({
    titles: ["Test title"],
    shortsIdeas: [],
    recommendations: [],
    titleScores: [],
    description: "",
    shortDescription: "",
    tags: [],
    hashtags: [],
    keywords: [],
    pinnedComment: "",
    thumbnailPrompt: "",
    scriptOutline: [],
    thumbnailIdeas: [],
    contentInsights: {
      summary: "Video summary",
      detectedFormat: "16:9",
      targetAudience: "Viewers",
      primaryHook: "Hook",
      keyMoments: [],
      thumbnailMoments: [],
      visualElements: [],
      spokenTopics: [],
    },
    seo: { total: 0, label: "low", factors: [] },
    provider: "gemini",
    generatedAt: "2026-09-23T00:00:00.000Z",
  })),
}));

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

it("releases thumbnail decoding immediately when media permission is revoked", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fixture = createChromeFixture();
  fixture.settings.allowAiMediaUploads = true;
  fixture.settings.showHeaderWidget = false;
  vi.stubGlobal("chrome", fixture.chrome);
  vi.stubGlobal(
    "location",
    new URL("https://studio.youtube.com/video/abcdefghijk/edit"),
  );
  const objectUrl = vi.fn(() => `blob:channelpilot-${objectUrl.mock.calls.length}`);
  const revokeObjectUrl = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: objectUrl,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectUrl,
  });
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  const originalCreateElement = document.createElement.bind(document);
  const videos: HTMLVideoElement[] = [];
  vi.spyOn(document, "createElement").mockImplementation((tag, options) => {
    const element = originalCreateElement(tag, options);
    if (tag === "video") videos.push(element as HTMLVideoElement);
    return element;
  });
  document.body.innerHTML = '<input id="studio-upload" type="file">';
  await act(async () => {
    await import("../src/content/index");
  });
  const input = document.querySelector<HTMLInputElement>("#studio-upload")!;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File(["video"], "clip.mp4", { type: "video/mp4" })],
  });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  await vi.waitFor(() => expect(videos).toHaveLength(1));
  await act(async () => videos[0]!.dispatchEvent(new Event("loadedmetadata")));
  await vi.waitFor(() => expect(videos).toHaveLength(2));
  expect(revokeObjectUrl).toHaveBeenCalledTimes(1);

  await act(async () => {
    fixture.settings.allowAiMediaUploads = false;
    fixture.emitSettings(false);
  });
  await vi.waitFor(() => expect(revokeObjectUrl).toHaveBeenCalledTimes(2));
  expect(videos[1]!.hasAttribute("src")).toBe(false);
});
