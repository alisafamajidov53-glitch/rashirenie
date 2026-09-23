import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  DEFAULT_EXTENSION_SETTINGS,
  DEFAULT_WORKSPACE_STATE,
  type AnalysisResult,
  type WorkspaceState,
} from "@channelpilot/shared";
import { analyzeTextDirect } from "../src/lib/ai-direct";
import { IdeasPage } from "../src/options/workspace-pages";

vi.mock("../src/lib/ai-direct", () => ({ analyzeTextDirect: vi.fn() }));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("keeps planner changes made while idea generation is in flight", async () => {
  let resolveAnalysis!: (result: AnalysisResult) => void;
  vi.mocked(analyzeTextDirect).mockReturnValue(
    new Promise((resolve) => {
      resolveAnalysis = resolve;
    }),
  );
  let currentWorkspace: WorkspaceState = DEFAULT_WORKSPACE_STATE;
  const onWorkspace = vi.fn(
    async (change: WorkspaceState | ((current: WorkspaceState) => WorkspaceState)) => {
      currentWorkspace =
        typeof change === "function" ? change(currentWorkspace) : change;
      return true;
    },
  );
  await act(async () =>
    root.render(
      <IdeasPage
        language="ru"
        data={null}
        settings={DEFAULT_EXTENSION_SETTINGS}
        workspace={DEFAULT_WORKSPACE_STATE}
        onWorkspace={onWorkspace}
        onError={() => undefined}
        onNotice={() => undefined}
      />,
    ),
  );
  const topic = container.querySelector<HTMLTextAreaElement>(
    ".idea-composer textarea",
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      topic,
      "Minecraft survival",
    );
    topic.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(".idea-composer .primary-button")!
      .click(),
  );
  currentWorkspace = {
    ...currentWorkspace,
    planner: [
      {
        id: "concurrent-plan",
        title: "Added during AI request",
        status: "idea",
        publishAt: "",
        notes: "",
        tags: [],
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
    ],
  };
  await act(async () =>
    resolveAnalysis({
      titles: ["A new Minecraft idea"],
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
        summary: "",
        detectedFormat: "",
        targetAudience: "",
        primaryHook: "A strong hook",
        keyMoments: [],
        thumbnailMoments: [],
        visualElements: [],
        spokenTopics: [],
      },
      seo: { total: 0, label: "low", factors: [] },
      provider: "gemini",
      generatedAt: "2026-09-01T00:00:00.000Z",
    }),
  );
  expect(onWorkspace).toHaveBeenCalledOnce();
  expect(currentWorkspace.planner[0]?.id).toBe("concurrent-plan");
  expect(currentWorkspace.ideas[0]?.title).toBe("A new Minecraft idea");
});
