import type { ExtensionRequest, ExtensionResponse } from "@channelpilot/shared";

// These messages are raised before any settings can be read, so the browser
// language stands in for the interface language.
function localized(ru: string, en: string): string {
  return typeof navigator !== "undefined" &&
    !navigator.language?.toLowerCase().startsWith("ru")
    ? en
    : ru;
}

function reloadMessage(): string {
  return localized(
    "Расширение было обновлено или отключено. Перезагрузите страницу и повторите.",
    "The extension was updated or disabled. Reload the page and try again.",
  );
}

export async function rpc<T>(message: ExtensionRequest): Promise<T> {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
    throw new Error(
      localized(
        "Откройте ChannelPilot из установленного расширения Chrome. API расширения недоступно в обычной вкладке.",
        "Open ChannelPilot from the installed Chrome extension. The extension API is unavailable in a regular tab.",
      ),
    );
  }
  // Annotated rather than asserted: sendMessage is typed `Promise<any>`, and an
  // annotation gives the same narrowing without an assertion the linter has to
  // take on faith. The shape is validated below regardless.
  let response: ExtensionResponse<T> | undefined;
  try {
    response = await chrome.runtime.sendMessage(message);
  } catch (error) {
    // After an update or reload Chrome rejects with "Extension context
    // invalidated." — technical English the widget used to show verbatim in
    // every YouTube tab that was open at the time.
    if (
      error instanceof Error &&
      /context invalidated|receiving end does not exist/i.test(error.message)
    ) {
      throw new Error(reloadMessage());
    }
    throw error;
  }
  if (!response || typeof response !== "object" || !("ok" in response)) {
    throw new Error(reloadMessage());
  }
  if (!response.ok) throw new Error(response.error);
  return response.data;
}
