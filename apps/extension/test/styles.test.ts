import { describe, expect, it } from "vitest";
import { panelStyles } from "../src/content/styles";

/**
 * The panel stylesheet is an 85 KB template literal. Two classes of mistake
 * are invisible until the widget is rendered in a browser:
 *
 *  - a backtick in a CSS comment silently terminates the literal (this broke
 *    the build twice while the stylesheet was being reworked);
 *  - an unbalanced brace swallows every rule after it, so the panel loses its
 *    styling from that point down but still renders.
 *
 * Neither is caught by tsc once the file happens to parse, so they are asserted
 * here instead.
 */
describe("panelStyles integrity", () => {
  it("is a single non-trivial stylesheet", () => {
    expect(typeof panelStyles).toBe("string");
    expect(panelStyles.length).toBeGreaterThan(10_000);
  });

  it("contains no backticks", () => {
    // A backtick would have terminated the literal early: whatever survived
    // would still be a valid string, just truncated.
    expect(panelStyles).not.toContain("`");
  });

  it("has balanced braces", () => {
    let depth = 0;
    let lowest = 0;
    for (const character of panelStyles) {
      if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
      if (depth < lowest) lowest = depth;
    }
    expect(lowest).toBe(0);
    expect(depth).toBe(0);
  });

  it("keeps the selectors the content script renders against", () => {
    // A rename in the stylesheet without a matching rename in the JSX leaves an
    // unstyled element, which looks like a rendering bug rather than a typo.
    for (const selector of [
      ".cp-panel",
      ".cp-header",
      ".cp-tabs",
      ".cp-scroll",
      ".cp-actions",
      ".cp-pro-kpis",
      ".cp-history-chart",
      ".cp-field",
      ".cp-primary",
      ".cp-realtime",
      ".cp-top-dock",
      ".cp-launcher",
    ]) {
      expect(panelStyles).toContain(selector);
    }
  });

  it("defines a light theme for the panel", () => {
    expect(panelStyles).toContain('.cp-panel[data-theme="light"]');
  });

  it("respects reduced motion and reduced transparency", () => {
    expect(panelStyles).toContain("prefers-reduced-motion");
    expect(panelStyles).toContain("prefers-reduced-transparency");
  });
});
