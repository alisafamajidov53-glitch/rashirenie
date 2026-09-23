import {
  normalizeExtensionSettings,
  safeErrorMessage,
  type AiAnalysisSettings,
  type VideoContext,
} from "@channelpilot/shared";
import { analyzeMediaDirect } from "../lib/ai-direct";
import { rpc } from "../lib/rpc";

const STUDIO_ORIGIN = "https://studio.youtube.com";
let connected = false;
let controller: AbortController | null = null;

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.settings?.newValue) return;
  if (!normalizeExtensionSettings(changes.settings.newValue).allowAiMediaUploads)
    controller?.abort();
});
window.addEventListener("pagehide", () => controller?.abort());

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (
    connected ||
    event.source !== window.parent ||
    event.origin !== STUDIO_ORIGIN ||
    !event.data ||
    typeof event.data !== "object" ||
    (event.data as { type?: unknown }).type !== "CHANNELPILOT_MEDIA_CONNECT" ||
    typeof (event.data as { token?: unknown }).token !== "string" ||
    event.ports.length !== 1
  )
    return;
  const token = (event.data as { token: string }).token;
  const port = event.ports[0]!;
  void rpc<AiAnalysisSettings>({ type: "REDEEM_MEDIA_BRIDGE_SESSION", token })
    .then((settings) => {
      if (connected) {
        port.close();
        return;
      }
      connected = true;
      let started = false;
      port.onmessage = (incoming: MessageEvent<unknown>) => {
        const message = incoming.data;
        if (!message || typeof message !== "object") return;
        const payload = message as {
          type?: unknown;
          context?: VideoContext;
          file?: File;
        };
        if (payload.type === "CANCEL") {
          controller?.abort();
          return;
        }
        if (started || payload.type !== "ANALYZE") return;
        started = true;
        controller = new AbortController();
        void (async () => {
          try {
            if (!(payload.file instanceof File) || !payload.context)
              throw new Error("Invalid media analysis request");
            const stored = await chrome.storage.local.get("settings");
            if (!normalizeExtensionSettings(stored.settings).allowAiMediaUploads)
              throw new Error("Media upload permission was revoked");
            const result = await analyzeMediaDirect(
              payload.context,
              payload.file,
              settings,
              (progress) => port.postMessage({ type: "PROGRESS", progress }),
              controller.signal,
            );
            port.postMessage({ type: "RESULT", result });
          } catch (error) {
            port.postMessage({
              type: "ERROR",
              error: safeErrorMessage(error, "Media analysis failed"),
            });
          } finally {
            controller = null;
          }
        })();
      };
      port.start();
      port.postMessage({ type: "READY" });
    })
    .catch((error: unknown) => {
      port.postMessage({
        type: "ERROR",
        error: safeErrorMessage(error, "Media bridge unavailable"),
      });
    });
});
