import { describe, expect, it } from "vitest";
import { persistablePanelLayout, resolvePanelLayout } from "../src/panel.js";

describe("panel layout", () => {
  it("keeps a restored panel inside a smaller viewport", () => {
    expect(
      resolvePanelLayout(
        { width: 700, height: 1_000, x: 1_900, y: 900 },
        { width: 800, height: 600 },
      ),
    ).toEqual({
      width: 700,
      height: 576,
      x: 88,
      y: 12,
    });
  });

  it("supports narrow viewports without creating negative coordinates", () => {
    const layout = resolvePanelLayout(
      { width: 440, height: 760, x: null, y: null },
      { width: 320, height: 480 },
    );
    expect(layout).toEqual({
      width: 296,
      // Opens below the site header rather than on top of it, and is sized to
      // fit in what is left — see "clears the site header" below.
      height: 400,
      x: 12,
      y: 68,
    });
    expect(persistablePanelLayout(layout)).toEqual(layout);
  });

  it("clears the site header when it has no stored position", () => {
    // YouTube's masthead is 56px and sticky. Opening at the plain 12px margin
    // covered the search field, the account menu and the extension's own
    // header widget.
    const layout = resolvePanelLayout(
      { width: 440, height: 760, x: null, y: null },
      { width: 1_440, height: 900 },
    );
    expect(layout.y).toBe(68);
    expect(layout.y + layout.height).toBeLessThanOrEqual(900 - 12);
  });

  it("honours a stored position even if it overlaps the header", () => {
    // Dragging the panel over the masthead is a legitimate choice; only the
    // default placement avoids it.
    const layout = resolvePanelLayout(
      { width: 440, height: 500, x: 100, y: 0 },
      { width: 1_440, height: 900 },
    );
    expect(layout.y).toBe(12);
    expect(layout.x).toBe(100);
  });

  it("lets a stored full-height panel keep using the whole viewport", () => {
    const layout = resolvePanelLayout(
      { width: 440, height: 2_000, x: 40, y: 0 },
      { width: 1_440, height: 900 },
    );
    expect(layout.height).toBe(876);
    expect(layout.y).toBe(12);
  });
});
