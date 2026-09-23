import { describe, expect, it, vi } from "vitest";
import {
  aggregateRealtimeSeries,
  appendRealtimePoint,
  combineRealtimeObservations,
  observedViewsInLastHour,
  observedViewsInLast24Hours,
  observedViewsInLast48Hours,
  pruneRealtimePoints,
  realtimeVelocity,
  realtimeWindowCoverage,
} from "../src/realtime.js";

describe("realtime sampling", () => {
  it("uses the real clock when a sample has an invalid timestamp", () => {
    const now = 2_000_000_000_000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const current = { capturedAt: now, views: 100, rawViews: 100 };
    const expired = { capturedAt: now - 51 * 60 * 60_000, views: 50, rawViews: 50 };
    try {
      expect(
        appendRealtimePoint([expired, current], { capturedAt: NaN, views: 102 }),
      ).toEqual([current]);
      expect(
        appendRealtimePoint([expired, current], { capturedAt: Infinity, views: 102 }),
      ).toEqual([current]);
    } finally {
      clock.mockRestore();
    }
  });
  it("preserves a valid minute when a malformed duplicate arrives", () => {
    const now = 2_000_000_000_000;
    const points = [{ capturedAt: now, views: 100, rawViews: 100 }];
    expect(appendRealtimePoint(points, { capturedAt: now, views: NaN }, now)).toEqual(
      points,
    );
    expect(
      appendRealtimePoint(
        points,
        { capturedAt: now, views: 101, rawViews: Infinity },
        now,
      ),
    ).toEqual(points);
  });
  it("calculates a rolling observed delta", () => {
    const now = 2_000_000_000_000;
    const points = [
      { capturedAt: now - 70 * 60_000, views: 100 },
      { capturedAt: now - 60 * 60_000, views: 105 },
      { capturedAt: now - 30 * 60_000, views: 123 },
      { capturedAt: now, views: 140 },
    ];

    expect(observedViewsInLastHour(points, now)).toEqual({
      views: 35,
      observedMinutes: 60,
    });
  });

  it("removes stale points while appending", () => {
    const now = 2_000_000_000_000;
    const result = appendRealtimePoint(
      [{ capturedAt: now - 51 * 60 * 60_000, views: 1 }],
      { capturedAt: now, views: 2 },
      now,
    );
    expect(result).toHaveLength(1);
  });

  it("calculates a 48-hour rolling delta without mixing duplicate sources", () => {
    const now = 2_000_000_000_000;
    const points = [
      { capturedAt: now - 49 * 60 * 60_000, views: 100 },
      { capturedAt: now - 48 * 60 * 60_000, views: 120 },
      { capturedAt: now - 24 * 60 * 60_000, views: 180 },
      { capturedAt: now, views: 250 },
    ];
    expect(observedViewsInLast48Hours(points, now)).toEqual({
      views: 130,
      observedMinutes: 2_880,
    });
  });

  it("does not reset a rolling window when a refreshed API counter regresses", () => {
    const now = 2_000_000_000_000;
    const result = appendRealtimePoint(
      [
        { capturedAt: now - 30 * 60_000, views: 1_000 },
        { capturedAt: now - 60_000, views: 1_026 },
      ],
      { capturedAt: now, views: 1_024 },
      now,
    );
    expect(result.at(-1)?.views).toBe(1_026);
    expect(observedViewsInLastHour(result, now)).toEqual({
      views: 26,
      observedMinutes: 30,
    });
  });

  it("does not double-count a temporary API counter regression", () => {
    const now = 2_000_000_000_000;
    let result = appendRealtimePoint(
      [
        {
          capturedAt: now - 3 * 60_000,
          views: 1_000,
          rawViews: 1_000,
        },
        {
          capturedAt: now - 2 * 60_000,
          views: 1_026,
          rawViews: 1_026,
        },
      ],
      {
        capturedAt: now - 60_000,
        views: 1_024,
        rawViews: 1_024,
      },
      now,
    );
    result = appendRealtimePoint(
      result,
      { capturedAt: now, views: 1_025, rawViews: 1_025 },
      now,
    );

    expect(result.at(-1)).toEqual({
      capturedAt: now,
      views: 1_026,
      rawViews: 1_025,
    });
    expect(observedViewsInLastHour(result, now).views).toBe(26);
  });

  it("does not count a partial recovery twice inside the same minute", () => {
    const now = 2_000_000_000_000;
    const first = appendRealtimePoint(
      [
        {
          capturedAt: now - 60_000,
          views: 1_026,
          rawViews: 1_026,
        },
      ],
      { capturedAt: now, views: 1_024, rawViews: 1_024 },
      now,
    );
    const second = appendRealtimePoint(
      first,
      { capturedAt: now, views: 1_025, rawViews: 1_025 },
      now,
    );

    expect(second.at(-1)).toEqual({
      capturedAt: now,
      views: 1_026,
      rawViews: 1_025,
    });
  });

  it("retains the highest raw counter seen inside the same minute", () => {
    const now = 2_000_000_000_000;
    const first = appendRealtimePoint(
      [
        {
          capturedAt: now - 60_000,
          views: 1_020,
          rawViews: 1_020,
        },
      ],
      { capturedAt: now, views: 1_026, rawViews: 1_026 },
      now,
    );
    const second = appendRealtimePoint(
      first,
      { capturedAt: now, views: 1_024, rawViews: 1_024 },
      now,
    );

    expect(second.at(-1)).toEqual({
      capturedAt: now,
      views: 1_026,
      rawViews: 1_026,
    });
  });

  it("resumes counting after the raw counter exceeds its previous high", () => {
    const now = 2_000_000_000_000;
    const result = appendRealtimePoint(
      [
        { capturedAt: now - 3 * 60_000, views: 1_000, rawViews: 1_000 },
        { capturedAt: now - 2 * 60_000, views: 1_026, rawViews: 1_026 },
        { capturedAt: now - 60_000, views: 1_026, rawViews: 1_024 },
      ],
      { capturedAt: now, views: 1_027, rawViews: 1_027 },
      now,
    );

    expect(result.at(-1)).toEqual({
      capturedAt: now,
      views: 1_027,
      rawViews: 1_027,
    });
  });

  it("rebases a large permanent counter reset and counts future growth", () => {
    const now = 2_000_000_000_000;
    const points = [
      { capturedAt: now - 5 * 60_000, views: 10_000, rawViews: 10_000 },
      { capturedAt: now - 4 * 60_000, views: 10_000, rawViews: 9_800 },
      { capturedAt: now - 3 * 60_000, views: 10_001, rawViews: 9_801 },
      { capturedAt: now - 2 * 60_000, views: 10_002, rawViews: 9_802 },
      { capturedAt: now - 60_000, views: 10_004, rawViews: 9_804 },
      { capturedAt: now, views: 10_005, rawViews: 9_805 },
    ];

    expect(pruneRealtimePoints(points, now).at(-1)).toEqual({
      capturedAt: now,
      views: 10_005,
      rawViews: 9_805,
    });
  });

  it("rebases a confirmed correction on a smaller channel", () => {
    const now = 2_000_000_000_000;
    const points = [
      { capturedAt: now - 5 * 60_000, views: 1_000, rawViews: 1_000 },
      { capturedAt: now - 4 * 60_000, views: 1_000, rawViews: 950 },
      { capturedAt: now - 3 * 60_000, views: 1_001, rawViews: 951 },
      { capturedAt: now - 2 * 60_000, views: 1_002, rawViews: 952 },
      { capturedAt: now - 60_000, views: 1_003, rawViews: 953 },
      { capturedAt: now, views: 1_004, rawViews: 954 },
    ];

    expect(pruneRealtimePoints(points, now).at(-1)).toEqual({
      capturedAt: now,
      views: 1_004,
      rawViews: 954,
    });
  });

  it("keeps counting after a modest correction on a large channel", () => {
    const now = 2_000_000_000_000;
    const points = [
      { capturedAt: now - 6 * 60_000, views: 8_600_000, rawViews: 8_600_000 },
      { capturedAt: now - 5 * 60_000, views: 8_600_000, rawViews: 8_599_900 },
      { capturedAt: now - 4 * 60_000, views: 8_600_005, rawViews: 8_599_905 },
      { capturedAt: now - 3 * 60_000, views: 8_600_010, rawViews: 8_599_910 },
      { capturedAt: now - 2 * 60_000, views: 8_600_015, rawViews: 8_599_915 },
      { capturedAt: now - 60_000, views: 8_600_020, rawViews: 8_599_920 },
      { capturedAt: now, views: 8_600_025, rawViews: 8_599_925 },
    ];

    expect(pruneRealtimePoints(points, now).at(-1)).toEqual({
      capturedAt: now,
      views: 8_600_025,
      rawViews: 8_599_925,
    });
    expect(observedViewsInLastHour(points, now)).toEqual({
      views: 25,
      observedMinutes: 6,
    });
  });

  it("does not double-count a large temporary counter regression", () => {
    const now = 2_000_000_000_000;
    const points = [
      { capturedAt: now - 5 * 60_000, views: 10_000, rawViews: 10_000 },
      { capturedAt: now - 4 * 60_000, views: 10_000, rawViews: 9_700 },
      { capturedAt: now - 3 * 60_000, views: 10_000, rawViews: 9_702 },
      { capturedAt: now - 2 * 60_000, views: 10_000, rawViews: 9_704 },
      { capturedAt: now - 60_000, views: 10_000, rawViews: 9_706 },
      { capturedAt: now, views: 10_002, rawViews: 10_002 },
    ];

    expect(pruneRealtimePoints(points, now).at(-1)).toEqual({
      capturedAt: now,
      views: 10_002,
      rawViews: 10_002,
    });
  });

  it("deduplicates repeated refreshes captured in the same minute", () => {
    const now = 2_000_000_000_000;
    expect(
      appendRealtimePoint(
        [
          { capturedAt: now - 60_000, views: 100 },
          { capturedAt: now, views: 106 },
        ],
        { capturedAt: now, views: 107 },
        now,
      ),
    ).toEqual([
      { capturedAt: now - 60_000, views: 100 },
      { capturedAt: now, views: 107 },
    ]);
  });

  it("keeps a sub-minute increment visible instead of losing the first view", () => {
    const now = 2_000_000_000_000;
    const points = appendRealtimePoint(
      [
        {
          capturedAt: now - 20_000,
          views: 100,
          rawViews: 100,
        },
      ],
      {
        capturedAt: now,
        views: 101,
        rawViews: 101,
      },
      now,
    );

    expect(points).toHaveLength(2);
    expect(observedViewsInLastHour(points, now)).toEqual({
      views: 1,
      observedMinutes: 0,
    });
  });

  it("preserves a newer minute when an older request completes last", () => {
    const now = 2_000_000_000_000;
    const result = appendRealtimePoint(
      [
        {
          capturedAt: now + 60_000,
          views: 110,
          rawViews: 110,
        },
      ],
      {
        capturedAt: now,
        views: 105,
        rawViews: 105,
      },
      now,
    );

    expect(result).toEqual([
      { capturedAt: now, views: 105, rawViews: 105 },
      {
        capturedAt: now + 60_000,
        views: 110,
        rawViews: 110,
      },
    ]);
  });

  it("does not report an old delta as current realtime activity", () => {
    const now = 2_000_000_000_000;
    expect(
      observedViewsInLastHour(
        [
          { capturedAt: now - 3 * 60 * 60_000, views: 100 },
          { capturedAt: now - 2 * 60 * 60_000, views: 150 },
        ],
        now,
      ),
    ).toEqual({ views: 0, observedMinutes: 0 });
  });

  it("does not turn a long sampling gap into an hourly spike", () => {
    const now = 2_000_000_000_000;
    expect(
      observedViewsInLastHour(
        [
          { capturedAt: now - 3 * 60 * 60_000, views: 100 },
          { capturedAt: now, views: 500 },
        ],
        now,
      ),
    ).toEqual({ views: 0, observedMinutes: 0 });
  });

  it("does not include a sample ten minutes before the hourly boundary", () => {
    const now = 2_000_000_000_000;
    expect(
      observedViewsInLastHour(
        [
          { capturedAt: now - 70 * 60_000, views: 100 },
          { capturedAt: now - 50 * 60_000, views: 130 },
          { capturedAt: now, views: 160 },
        ],
        now,
      ),
    ).toEqual({ views: 30, observedMinutes: 50 });
  });

  it("prunes corrupt, future and expired samples", () => {
    const now = 2_000_000_000_000;
    expect(
      pruneRealtimePoints(
        [
          { capturedAt: now + 1, views: 5 },
          { capturedAt: now - 51 * 60 * 60_000, views: 10 },
          { capturedAt: Number.NaN, views: 20 },
          { capturedAt: now - 1_000, views: 30 },
        ],
        now,
      ),
    ).toEqual([{ capturedAt: now - 1_000, views: 30 }]);
  });

  it("keeps and calculates a rolling 24-hour delta", () => {
    const now = 2_000_000_000_000;
    const points = [
      { capturedAt: now - 25 * 60 * 60_000, views: 900 },
      { capturedAt: now - 24 * 60 * 60_000, views: 1_000 },
      { capturedAt: now - 12 * 60 * 60_000, views: 1_480 },
      { capturedAt: now, views: 1_999 },
    ];

    expect(observedViewsInLast24Hours(points, now)).toEqual({
      views: 999,
      observedMinutes: 1_440,
    });
  });

  it("builds a channel-wide realtime series", () => {
    expect(
      aggregateRealtimeSeries([
        [
          { capturedAt: 1000, views: 10 },
          { capturedAt: 2000, views: 13 },
        ],
        [
          { capturedAt: 1000, views: 20 },
          { capturedAt: 2000, views: 25 },
        ],
      ]),
    ).toEqual([
      { capturedAt: 1000, views: 30 },
      { capturedAt: 2000, views: 38 },
    ]);
  });

  it("compares the current and previous 15-minute velocity", () => {
    const now = 2_000_000_000_000;
    const points = [
      { capturedAt: now - 30 * 60_000, views: 100 },
      { capturedAt: now - 15 * 60_000, views: 110 },
      { capturedAt: now, views: 130 },
    ];
    expect(realtimeVelocity(points, now)).toEqual({
      viewsLast15Minutes: 20,
      observedMinutesLast15: 15,
      viewsPerMinuteLast15: 1.333,
      previous15MinutesViews: 10,
      previousObservedMinutes15: 15,
      previousViewsPerMinute15: 0.667,
      velocityTrendPercent: 100,
    });
  });

  it("normalizes velocity when the two observed windows have unequal coverage", () => {
    const now = 2_000_000_000_000;
    const points = [
      { capturedAt: now - 30 * 60_000, views: 100 },
      { capturedAt: now - 20 * 60_000, views: 105 },
      { capturedAt: now - 10 * 60_000, views: 115 },
      { capturedAt: now, views: 135 },
    ];

    expect(realtimeVelocity(points, now)).toEqual({
      viewsLast15Minutes: 20,
      observedMinutesLast15: 10,
      viewsPerMinuteLast15: 2,
      previous15MinutesViews: 5,
      previousObservedMinutes15: 10,
      previousViewsPerMinute15: 0.5,
      velocityTrendPercent: 300,
    });
  });

  it("does not label a one-minute fluctuation as acceleration", () => {
    const now = 2_000_000_000_000;
    const points = [
      { capturedAt: now - 16 * 60_000, views: 100 },
      { capturedAt: now - 15 * 60_000, views: 101 },
      { capturedAt: now - 60_000, views: 101 },
      { capturedAt: now, views: 106 },
    ];

    expect(realtimeVelocity(points, now).velocityTrendPercent).toBe(0);
  });

  it("reports incomplete realtime window coverage explicitly", () => {
    expect(realtimeWindowCoverage(60, 60)).toEqual({
      observedMinutes: 60,
      targetMinutes: 60,
      ratio: 1,
      complete: true,
    });
    expect(realtimeWindowCoverage(60, 1_440)).toEqual({
      observedMinutes: 60,
      targetMinutes: 1_440,
      ratio: 1 / 24,
      complete: false,
    });
  });

  it("shows the first video-level view before the delayed channel total catches up", () => {
    expect(
      combineRealtimeObservations({ views: 0, observedMinutes: 1 }, [
        { views: 1, observedMinutes: 1 },
        { views: 0, observedMinutes: 1 },
      ]),
    ).toEqual({
      views: 1,
      observedMinutes: 1,
      source: "hybrid_video_delta",
    });
  });

  it("does not double-count a view reported by both realtime sources", () => {
    expect(
      combineRealtimeObservations({ views: 7, observedMinutes: 60 }, [
        { views: 4, observedMinutes: 60 },
        { views: 3, observedMinutes: 60 },
      ]),
    ).toEqual({
      views: 7,
      observedMinutes: 60,
      source: "channel_total",
    });
  });

  it("keeps complete channel coverage when a faster video delta wins", () => {
    expect(
      combineRealtimeObservations({ views: 8, observedMinutes: 60 }, [
        { views: 9, observedMinutes: 2 },
      ]),
    ).toEqual({
      views: 9,
      observedMinutes: 60,
      source: "hybrid_video_delta",
    });
  });
});
