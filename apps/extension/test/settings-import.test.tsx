import { afterAll, expect, it, vi } from "vitest";
import { act } from "react";
import type { ExtensionRequest } from "@channelpilot/shared";
import { createChromeFixture } from "./analytics-fixtures";

const mounted = vi.hoisted(() => ({ roots: [] as Array<{ unmount: () => void }> }));

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
  vi.unstubAllGlobals();
});

it("imports only supported non-secret settings from a bounded JSON file", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fixture = createChromeFixture();
  fixture.settings.geminiApiKey = "keep-local-secret";
  const sent: ExtensionRequest[] = [];
  const sendMessage = fixture.chrome.runtime.sendMessage.bind(fixture.chrome.runtime);
  fixture.chrome.runtime.sendMessage = async (message: ExtensionRequest) => {
    sent.push(message);
    return sendMessage(message);
  };
  vi.stubGlobal("chrome", fixture.chrome);
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    await import("../src/options/main");
  });
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>('button[aria-label="Connections"]')!
      .click();
  });
  const input = document.querySelector<HTMLInputElement>(
    '.data-settings input[type="file"]',
  )!;
  const choose = async (file: File) => {
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };
  await choose(
    new File(
      [
        JSON.stringify({
          schemaVersion: 1,
          settings: {
            theme: "light",
            geminiApiKey: "overwrite-secret",
            unsupportedSetting: "ignored",
          },
        }),
      ],
      "settings.json",
      { type: "application/json" },
    ),
  );
  expect(fixture.settings.theme).toBe("light");
  expect(fixture.settings.geminiApiKey).toBe("keep-local-secret");
  const imports = sent.filter(
    (message) => message.type === "SAVE_SETTINGS_TRUSTED_PATCH",
  );
  expect(imports).toHaveLength(1);
  expect(imports[0]).toMatchObject({ payload: { theme: "light" } });

  await choose(
    new File(
      [JSON.stringify({ schemaVersion: 1, settings: { interfaceLanguage: "ru" } })],
      "language.json",
      { type: "application/json" },
    ),
  );
  expect(fixture.settings.interfaceLanguage).toBe("ru");
  expect(sent.filter((message) => message.type === "GET_DASHBOARD")).toHaveLength(2);
  expect(document.documentElement.lang).toBe("ru");

  await choose(
    new File(["x".repeat(1_000_001)], "oversized.json", {
      type: "application/json",
    }),
  );
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "слишком большой",
  );
  await choose(
    new File([JSON.stringify({ settings: [] })], "invalid.json", {
      type: "application/json",
    }),
  );
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "неверный формат",
  );
  expect(
    sent.filter((message) => message.type === "SAVE_SETTINGS_TRUSTED_PATCH"),
  ).toHaveLength(2);

  const currentSend = fixture.chrome.runtime.sendMessage.bind(fixture.chrome.runtime);
  fixture.chrome.runtime.sendMessage = async (message: ExtensionRequest) =>
    message.type === "AUTH_STATUS"
      ? { ok: false as const, error: "Auth status unavailable" }
      : currentSend(message);
  await choose(
    new File(
      [JSON.stringify({ schemaVersion: 1, settings: { theme: "dark" } })],
      "theme.json",
      { type: "application/json" },
    ),
  );
  expect(fixture.settings.theme).toBe("dark");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "Настройки сохранены, но не удалось проверить подключение Google",
  );
  expect(document.querySelector('[role="alert"]')?.textContent).not.toContain(
    "Импорт не выполнен",
  );
});
