import { describe, expect, it } from "vitest";
import {
  FORECAST_SEGMENT_COUNT,
  FORECAST_SEGMENT_HOURS,
  aggregateRiskSummaries,
  buildForecastTimeline,
  demoFrame,
  demoHex,
  demoTimeline,
  evaluateRisk,
  findClosestForecastTime
} from "../src";

describe("risk logic", () => {
  it("returns red risk for high gusts and thunder", () => {
    const summary = evaluateRisk({
      wind_gust_ms: 23,
      thunder_probability: 75
    });

    expect(summary.risk_level).toBe("red");
    expect(summary.risk_reasons).toContain("perkunija");
    expect(summary.recommended_action).toBe("stabdyti");
  });

  it("aggregates reasons across summaries", () => {
    const summary = aggregateRiskSummaries([
      evaluateRisk({ visibility_m: 250 }),
      evaluateRisk({ road_restriction: true })
    ]);

    expect(summary.risk_level).toBe("red");
    expect(summary.risk_reasons).toContain("rukas");
    expect(summary.risk_reasons).toContain("eismo apribojimas");
  });

  it("does not mark the whole hex red from a single red outlier out of many", () => {
    const summary = aggregateRiskSummaries([
      evaluateRisk({ road_restriction: true }),
      ...Array.from({ length: 14 }, () => evaluateRisk({}))
    ]);

    expect(summary.risk_level).toBe("green");
    expect(summary.signal_count).toBe(15);
    expect(summary.red_signal_count).toBe(1);
  });

  it("can keep 2 of 2 severe road signals red", () => {
    const summary = aggregateRiskSummaries([
      evaluateRisk({ road_restriction: true }),
      evaluateRisk({ road_ice: true })
    ]);

    expect(summary.risk_level).toBe("red");
    expect(summary.confidence_multiplier).toBe(0.7);
  });

  it("does not overstate 2 of 2 severe weather signals after confidence penalty", () => {
    const summary = aggregateRiskSummaries([
      evaluateRisk({ wind_gust_ms: 23, thunder_probability: 75 }),
      evaluateRisk({ wind_gust_ms: 21, thunder_probability: 80 })
    ]);

    expect(summary.risk_level).toBe("yellow");
    expect(summary.risk_score).toBeLessThan(70);
  });

  it("reduces final hex score when only one signal exists", () => {
    const summary = aggregateRiskSummaries([
      evaluateRisk({ wind_gust_ms: 23, thunder_probability: 75 })
    ]);

    expect(summary.signal_count).toBe(1);
    expect(summary.confidence_multiplier).toBe(0.5);
    expect(summary.risk_level).toBe("yellow");
  });

  it("provides demo fixtures for a full week timeline", () => {
    const timeline = demoTimeline();
    expect(timeline).toHaveLength(FORECAST_SEGMENT_COUNT);
    expect(new Date(timeline[1]).getTime() - new Date(timeline[0]).getTime()).toBe(
      FORECAST_SEGMENT_HOURS * 60 * 60 * 1000
    );
    expect(demoFrame(timeline[0]).layers.length).toBeGreaterThan(0);
    expect(demoHex(timeline[0]).cells.length).toBeGreaterThan(0);
    expect(demoHex(timeline[0]).outline_cells.length).toBeGreaterThan(0);
  });

  it("builds 56 segment timeline for 7 day horizon", () => {
    const timeline = buildForecastTimeline("2026-03-07T10:31:00.000Z");
    expect(timeline).toHaveLength(56);
    expect(timeline[0]).toBe("2026-03-07T09:00:00.000Z");
  });

  it("finds exact matching forecast segment when available", () => {
    const timeline = buildForecastTimeline("2026-03-07T10:31:00.000Z");
    expect(findClosestForecastTime(timeline, "2026-03-07T12:00:00.000Z")).toBe(
      "2026-03-07T12:00:00.000Z"
    );
  });

  it("finds nearest forecast segment instead of falling back to timeline start", () => {
    const timeline = buildForecastTimeline("2026-03-07T09:00:00.000Z");
    expect(findClosestForecastTime(timeline, "2026-03-09T10:00:00.000Z")).toBe(
      "2026-03-09T09:00:00.000Z"
    );
  });
});
