import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DashboardTopbar } from "../src/options/dashboard-chrome";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

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

async function render(hasData: boolean, hasAiResult: boolean) {
  await act(async () =>
    root.render(
      <DashboardTopbar
        title="Overview"
        status="Updated"
        language="en"
        loading={false}
        signedIn={true}
        reauthRequired={false}
        hasData={hasData}
        hasAiResult={hasAiResult}
        onLanguage={vi.fn()}
        onRefresh={vi.fn()}
        onSignOut={vi.fn()}
        onSignIn={vi.fn()}
        onExport={vi.fn()}
        onExportAi={vi.fn()}
      />,
    ),
  );
}

it("only exposes export actions with a matching result", async () => {
  await render(false, false);
  expect(container.textContent).not.toContain("Export");
  expect(container.textContent).not.toContain("JSON");

  await render(true, false);
  expect(container.textContent).toContain("all analytics");
  expect(container.textContent).toContain("28-day history");
  expect(container.textContent).not.toContain("AI analysis");

  await render(false, true);
  expect(container.textContent).toContain("AI analysis");
  expect(container.textContent).not.toContain("all analytics");
});
