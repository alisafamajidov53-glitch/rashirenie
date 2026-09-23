import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  DEFAULT_EXTENSION_SETTINGS,
  DEFAULT_WORKSPACE_STATE,
  type CompetitorSnapshot,
  type ExtensionRequest,
  type YouTubeComment,
} from "@channelpilot/shared";
import { CommentsPage, CompetitorsPage } from "../src/options/workspace-pages";
import { dashboardFixture } from "./analytics-fixtures";

let root: Root;
let container: HTMLDivElement;
const pending: Array<{
  request: ExtensionRequest;
  resolve: (response: { ok: true; data: unknown }) => void;
}> = [];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage: (request: ExtensionRequest) =>
        new Promise((resolve) => pending.push({ request, resolve })),
    },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  pending.length = 0;
  vi.unstubAllGlobals();
});

function comment(id: string, videoId: string): YouTubeComment {
  return {
    id,
    videoId,
    authorDisplayName: "Viewer",
    authorProfileImageUrl: "",
    text: `Comment ${id}`,
    publishedAt: "2026-09-01T00:00:00.000Z",
    likeCount: 0,
    replyCount: 0,
    isQuestion: false,
    isLikelySpam: false,
    sentiment: "neutral",
  };
}

const SETTINGS_WITH_KEY = { ...DEFAULT_EXTENSION_SETTINGS, youtubeApiKey: "test-key" };

it("explains the missing YouTube key instead of letting the request fail", async () => {
  const data = dashboardFixture();
  const onOpenSettings = vi.fn();
  await act(async () =>
    root.render(
      <CommentsPage
        language="ru"
        data={data}
        settings={DEFAULT_EXTENSION_SETTINGS}
        workspace={DEFAULT_WORKSPACE_STATE}
        onWorkspace={async () => true}
        onError={() => undefined}
        onNotice={() => undefined}
        onOpenSettings={onOpenSettings}
      />,
    ),
  );
  const select = container.querySelector<HTMLSelectElement>(
    'select[aria-label="Выбрать видео"]',
  )!;
  await act(async () => {
    select.value = data.videos[0]!.id;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(
    container.querySelector<HTMLButtonElement>(".comment-toolbar .primary-button")
      ?.disabled,
  ).toBe(true);
  expect(container.querySelector(".comments-key-required")?.textContent).toContain(
    "ключ YouTube Data API",
  );
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(".comments-key-required .primary-button")!
      .click(),
  );
  expect(onOpenSettings).toHaveBeenCalledOnce();
  expect(pending).toHaveLength(0);
});

it("ignores a late comment response after another video is selected", async () => {
  const data = dashboardFixture();
  await act(async () =>
    root.render(
      <CommentsPage
        language="ru"
        data={data}
        settings={SETTINGS_WITH_KEY}
        workspace={DEFAULT_WORKSPACE_STATE}
        onWorkspace={async () => true}
        onError={() => undefined}
        onNotice={() => undefined}
      />,
    ),
  );
  const select = container.querySelector<HTMLSelectElement>(
    'select[aria-label="Выбрать видео"]',
  )!;
  await act(async () => {
    select.value = data.videos[0]!.id;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(".comment-toolbar .primary-button")!
      .click(),
  );
  await act(async () => {
    select.value = data.videos[1]!.id;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(".comment-toolbar .primary-button")!
      .click(),
  );
  expect(pending.map(({ request }) => request.type)).toEqual([
    "GET_COMMENTS",
    "GET_COMMENTS",
  ]);
  await act(async () =>
    pending[1]!.resolve({
      ok: true,
      data: [comment("new", data.videos[1]!.id)],
    }),
  );
  await act(async () =>
    pending[0]!.resolve({
      ok: true,
      data: [comment("old", data.videos[0]!.id)],
    }),
  );
  expect(container.querySelector(".comment-list")?.textContent).toContain(
    "Comment new",
  );
  expect(container.querySelector(".comment-list")?.textContent).not.toContain(
    "Comment old",
  );
  await act(async () =>
    [...container.querySelectorAll<HTMLButtonElement>(".filter-tabs button")]
      .find((button) => button.textContent === "Вопросы")!
      .click(),
  );
  expect(container.querySelector(".comment-empty")?.textContent).toContain(
    "Нет комментариев в этом фильтре",
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>(".comment-empty button")!.click(),
  );
  expect(container.querySelector(".comment-list")?.textContent).toContain(
    "Comment new",
  );
});

function competitor(id: string): CompetitorSnapshot {
  return {
    channel: {
      id,
      title: `Channel ${id}`,
      avatarUrl: "",
      subscribers: 10,
      views: 100,
      videos: 2,
    },
    recentVideos: [],
    averageViews: 0,
    medianViews: 0,
    uploadsLast30Days: 0,
    fetchedAt: "2026-09-01T00:00:00.000Z",
    source: "youtube_public_api",
  };
}

it("keeps the latest competitor selection when requests finish out of order", async () => {
  await act(async () =>
    root.render(
      <CompetitorsPage
        language="ru"
        data={null}
        settings={DEFAULT_EXTENSION_SETTINGS}
        workspace={{
          ...DEFAULT_WORKSPACE_STATE,
          competitors: ["first", "second"].map((id) => ({
            channelId: id,
            title: `Channel ${id}`,
            avatarUrl: "",
            addedAt: "2026-09-01T00:00:00.000Z",
          })),
        }}
        onWorkspace={async () => true}
        onError={() => undefined}
        onNotice={() => undefined}
      />,
    ),
  );
  await act(async () =>
    container.querySelectorAll<HTMLButtonElement>(".bookmark-row button")[0]!.click(),
  );
  await act(async () =>
    container.querySelectorAll<HTMLButtonElement>(".bookmark-row button")[1]!.click(),
  );
  await act(async () => pending[1]!.resolve({ ok: true, data: competitor("second") }));
  await act(async () => pending[0]!.resolve({ ok: true, data: competitor("first") }));
  expect(container.querySelector(".competitor-hero h3")?.textContent).toBe(
    "Channel second",
  );
});

it("does not evict an existing draft when the draft limit is reached", async () => {
  const data = dashboardFixture();
  const onWorkspace = vi.fn(async () => true);
  const onError = vi.fn();
  await act(async () =>
    root.render(
      <CommentsPage
        language="ru"
        data={data}
        settings={SETTINGS_WITH_KEY}
        workspace={{
          ...DEFAULT_WORKSPACE_STATE,
          commentDrafts: Array.from({ length: 300 }, (_, index) => ({
            commentId: `saved-${index}`,
            videoId: data.videos[0]!.id,
            text: `Saved draft ${index}`,
            tone: "friendly",
            createdAt: "2026-09-01T00:00:00.000Z",
          })),
        }}
        onWorkspace={onWorkspace}
        onError={onError}
        onNotice={() => undefined}
      />,
    ),
  );
  const select = container.querySelector<HTMLSelectElement>(
    'select[aria-label="Выбрать видео"]',
  )!;
  await act(async () => {
    select.value = data.videos[0]!.id;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(".comment-toolbar .primary-button")!
      .click(),
  );
  await act(async () =>
    pending[0]!.resolve({
      ok: true,
      data: [comment("new", data.videos[0]!.id)],
    }),
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>(".comment-list footer button")!.click(),
  );
  expect(onWorkspace).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledWith("Лимит: 300 черновиков");
});

it("does not silently drop a bookmarked competitor at the 25-channel limit", async () => {
  const onWorkspace = vi.fn(async () => true);
  const onError = vi.fn();
  await act(async () =>
    root.render(
      <CompetitorsPage
        language="ru"
        data={null}
        settings={DEFAULT_EXTENSION_SETTINGS}
        workspace={{
          ...DEFAULT_WORKSPACE_STATE,
          competitors: Array.from({ length: 25 }, (_, index) => ({
            channelId: `saved-${index}`,
            title: `Saved channel ${index}`,
            avatarUrl: "",
            addedAt: "2026-09-01T00:00:00.000Z",
          })),
        }}
        onWorkspace={onWorkspace}
        onError={onError}
        onNotice={() => undefined}
      />,
    ),
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>(".bookmark-row button")!.click(),
  );
  await act(async () => pending[0]!.resolve({ ok: true, data: competitor("new") }));
  await act(async () =>
    container.querySelector<HTMLButtonElement>(".competitor-hero button")!.click(),
  );
  expect(onWorkspace).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledWith("Достигнут лимит: 25 каналов");
});
