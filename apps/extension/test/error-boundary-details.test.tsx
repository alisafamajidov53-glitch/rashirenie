import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../src/components/ErrorBoundary";

afterAll(() => vi.unstubAllGlobals());

function Broken(): never {
  throw new TypeError("Cannot read properties of undefined (reading 'length')");
}

it("shows copyable technical details for a crash and logs them", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root")!);
  await act(async () => {
    root.render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );
  });
  const details = document.querySelector("details pre");
  expect(document.body.textContent).toContain("Технические подробности");
  expect(details?.textContent).toContain(
    "TypeError: Cannot read properties of undefined",
  );
  expect(details?.textContent).toContain("— component stack —");
  expect(
    logged.mock.calls.some((call) =>
      String(call[0]).includes("[ChannelPilot] React boundary"),
    ),
  ).toBe(true);
  await act(async () => root.unmount());
  logged.mockRestore();
});
