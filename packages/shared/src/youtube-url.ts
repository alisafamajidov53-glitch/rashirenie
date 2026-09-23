const VIDEO_ID = /^[\w-]{11}$/;

/**
 * Extracts a video ID from a YouTube or YouTube Studio link. Plain text and
 * bare IDs return null so a topic that happens to be 11 characters long is
 * never mistaken for a video.
 */
export function youtubeVideoIdFromUrl(value: string): string | null {
  const text = value.trim();
  if (
    !/^https?:\/\//i.test(text) &&
    !/^(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//i.test(text)
  ) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(?:www|m|music)\./, "");
  const segments = url.pathname.split("/").filter(Boolean);
  let candidate: string | null | undefined = null;
  if (host === "youtu.be") {
    candidate = segments[0];
  } else if (host === "youtube.com") {
    candidate =
      segments[0] === "watch"
        ? url.searchParams.get("v")
        : ["shorts", "live", "embed", "v"].includes(segments[0] ?? "")
          ? segments[1]
          : null;
  } else if (host === "studio.youtube.com" && segments[0] === "video") {
    candidate = segments[1];
  }
  return candidate && VIDEO_ID.test(candidate) ? candidate : null;
}
