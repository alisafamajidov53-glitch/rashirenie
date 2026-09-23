// Development-only: realistic data for the visual previews (dashboard and
// on-page widget). The unit-test fixture keeps flat, identical values because
// assertions depend on them; designing against those hides every real layout
// problem — one title length, empty charts, identical rows.
import type { AnalyticsBreakdownItem } from "@channelpilot/shared";
import { createChromeFixture, videoFixture } from "./analytics-fixtures";

type Fixture = ReturnType<typeof createChromeFixture>;

function breakdown(
  rows: [key: string, label: string, views: number][],
): AnalyticsBreakdownItem[] {
  const total = rows.reduce((sum, [, , views]) => sum + views, 0);
  return rows.map(([key, label, views]) => ({
    key,
    label,
    views,
    estimatedMinutesWatched: Math.round(views * 0.42),
    share: total > 0 ? (views / total) * 100 : 0,
  }));
}

/** A small 16:9 SVG so every row has a distinct, recognisable thumbnail. */
function thumbnail(hue: number): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='320' height='180'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(${hue},70%,52%)'/><stop offset='1' stop-color='hsl(${(hue + 50) % 360},65%,26%)'/></linearGradient></defs><rect width='320' height='180' fill='url(#g)'/><circle cx='250' cy='70' r='46' fill='rgba(255,255,255,.18)'/><rect x='22' y='118' width='170' height='22' rx='5' fill='rgba(0,0,0,.35)'/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const TITLES = [
  "Old Minecraft Just Felt Different… 😢 #minecraft #shorts",
  "Minecraft Mobs Evolution: 2009 to 2026! 🟩",
  "Bro Thought He Was a Genius 💀 #minecraft #shorts",
  "Minecraft Then vs Now: Everything Changed 😱 #minecraft",
  "These Minecraft UNREAL Portals are IMPOSSIBLE 🤯 #shorts #gaming",
  "Я построил самую длинную железную дорогу в выживании за 100 дней",
];

export function enrichPreviewFixture(fixture: Fixture): void {
  const lastCompleteDay = new Date();
  lastCompleteDay.setUTCHours(0, 0, 0, 0);
  lastCompleteDay.setUTCDate(lastCompleteDay.getUTCDate() - 1);
  fixture.dashboard.history = fixture.dashboard.history.map((day, index, days) => {
    // A believable month: a weekly rhythm, a growth trend and one spike.
    const views = Math.round(
      2_600 + index * 95 + Math.sin(index / 1.1) * 520 + (index === 19 ? 3_900 : 0),
    );
    return {
      ...day,
      date: new Date(lastCompleteDay.getTime() - (days.length - index - 1) * 86_400_000)
        .toISOString()
        .slice(0, 10),
      views,
      estimatedMinutesWatched: Math.round(views * 0.48),
      subscribersGained: 6 + Math.round(views / 520),
      subscribersLost: 1 + (index % 4),
    };
  });

  fixture.dashboard.channel.title = "Demo · ChannelPilot";
  fixture.dashboard.channel.subscribers = 48_200;
  fixture.dashboard.channel.views = 3_418_000;
  fixture.dashboard.channel.videos = 214;
  const hourly = [312, 188, 146, 64, 21, 0];
  const trends = [84, 22, -18, 7, -41, 0];
  fixture.dashboard.videos = TITLES.map((title, index) => {
    const video = videoFixture(
      `preview${String(index).padStart(4, "0")}`,
      index % 3 === 0 ? "shorts" : "video",
    );
    video.title = title;
    video.thumbnailUrl = thumbnail(20 + index * 57);
    video.publishedAt = new Date(
      lastCompleteDay.getTime() - (2 + index * 3) * 86_400_000,
    ).toISOString();
    video.views = 9_000 + index * 27_300;
    video.likes = 80 + index * 910;
    video.comments = 3 + index * 24;
    video.observedViewsLastHour = hourly[index] ?? 0;
    video.observedViewsLast24Hours = (hourly[index] ?? 0) * 19 + 40;
    video.observedViewsLast48Hours = (hourly[index] ?? 0) * 35 + 90;
    video.viewsLast15Minutes = Math.round((hourly[index] ?? 0) / 4);
    // Kept consistent with the count above; the base fixture's 0.53 made every
    // row of the stand read "0.5 / мин" next to hundreds of views an hour.
    video.viewsPerMinuteLast15 = video.viewsLast15Minutes / 15;
    video.velocityTrendPercent = trends[index] ?? 0;
    video.analyticsViews28Days = 2_400 + index * 9_100;
    video.watchMinutes28Days = 2_500 + index * 3_900;
    video.subscribersGained28Days = 14 + ((index * 67) % 190);
    video.subscribersLost28Days = index * 2;
    if (index === TITLES.length - 1) {
      video.analyticsAvailable28Days = false;
      video.analyticsDetailAvailable28Days = false;
      video.observedMinutesLast15 = 0;
    }
    return video;
  });
  fixture.dashboard.channelObservedViewsLastHour = hourly.reduce((a, b) => a + b, 0);
  fixture.dashboard.channelObservedViewsLast24Hours = 17_940;
  fixture.dashboard.channelObservedViewsLast48Hours = 33_120;
  fixture.dashboard.trafficSources = breakdown([
    ["SHORTS", "Лента Shorts", 649_000],
    ["YT_SEARCH", "Поиск YouTube", 14_700],
    ["YT_CHANNEL", "Страницы каналов", 4_559],
    ["YT_OTHER_PAGE", "yt other page", 952],
    ["SUBSCRIBER", "Подписки и главная", 458],
  ]);
  fixture.dashboard.countries = breakdown([
    ["ID", "ID", 128_000],
    ["TR", "TR", 56_500],
    ["PH", "PH", 48_600],
    ["US", "US", 44_100],
    ["MX", "MX", 43_400],
  ]);
  fixture.dashboard.devices = breakdown([
    ["MOBILE", "Телефон", 484_000],
    ["TV", "Телевизор", 98_400],
    ["TABLET", "Планшет", 77_900],
    ["DESKTOP", "Компьютер", 9_599],
  ]);
  fixture.dashboard.subscribedStatus = breakdown([
    ["UNSUBSCRIBED", "Неподписанные зрители", 658_000],
    ["SUBSCRIBED", "Подписанные зрители", 13_200],
  ]);
  // 48 hours of 5-minute samples with a daily rhythm and a recent burst, so the
  // realtime charts have a real shape to draw.
  let views = 3_380_000;
  fixture.dashboard.realtimeSeries = Array.from({ length: 576 }, (_, index) => {
    const hourOfDay = ((index * 5) / 60) % 24;
    const rate = 18 + Math.sin(((hourOfDay - 6) / 24) * Math.PI * 2) * 12;
    const burst = index > 560 ? 30 : 0;
    views += Math.max(2, Math.round(rate + burst + Math.sin(index * 1.7) * 6));
    return { capturedAt: Date.now() - (575 - index) * 5 * 60_000, views };
  });
}
