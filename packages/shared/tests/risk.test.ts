import { describe, expect, it } from "vitest";
import {
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

  it("provides demo fixtures for a full week timeline", () => {
    const timeline = demoTimeline();
    expect(timeline).toHaveLength(168);
    expect(demoFrame(timeline[0]).layers.length).toBeGreaterThan(0);
    expect(demoHex(timeline[0]).cells.length).toBeGreaterThan(0);
  });
});
