import { describe, expect, it } from "vitest";
import {
  FORECAST_SEGMENT_COUNT,
  FORECAST_SEGMENT_HOURS,
  buildForecastTimeline,
  aggregateRiskSummaries,
  demoFrame,
  demoHex,
  demoTimeline,
  evaluateRisk
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

  it("does not mark the whole hex red from a single red outlier", () => {
    const summary = aggregateRiskSummaries([
      evaluateRisk({ road_restriction: true }),
      evaluateRisk({}),
      evaluateRisk({}),
      evaluateRisk({})
    ]);

    expect(summary.risk_level).toBe("green");
    expect(summary.risk_reasons).toHaveLength(0);
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
});
