import type {
  AiHistoryItem,
  ChannelGoal,
  CommentDraft,
  CompetitorBookmark,
  ContentIdea,
  PlannerItem,
  PlannerStatus,
  WorkspaceState,
} from "./types.js";
import { normalizeAnalysisResult } from "./analysis-result.js";
import { protectSpreadsheetCell } from "./format.js";

const PLANNER_STATUSES = new Set<PlannerStatus>([
  "idea",
  "draft",
  "scheduled",
  "ready",
  "published",
]);

/** chrome.storage.local key the service worker keeps the workspace under. */
export const WORKSPACE_STORAGE_KEY = "channelpilotWorkspaceV1";

export const DEFAULT_WORKSPACE_STATE: WorkspaceState = {
  schemaVersion: 1,
  competitors: [],
  ideas: [],
  planner: [],
  commentDrafts: [],
  aiHistory: [],
  favoriteTitles: [],
  goals: [],
  updatedAt: "",
};

function text(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function isoDate(value: unknown): string {
  const raw = text(value, 64);
  const time = Date.parse(raw);
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function id(value: unknown): string {
  return text(value, 160).replace(/[^\p{L}\p{N}_.:-]/gu, "");
}

function number(value: unknown, minimum: number, maximum: number): number {
  const candidate = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(candidate)
    ? Math.max(minimum, Math.min(maximum, candidate))
    : minimum;
}

function stringList(
  value: unknown,
  maximumItems: number,
  maximumLength: number,
): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(value.map((item) => text(item, maximumLength)).filter(Boolean)),
  ].slice(0, maximumItems);
}

function competitors(value: unknown): CompetitorBookmark[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const source = item as Partial<CompetitorBookmark>;
      const channelId = id(source.channelId);
      const title = text(source.title, 180);
      if (!channelId || !title) return [];
      return [
        {
          channelId,
          title,
          avatarUrl: text(source.avatarUrl, 2_048),
          addedAt: isoDate(source.addedAt) || new Date(0).toISOString(),
        },
      ];
    })
    .slice(0, 25);
}

function ideas(value: unknown): ContentIdea[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const source = item as Partial<ContentIdea>;
      const ideaId = id(source.id);
      const title = text(source.title, 240);
      if (!ideaId || !title) return [];
      const difficulty =
        source.difficulty === "easy" ||
        source.difficulty === "hard" ||
        source.difficulty === "medium"
          ? source.difficulty
          : "medium";
      const normalized: ContentIdea = {
        id: ideaId,
        title,
        angle: text(source.angle, 1_000),
        format: source.format === "shorts" ? "shorts" : "long",
        difficulty,
        interest: Math.round(number(source.interest, 0, 100)),
        source: source.source === "ai" ? "ai" : "manual",
        createdAt: isoDate(source.createdAt) || new Date(0).toISOString(),
      };
      return [normalized];
    })
    .slice(0, 300);
}

function planner(value: unknown): PlannerItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const source = item as Partial<PlannerItem>;
      const itemId = id(source.id);
      const title = text(source.title, 240);
      if (!itemId || !title) return [];
      const status = PLANNER_STATUSES.has(source.status as PlannerStatus)
        ? (source.status as PlannerStatus)
        : "idea";
      return [
        {
          id: itemId,
          title,
          status,
          publishAt: isoDate(source.publishAt),
          notes: text(source.notes, 5_000),
          tags: stringList(source.tags, 30, 100),
          createdAt: isoDate(source.createdAt) || new Date(0).toISOString(),
          updatedAt: isoDate(source.updatedAt) || new Date(0).toISOString(),
        },
      ];
    })
    .slice(0, 500);
}

function commentDrafts(value: unknown): CommentDraft[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const source = item as Partial<CommentDraft>;
      const commentId = id(source.commentId);
      const draftText = text(source.text, 5_000);
      if (!commentId || !draftText) return [];
      return [
        {
          commentId,
          videoId: id(source.videoId),
          text: draftText,
          tone: text(source.tone, 80) || "professional",
          createdAt: isoDate(source.createdAt) || new Date(0).toISOString(),
        },
      ];
    })
    .slice(0, 300);
}

function aiHistory(value: unknown): AiHistoryItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const source = item as Partial<AiHistoryItem>;
      const historyId = id(source.id);
      // Older builds stored results without fields the UI now reads; bring
      // them up to the current shape instead of handing the renderer a crash.
      const result = normalizeAnalysisResult(source.result);
      if (!historyId || !result) {
        return [];
      }
      const task =
        source.task === "idea_generation" || source.task === "comment_reply"
          ? source.task
          : "video_optimization";
      const normalized: AiHistoryItem = {
        id: historyId,
        task,
        topic: text(source.topic, 500),
        result,
        createdAt: isoDate(source.createdAt) || new Date(0).toISOString(),
      };
      return [normalized];
    })
    .slice(-30);
}

function goals(value: unknown): ChannelGoal[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const source = item as Partial<ChannelGoal>;
      const goalId = id(source.id);
      const label = text(source.label, 160);
      if (!goalId || !label) return [];
      const unit =
        source.unit === "views" || source.unit === "videos"
          ? source.unit
          : "subscribers";
      const normalized: ChannelGoal = {
        id: goalId,
        label,
        target: Math.round(number(source.target, 0, 1_000_000_000_000)),
        current: Math.round(number(source.current, 0, 1_000_000_000_000)),
        unit,
        deadline: isoDate(source.deadline),
      };
      return [normalized];
    })
    .slice(0, 20);
}

export function normalizeWorkspaceState(input: unknown): WorkspaceState {
  const source =
    input && typeof input === "object" ? (input as Partial<WorkspaceState>) : {};
  return {
    schemaVersion: 1,
    competitors: competitors(source.competitors),
    ideas: ideas(source.ideas),
    planner: planner(source.planner),
    commentDrafts: commentDrafts(source.commentDrafts),
    aiHistory: aiHistory(source.aiHistory),
    favoriteTitles: stringList(source.favoriteTitles, 100, 160),
    goals: goals(source.goals),
    updatedAt: isoDate(source.updatedAt),
  };
}

const PLANNER_CSV_COLUMNS = [
  "id",
  "title",
  "status",
  "publishAt",
  "notes",
  "tags",
  "createdAt",
  "updatedAt",
] as const;

function csvCell(value: string): string {
  return `"${protectSpreadsheetCell(value).replaceAll('"', '""')}"`;
}

/**
 * Creates an RFC 4180-style CSV while neutralizing spreadsheet formula cells.
 */
export function serializePlannerCsv(items: PlannerItem[]): string {
  const rows = items.map((item) =>
    [
      item.id,
      item.title,
      item.status,
      item.publishAt,
      item.notes,
      JSON.stringify(item.tags),
      item.createdAt,
      item.updatedAt,
    ]
      .map(csvCell)
      .join(","),
  );
  return [`\uFEFF${PLANNER_CSV_COLUMNS.join(",")}`, ...rows].join("\r\n");
}

function parseCsvRows(input: string): string[][] {
  if (input.length > 2_000_000) throw new Error("Planner CSV is too large");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = input.replace(/^\uFEFF/u, "");
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/u, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  row.push(cell.replace(/\r$/u, ""));
  if (row.some(Boolean) || rows.length === 0) rows.push(row);
  return rows;
}

function plannerImportId(title: string, index: number): string {
  let hash = 2_166_136_261;
  for (const character of title) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return `csv-${index + 1}-${(hash >>> 0).toString(36)}`;
}

function importedCell(value: string | undefined): string {
  const source = value?.trim() ?? "";
  return /^'[=+\-@]/u.test(source) ? source.slice(1) : source;
}

/**
 * Parses planner CSV without evaluating content. Oversized files are rejected;
 * invalid card fields are normalized by the same rules as chrome.storage.
 */
export function parsePlannerCsv(input: string): PlannerItem[] {
  const [headerRow = [], ...rows] = parseCsvRows(input);
  if (rows.length > 500) throw new Error("Planner CSV has more than 500 rows");
  const headers = headerRow.map((value) => importedCell(value));
  const column = (name: (typeof PLANNER_CSV_COLUMNS)[number]) => headers.indexOf(name);
  if (column("title") < 0) return [];
  const value = (row: string[], name: (typeof PLANNER_CSV_COLUMNS)[number]) => {
    const index = column(name);
    return index >= 0 ? importedCell(row[index]) : "";
  };
  const candidates = rows.flatMap((row, index) => {
    const title = value(row, "title");
    if (!title) return [];
    const rawTags = value(row, "tags");
    let tags: string[] = [];
    try {
      const parsed = JSON.parse(rawTags) as unknown;
      tags = Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : [];
    } catch {
      tags = rawTags
        .split(/[|;]/u)
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return [
      {
        id: value(row, "id") || plannerImportId(title, index),
        title,
        status: value(row, "status"),
        publishAt: value(row, "publishAt"),
        notes: value(row, "notes"),
        tags,
        createdAt: value(row, "createdAt"),
        updatedAt: value(row, "updatedAt"),
      },
    ];
  });
  return normalizeWorkspaceState({ planner: candidates }).planner;
}
