import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "ChannelPilot AI",
  short_name: "ChannelPilot",
  version: "0.17.0",
  description:
    "AI-оптимизация и профессиональная аналитика для YouTube и YouTube Studio.",
  minimum_chrome_version: "120",
  icons: {
    16: "icon-16.png",
    32: "icon-32.png",
    48: "icon-48.png",
    128: "icon-128.png",
  },
  key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAlofDButYw8RQMYcuAXgK2Danq+SoX16EqntflyfvPbuk/LSu8ECqDIMg11DwJEIb6hz+7pT65TaHwMAs9glCc9BPWTlsxdXUlxIpIuyCQF4kDXWTtcUeFua0geZfgvcHy68p3QvBFnIj9hQZbffkbwb+atKcTdxHvw3C9iDOCaO4juiI4P3OGVIeAEz8JOcJpeIRzobpDDjytCz51Jhf1uUTlNXfXs2xkVKEcrxGYI6GBsI6Z5fLzGCFYq90SdHS1T87cXWl8Y4HSVaBsegCvvLBWjkZr6dW6tSXZEkijOBczpg+nR5kVY79777y+EGB8hCwaBmCb3Lh0zCiTcJmcQIDAQAB",
  // `unlimitedStorage` was dropped: the working set is bounded to 56 realtime
  // series (realtime-store.ts) pruned to 50 hours, and at the 5-minute
  // collection period that is roughly 2 MB — comfortably inside the default
  // 10 MB. Chrome Web Store review asks for a written justification for this
  // permission and there was none to give.
  permissions: ["identity", "storage", "alarms", "notifications"],
  host_permissions: [
    // accounts.google.com is intentionally absent: `launchWebAuthFlow` does not
    // need a host permission to open the consent screen, and the extension
    // never fetches that origin directly.
    "https://oauth2.googleapis.com/*",
    // Narrowed from googleapis.com/*, which granted every Google API. The only
    // endpoint used is the Data API (see DATA_API in background/youtube.ts).
    "https://www.googleapis.com/youtube/v3/*",
    "https://youtubeanalytics.googleapis.com/*",
    "https://generativelanguage.googleapis.com/*",
    "https://api.groq.com/*",
    "https://api.twelvelabs.io/*",
    "https://*.ytimg.com/*",
  ],
  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module",
  },
  action: {
    default_title: "ChannelPilot AI",
    default_popup: "src/popup/index.html",
    default_icon: {
      16: "icon-16.png",
      32: "icon-32.png",
      48: "icon-48.png",
      128: "icon-128.png",
    },
  },
  options_page: "src/options/index.html",
  content_scripts: [
    {
      matches: ["https://www.youtube.com/*", "https://studio.youtube.com/*"],
      js: ["src/content/index.tsx"],
      run_at: "document_idle",
    },
  ],
  web_accessible_resources: [
    {
      resources: ["src/media-bridge/index.html"],
      matches: ["https://studio.youtube.com/*"],
    },
  ],
});
