import type { AnalysisResult, VideoContext } from "@channelpilot/shared";
import type { MediaAnalysisProgressCallback } from "../lib/ai-direct";
import { rpc } from "../lib/rpc";

const BRIDGE_PATH = "src/media-bridge/index.html";
const STARTUP_TIMEOUT_MS = 20_000;
const ANALYSIS_TIMEOUT_MS = 15 * 60_000;

export async function analyzeMediaInBridge(
  context: VideoContext,
  file: File,
  onProgress?: MediaAnalysisProgressCallback,
  signal?: AbortSignal,
): Promise<AnalysisResult> {
  if (signal?.aborted) throw new DOMException("Media analysis cancelled", "AbortError");
  const token = await rpc<string>({ type: "CREATE_MEDIA_BRIDGE_SESSION" });
  if (signal?.aborted) throw new DOMException("Media analysis cancelled", "AbortError");
  const frame = document.createElement("iframe");
  frame.src = chrome.runtime.getURL(BRIDGE_PATH);
  frame.title = "ChannelPilot media analysis";
  frame.referrerPolicy = "no-referrer";
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText =
    "position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none";
  const origin = new URL(frame.src).origin;
  const channel = new MessageChannel();

  return new Promise<AnalysisResult>((resolve, reject) => {
    let ready = false;
    let settled = false;
    let removed = false;
    let cleanupTimer: number | undefined;
    let startupTimer: number | undefined;
    let analysisTimer: number | undefined;
    const cleanup = () => {
      if (removed) return;
      removed = true;
      window.clearTimeout(startupTimer);
      window.clearTimeout(analysisTimer);
      window.clearTimeout(cleanupTimer);
      signal?.removeEventListener("abort", onAbort);
      channel.port1.close();
      channel.port2.close();
      frame.remove();
    };
    const finish = (error?: Error, result?: AnalysisResult) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else if (result) resolve(result);
      else reject(new Error("Media bridge returned no result"));
      cleanup();
    };
    const cancel = (reason: string) => {
      if (settled) return;
      settled = true;
      try {
        channel.port1.postMessage({ type: "CANCEL" });
      } catch {
        // Removing the frame below still stops its work if its port closed.
      }
      reject(new DOMException(reason, "AbortError"));
      if (!ready) cleanup();
      else cleanupTimer = window.setTimeout(cleanup, 30_000);
    };
    const onAbort = () => cancel("Media analysis cancelled");
    signal?.addEventListener("abort", onAbort, { once: true });
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      const message = event.data;
      if (!message || typeof message !== "object") return;
      const payload = message as {
        type?: unknown;
        progress?: Parameters<MediaAnalysisProgressCallback>[0];
        result?: AnalysisResult;
        error?: string;
      };
      if (settled) {
        if (payload.type === "ERROR" || payload.type === "RESULT") cleanup();
        return;
      }
      if (payload.type === "READY") {
        if (ready) return;
        ready = true;
        window.clearTimeout(startupTimer);
        try {
          channel.port1.postMessage({ type: "ANALYZE", context, file });
          analysisTimer = window.setTimeout(
            () => cancel("Media analysis timed out"),
            ANALYSIS_TIMEOUT_MS,
          );
        } catch {
          finish(new Error("Could not transfer the video to the media bridge"));
        }
      } else if (payload.type === "PROGRESS" && payload.progress) {
        onProgress?.(payload.progress);
      } else if (payload.type === "RESULT") {
        finish(undefined, payload.result);
      } else if (payload.type === "ERROR") {
        finish(new Error(payload.error || "Media analysis failed"));
      }
    };
    channel.port1.onmessageerror = () => finish(new Error("Media bridge disconnected"));
    frame.onload = () => {
      if (settled) return;
      if (!frame.contentWindow) {
        finish(new Error("Media bridge did not load"));
        return;
      }
      try {
        frame.contentWindow.postMessage(
          { type: "CHANNELPILOT_MEDIA_CONNECT", token },
          origin,
          [channel.port2],
        );
      } catch {
        finish(new Error("Media bridge could not connect"));
      }
    };
    frame.onerror = () => finish(new Error("Media bridge did not load"));
    startupTimer = window.setTimeout(
      () => finish(new Error("Media bridge timed out")),
      STARTUP_TIMEOUT_MS,
    );
    document.documentElement.append(frame);
    if (signal?.aborted) onAbort();
  });
}
