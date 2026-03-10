import { describe, expect, it } from "vitest";
import type { RawSignalRecord } from "@argcis/shared";
import {
  attachRiskToActivities,
  buildFrameResponse,
  buildHexResponse,
  buildSyntheticArtifacts,
  buildTimeline,
  normalizeSignalToSegment
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
  it("builds 56 timeline segments for the 7 day horizon", () => {
    const timeline = buildTimeline("2026-03-07T10:31:00.000Z");

    expect(timeline).toHaveLength(56);
    expect(timeline[0]).toBe("2026-03-07T09:00:00.000Z");
    expect(timeline[1]).toBe("2026-03-07T12:00:00.000Z");
  });

  it("rounds source signals to the nearest 3 hour segment", () => {
    const normalized = normalizeSignalToSegment({
      ...signals[0],
      forecast_time_utc: "2026-03-07T07:31:00.000Z"
    });

    expect(normalized.forecast_time_utc).toBe("2026-03-07T09:00:00.000Z");
  });

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
    expect(hex.outline_cells).toHaveLength(hex.cells.length);
  });

  it("adds activity-risk layer into frame response when activities have geometry", () => {
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
      [
        {
          id: "act-1",
          scenario_id: "scn-1",
          geometry_id: "geo-1",
          name: "Movement",
          activity_type: "movement",
          starts_at: "2026-03-07T06:00:00.000Z",
          ends_at: "2026-03-07T09:00:00.000Z",
          geometry: {
            type: "Point",
            coordinates: [25.2797, 54.6872]
          },
          risk_level: "yellow",
          risk_reasons: ["gusiai virs 15 m/s"],
          recommended_action: "vykdyti su ribojimais",
          risk_summary: "Stipresni gusiai."
        }
      ]
    );

    expect(frame.layers.some((layer) => layer.layer_id === "activity-risk")).toBe(true);
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

  it("keeps mixed hexes below red when only one point is critical", () => {
    const mixedSignals: RawSignalRecord[] = [
      {
        id: "sig-r1",
        source: "road",
        layer_id: "road-weather-points",
        forecast_time_utc: "2026-03-07T06:00:00.000Z",
        latitude: 54.6872,
        longitude: 25.2797,
        location_name: "Critical point",
        metrics: {
          road_restriction: true
        }
      },
      {
        id: "sig-g1",
        source: "road",
        layer_id: "road-weather-points",
        forecast_time_utc: "2026-03-07T06:00:00.000Z",
        latitude: 54.6875,
        longitude: 25.2799,
        location_name: "Normal point 1",
        metrics: {}
      },
      {
        id: "sig-g2",
        source: "road",
        layer_id: "road-weather-points",
        forecast_time_utc: "2026-03-07T06:00:00.000Z",
        latitude: 54.6877,
        longitude: 25.2801,
        location_name: "Normal point 2",
        metrics: {}
      },
      {
        id: "sig-g3",
        source: "road",
        layer_id: "road-weather-points",
        forecast_time_utc: "2026-03-07T06:00:00.000Z",
        latitude: 54.6879,
        longitude: 25.2803,
        location_name: "Normal point 3",
        metrics: {}
      }
    ];

    const artifacts = buildSyntheticArtifacts(
      mixedSignals,
      "2026-03-07T00:00:00.000Z",
      7
    );

    expect(artifacts.riskHexCells[0]?.risk_level).toBe("green");
  });
});
