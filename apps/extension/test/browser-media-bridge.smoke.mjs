// Manual Chrome integration smoke: node apps/extension/test/browser-media-bridge.smoke.mjs
// Uses a disposable profile and an intercepted Studio document; never uploads media.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const extensionDir = resolve(fileURLToPath(new URL("../dist", import.meta.url)));
const chromePath =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
if (!existsSync(chromePath)) throw new Error(`Chrome not found: ${chromePath}`);
if (!existsSync(join(extensionDir, "manifest.json")))
  throw new Error("Build the extension before running the browser smoke test");

const manifest = JSON.parse(
  await readFile(join(extensionDir, "manifest.json"), "utf8"),
);
const hash = createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest();
const extensionId = Array.from(hash.subarray(0, 16), (byte) =>
  String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15)),
).join("");
const profile = await mkdtemp(join(tmpdir(), "channelpilot-bridge-smoke-"));
const browserProcess = spawn(
  chromePath,
  [
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--enable-unsafe-extension-debugging",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { windowsHide: true, stdio: "ignore" },
);

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
async function waitForPort() {
  const file = join(profile, "DevToolsActivePort");
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (browserProcess.exitCode !== null)
      throw new Error(`Chrome exited with ${browserProcess.exitCode}`);
    if (existsSync(file)) return (await readFile(file, "utf8")).split("\n")[0];
    await delay(100);
  }
  throw new Error("Chrome did not open its debugging port");
}

let socket;
try {
  const port = await waitForPort();
  const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) =>
    r.json(),
  );
  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((done, fail) => {
    socket.addEventListener("open", done, { once: true });
    socket.addEventListener("error", fail, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  const events = new Set();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    } else for (const listener of events) listener(message);
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolveRequest, rejectRequest) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectRequest(new Error(`CDP timed out: ${method}`));
      }, 20_000);
      pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });

  const loaded = await send("Extensions.loadUnpacked", { path: extensionDir });
  if (loaded.id !== extensionId)
    throw new Error(`Unexpected extension id: ${loaded.id}`);

  const bridgeUrl = `chrome-extension://${extensionId}/src/media-bridge/index.html`;
  const { targetId: prepTargetId } = await send("Target.createTarget", {
    url: bridgeUrl,
  });
  const { sessionId: prepSessionId } = await send("Target.attachToTarget", {
    targetId: prepTargetId,
    flatten: true,
  });
  const prepContexts = [];
  const onPrepContext = (event) => {
    if (
      event.sessionId === prepSessionId &&
      event.method === "Runtime.executionContextCreated"
    )
      prepContexts.push(event.params.context);
  };
  events.add(onPrepContext);
  await send("Runtime.enable", {}, prepSessionId);
  let prepContext;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    prepContext = prepContexts.find(
      (entry) => entry.origin === `chrome-extension://${extensionId}`,
    );
    if (prepContext) break;
    await delay(100);
  }
  if (!prepContext) throw new Error("Could not open extension setup page");
  const setup = await send(
    "Runtime.evaluate",
    {
      expression: "chrome.storage.local.set({settings:{allowAiMediaUploads:true}})",
      contextId: prepContext.id,
      awaitPromise: true,
    },
    prepSessionId,
  );
  if (setup.exceptionDetails)
    throw new Error(`Could not set smoke permissions: ${setup.exceptionDetails.text}`);
  events.delete(onPrepContext);
  await send("Target.closeTarget", { targetId: prepTargetId });

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const contexts = [];
  events.add((event) => {
    if (
      event.sessionId === sessionId &&
      event.method === "Runtime.executionContextCreated"
    )
      contexts.push(event.params.context);
    if (event.sessionId === sessionId && event.method === "Fetch.requestPaused") {
      const { requestId, request } = event.params;
      if (!request.url.startsWith("https://studio.youtube.com/")) return;
      const body = Buffer.from(
        "<!doctype html><html><head><title>ChannelPilot bridge smoke</title></head><body><h1>Studio fixture</h1><input id='studio-upload' type='file'></body></html>",
      ).toString("base64");
      void send(
        "Fetch.fulfillRequest",
        {
          requestId,
          responseCode: 200,
          responseHeaders: [
            { name: "Content-Type", value: "text/html; charset=utf-8" },
            {
              name: "Content-Security-Policy",
              value: "default-src 'none'; frame-src 'none'; script-src 'none'",
            },
          ],
          body,
        },
        sessionId,
      ).catch((error) => process.stderr.write(`${error.message}\n`));
    }
  });
  await send("Runtime.enable", {}, sessionId);
  await send("Page.enable", {}, sessionId);
  await send(
    "Fetch.enable",
    { patterns: [{ urlPattern: "https://studio.youtube.com/*" }] },
    sessionId,
  );
  await send("Page.navigate", { url: "https://studio.youtube.com/" }, sessionId);

  let context;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    context = contexts.find(
      (entry) => entry.origin === `chrome-extension://${extensionId}`,
    );
    if (context) break;
    await delay(100);
  }
  if (!context) {
    const targets = (await send("Target.getTargets")).targetInfos.map(
      ({ type, url }) => ({ type, url }),
    );
    throw new Error(
      `Extension content world did not load: ${JSON.stringify({ expectedOrigin: `chrome-extension://${extensionId}`, contexts: contexts.map(({ origin, name }) => ({ origin, name })), targets })}`,
    );
  }

  const expression = `(() => new Promise(async (resolveTest) => {
    const finish = (result) => { frame?.remove(); resolveTest(result); };
    let frame;
    try {
      const session = await chrome.runtime.sendMessage({ type: 'CREATE_MEDIA_BRIDGE_SESSION' });
      if (!session?.ok) throw new Error(session?.error || 'Could not create session');
      const token = session.data;
      const channel = new MessageChannel();
      const messages = [];
      const timer = setTimeout(() => finish({ error: 'Bridge timeout', messages }), 12000);
      channel.port1.onmessage = ({ data }) => {
        messages.push(data.type);
        if (data.type === 'READY') {
          channel.port1.postMessage({
            type: 'ANALYZE',
            context: { title: 'Smoke', description: '', tags: [], language: 'en' },
            file: new File(['smoke'], 'sample.mp4', { type: 'video/mp4' }),
          });
        } else if (data.type === 'ERROR' || data.type === 'RESULT') {
          clearTimeout(timer);
          channel.port1.close();
          finish({ messages, response: data.type, error: data.error || '' });
        }
      };
      frame = document.createElement('iframe');
      frame.src = chrome.runtime.getURL('src/media-bridge/index.html');
      frame.onload = () => frame.contentWindow.postMessage(
        { type: 'CHANNELPILOT_MEDIA_CONNECT', token },
        new URL(frame.src).origin,
        [channel.port2],
      );
      document.documentElement.append(frame);
    } catch (error) {
      finish({ error: String(error) });
    }
  }))()`;
  const evaluated = await send(
    "Runtime.evaluate",
    { expression, contextId: context.id, awaitPromise: true, returnByValue: true },
    sessionId,
  );
  if (evaluated.exceptionDetails)
    throw new Error(`Chrome runtime error: ${evaluated.exceptionDetails.text}`);
  const result = evaluated.result.value;
  if (
    !result?.messages?.includes("READY") ||
    result.response !== "ERROR" ||
    result.error === "Invalid media analysis request"
  )
    throw new Error(`Media bridge failed: ${JSON.stringify(result)}`);

  const pageContext = contexts.find(
    (entry) =>
      entry.origin === "https://studio.youtube.com" && entry.auxData?.isDefault,
  );
  if (!pageContext) throw new Error("Studio page context did not load");
  let contentMounted = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = await send(
      "Runtime.evaluate",
      {
        expression: "Boolean(document.getElementById('channelpilot-extension-root'))",
        contextId: pageContext.id,
        returnByValue: true,
      },
      sessionId,
    );
    if (state.result.value) {
      contentMounted = true;
      break;
    }
    await delay(100);
  }
  if (!contentMounted) throw new Error("ChannelPilot content UI did not mount");

  const selection = await send(
    "Runtime.evaluate",
    {
      contextId: pageContext.id,
      awaitPromise: true,
      returnByValue: true,
      expression: `(() => new Promise(async (resolveSelection) => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 32;
          canvas.height = 32;
          const context = canvas.getContext('2d');
          const stream = canvas.captureStream(12);
          const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
          const chunks = [];
          recorder.ondataavailable = ({ data }) => { if (data.size) chunks.push(data); };
          const recorded = new Promise((resolveRecorded) => {
            recorder.onstop = () => resolveRecorded(new Blob(chunks, { type: 'video/webm' }));
          });
          const paint = setInterval(() => {
            context.fillStyle = '#6644ff';
            context.fillRect(0, 0, 32, 32);
          }, 30);
          recorder.start();
          setTimeout(() => recorder.stop(), 450);
          const blob = await recorded;
          clearInterval(paint);
          stream.getTracks().forEach((track) => track.stop());
          const selected = new File([blob], 'channelpilot-smoke.webm', { type: 'video/webm' });
          const input = document.getElementById('studio-upload');
          const transfer = new DataTransfer();
          transfer.items.add(selected);
          const found = new Promise((resolveFound) => {
            const observer = new MutationObserver((changes) => {
              for (const change of changes) for (const node of change.addedNodes) {
                if (node instanceof HTMLIFrameElement && node.src.includes('/src/media-bridge/index.html')) {
                  observer.disconnect();
                  resolveFound(true);
                }
              }
            });
            observer.observe(document.documentElement, { childList: true, subtree: true });
            setTimeout(() => { observer.disconnect(); resolveFound(false); }, 15000);
          });
          input.files = transfer.files;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          const bridgeOpened = await found;
          resolveSelection({ bridgeOpened, bytes: selected.size });
        } catch (error) {
          resolveSelection({ error: String(error) });
        }
      }))()`,
    },
    sessionId,
  );
  if (selection.exceptionDetails || !selection.result.value?.bridgeOpened)
    throw new Error(`Studio file selection failed: ${JSON.stringify(selection)}`);
  let renderedError = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const state = await send(
      "Runtime.evaluate",
      {
        expression:
          "Boolean(document.getElementById('channelpilot-extension-root')?.shadowRoot?.textContent?.includes('Подключите Gemini'))",
        contextId: pageContext.id,
        returnByValue: true,
      },
      sessionId,
    );
    if (state.result.value) {
      renderedError = true;
      break;
    }
    await delay(100);
  }
  if (!renderedError) {
    const diagnostic = await send(
      "Runtime.evaluate",
      {
        expression:
          "({root:document.getElementById('channelpilot-extension-root')?.shadowRoot?.textContent?.slice(-2000),inline:[...document.querySelectorAll('[data-channelpilot-inline]')].map(node=>node.shadowRoot?.textContent?.slice(-500)),frames:document.querySelectorAll('iframe[src*=media-bridge]').length})",
        contextId: pageContext.id,
        returnByValue: true,
      },
      sessionId,
    );
    throw new Error(
      `The Studio upload error was not rendered in the content UI: ${JSON.stringify(diagnostic.result.value)}`,
    );
  }
  if (process.env.CP_SMOKE_SCREENSHOT) {
    const capture = await send("Page.captureScreenshot", { format: "png" }, sessionId);
    await writeFile(
      process.env.CP_SMOKE_SCREENSHOT,
      Buffer.from(capture.data, "base64"),
    );
  }
  const openNotice = await send(
    "Runtime.evaluate",
    {
      expression:
        "(() => { const button = document.getElementById('channelpilot-extension-root')?.shadowRoot?.querySelector('.cp-media-notice-open'); button?.click(); return Boolean(button); })()",
      contextId: pageContext.id,
      returnByValue: true,
    },
    sessionId,
  );
  if (!openNotice.result.value) throw new Error("The upload notice has no open action");
  let panelOpened = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const state = await send(
      "Runtime.evaluate",
      {
        expression:
          "Boolean(document.getElementById('channelpilot-extension-root')?.shadowRoot?.querySelector('.cp-panel')?.textContent?.includes('Подключите Gemini'))",
        contextId: pageContext.id,
        returnByValue: true,
      },
      sessionId,
    );
    if (state.result.value) {
      panelOpened = true;
      break;
    }
    await delay(100);
  }
  if (!panelOpened)
    throw new Error("The upload notice did not open the error in the panel");
  process.stdout.write(
    `Chrome media bridge smoke passed: ${JSON.stringify({ direct: result.messages, selectedBytes: selection.result.value.bytes, uploadFlow: "notice and panel verified" })}\n`,
  );
  await send("Browser.close").catch(() => undefined);
} finally {
  socket?.close();
  if (browserProcess.exitCode === null) browserProcess.kill();
  const resolved = resolve(profile);
  const tempRoot = resolve(tmpdir());
  if (
    resolved.startsWith(`${tempRoot}${sep}`) &&
    basename(resolved).startsWith("channelpilot-bridge-smoke-")
  ) {
    await rm(resolved, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
}
