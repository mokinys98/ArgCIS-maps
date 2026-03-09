import { describe, expect, it } from "vitest";
import type { RawSignalRecord } from "@argcis/shared";
import {
  attachRiskToActivities,
  buildFrameResponse,
  buildHexResponse,
  buildSyntheticArtifacts
} from "../src/risk-engine";

const signals: RawSignalRecord[] = [
  {
    id: "sig-1",
    source: "meteo",
    layer_id: "meteo-forecast-points",
    forecast_time_utc: "2026-03-07T06:00:00.000Z",
    latitude: 54.6872,
    longitude: 25.2797,
    location_name: "Vilnius",
    metrics: {
      wind_gust_ms: 21,
      thunder_probability: 75,
      visibility_m: 900
    }
  },
  {
    id: "sig-2",
    source: "road",
    layer_id: "road-weather-points",
    forecast_time_utc: "2026-03-07T06:00:00.000Z",
    latitude: 54.688,
    longitude: 25.281,
    location_name: "A1",
    metrics: {
      road_restriction: true
    }
  }
];

describe("risk engine", () => {
  it("builds raw frames and aggregated hex cells", () => {
    const artifacts = buildSyntheticArtifacts(
      signals,
      "2026-03-07T00:00:00.000Z",
      7
    );

    expect(artifacts.rawRows).toHaveLength(2);
    expect(artifacts.riskHexCells.length).toBeGreaterThan(0);
    expect(artifacts.riskHexCells[0]?.risk_level).toBe("red");
  });

  it("builds frame and hex API shapes", () => {
    const artifacts = buildSyntheticArtifacts(
      signals,
      "2026-03-07T00:00:00.000Z",
      7
    );
    const frame = buildFrameResponse(
      "2026-03-07T06:00:00.000Z",
      artifacts.availableTimes,
      artifacts.rawRows,
      { type: "FeatureCollection", features: [] },
      []
    );
    const hex = buildHexResponse(
      "2026-03-07T06:00:00.000Z",
      artifacts.riskHexCells,
      null
    );

    expect(frame.layers).toHaveLength(2);
    expect(hex.cells.length).toBeGreaterThan(0);
  });

  it("maps activity risk from nearest or matching cell", () => {
    const artifacts = buildSyntheticArtifacts(
      signals,
      "2026-03-07T00:00:00.000Z",
      7
    );
    const activities = attachRiskToActivities(
      [
        {
          id: "act-1",
          scenario_id: "scn-1",
          geometry_id: "geo-1",
          name: "Movement",
          activity_type: "movement",
          starts_at: "2026-03-07T06:00:00.000Z",
          ends_at: "2026-03-07T10:00:00.000Z",
          geometry: null,
          geometry_h3_index: artifacts.riskHexCells[0]?.h3_index ?? null,
          centroid_lng: 25.2797,
          centroid_lat: 54.6872
        }
      ],
      artifacts.riskHexCells
    );

    expect(activities[0]?.risk_level).toBe("red");
    expect(activities[0]?.risk_reasons.length).toBeGreaterThan(0);
  });
});
