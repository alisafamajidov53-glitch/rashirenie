import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SeoPage } from "../src/options/workspace-pages";
import { dashboardFixture } from "./analytics-fixtures";

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
});

describe("SEO workspace", () => {
  it("keeps the score explanation and unavailable checks optional on mobile", async () => {
    const data = dashboardFixture();
    data.videos[0]!.contentType = "shorts";
    await act(async () => root.render(<SeoPage data={data} language="en" />));

    expect(container.querySelector("select")?.getAttribute("aria-label")).toBe(
      "Choose a video to inspect",
    );
    expect(container.querySelector(".performance-score-intro")?.textContent).toContain(
      "Data coverage: 20/100 · low",
    );
    expect(container.querySelector(".score-orbit")?.textContent).toContain("—");
    expect(container.querySelector(".performance-score-intro")?.textContent).toContain(
      "The score appears when coverage reaches 70/100",
    );
    expect(
      container.querySelector<HTMLDetailsElement>(".seo-score-details")?.open,
    ).toBe(false);
    expect(container.querySelector<HTMLDetailsElement>(".seo-unavailable")?.open).toBe(
      false,
    );
    expect(container.querySelector(".seo-checklist-card")?.textContent).toContain(
      "Video setup checklist",
    );
    expect(container.querySelector(".seo-checklist-card")?.textContent).toContain(
      "Not applicable to Shorts",
    );

    await act(async () =>
      container.querySelector<HTMLElement>(".seo-score-details summary")!.click(),
    );
    expect(
      container.querySelector<HTMLDetailsElement>(".seo-score-details")?.open,
    ).toBe(true);
    expect(container.querySelectorAll(".score-factors progress")).toHaveLength(6);
    expect(container.querySelector(".score-factors")?.textContent).toContain(
      "Observed velocity",
    );
    expect(container.querySelector(".score-factors")?.textContent).toContain(
      "Needs 3 same-format peers",
    );
    expect(container.querySelector(".score-factors")?.textContent).not.toContain(
      "Наблюдаемая",
    );
  });
});
