import { describe, expect, it } from "vitest";
import type { RawSignalRecord } from "@argcis/shared";
import {
  attachRiskToActivities,
  buildCoordinateRiskResponse,
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

const horizonSignals: RawSignalRecord[] = signals.map((signal) => ({
  ...signal,
  forecast_time_utc: "2026-03-07T10:00:00.000Z"
}));

describe("risk engine", () => {
  it("builds hourly timeline segments for the 24 hour horizon", () => {
    const timeline = buildTimeline("2026-03-07T10:31:00.000Z");

    expect(timeline).toHaveLength(25);
    expect(timeline[0]).toBe("2026-03-07T10:00:00.000Z");
    expect(timeline[1]).toBe("2026-03-07T11:00:00.000Z");
    expect(timeline[24]).toBe("2026-03-08T10:00:00.000Z");
  });

  it("maps road signals to the nearest hourly segment inside the first 24 hours", () => {
    const normalized = normalizeSignalToSegment({
      ...signals[1],
      forecast_time_utc: "2026-03-07T07:31:00.000Z"
    }, "2026-03-07T00:00:00.000Z");

    expect(normalized?.forecast_time_utc).toBe("2026-03-07T08:00:00.000Z");
  });

  it("keeps short-term road signals even when generatedAt includes minutes and seconds", () => {
    const normalized = normalizeSignalToSegment(
      {
        ...signals[1],
        forecast_time_utc: "2026-03-31T20:27:48.068Z"
      },
      "2026-03-31T20:57:48.068Z"
    );

    expect(normalized?.forecast_time_utc).toBe("2026-03-31T20:00:00.000Z");
  });

  it("drops meteo timestamps that do not exactly match the hourly timeline", () => {
    const normalized = normalizeSignalToSegment({
      ...signals[0],
      forecast_time_utc: "2026-03-08T04:30:00.000Z"
    }, "2026-03-07T00:00:00.000Z");

    expect(normalized).toBeNull();
  });

  it("builds raw frames and aggregated hex cells", () => {
    const artifacts = buildSyntheticArtifacts(
      signals,
      "2026-03-07T00:00:00.000Z",
      7
    );

    expect(artifacts.rawRows).toHaveLength(2);
    expect(artifacts.riskFrames).toHaveLength(25);
    expect(artifacts.riskHexCells.length).toBeGreaterThan(0);
    expect(artifacts.riskHexCells[0]?.risk_level).toBe("red");
    expect(artifacts.riskHexCells[0]?.signal_count).toBe(2);
    expect(artifacts.riskHexCells[0]?.confidence_multiplier).toBe(0.85);
  });

  it("does not clone a single source timestamp across the full 24 hour timeline", () => {
    const timeline = buildTimeline("2026-03-07T10:31:00.000Z");
    const artifacts = buildSyntheticArtifacts(
      horizonSignals,
      "2026-03-07T00:00:00.000Z",
      7,
      timeline
    );

    expect(artifacts.availableTimes).toHaveLength(25);
    expect(artifacts.riskFrames).toHaveLength(25);
    expect(artifacts.rawRows).toHaveLength(horizonSignals.length);
    expect(new Set(artifacts.rawRows.map((row) => row.forecast_time_utc))).toEqual(
      new Set(["2026-03-07T10:00:00.000Z"])
    );
    expect(new Set(artifacts.riskHexCells.map((cell) => cell.forecast_time_utc))).toEqual(
      new Set(["2026-03-07T10:00:00.000Z"])
    );
    expect(
      artifacts.riskFrames.filter((frame) => frame.raw_feature_count > 0).map(
        (frame) => frame.forecast_time_utc
      )
    ).toEqual(["2026-03-07T10:00:00.000Z"]);
  });

  it("drops road signals outside the 24 hour forecast horizon", () => {
    const artifacts = buildSyntheticArtifacts(
      [
        {
          ...signals[0],
          forecast_time_utc: "2026-03-08T03:00:00.000Z"
        },
        {
          ...signals[1],
          forecast_time_utc: "2026-03-08T11:10:00.000Z"
        }
      ],
      "2026-03-07T00:00:00.000Z",
      7
    );

    expect(artifacts.rawRows).toHaveLength(0);
    expect(artifacts.riskHexCells).toHaveLength(0);
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

  it("builds coordinate timeline API shape", () => {
    const timeline = buildTimeline("2026-03-07T10:31:00.000Z");
    const artifacts = buildSyntheticArtifacts(
      horizonSignals,
      "2026-03-07T00:00:00.000Z",
      7,
      timeline
    );
    const response = buildCoordinateRiskResponse(
      54.6872,
      25.2797,
      artifacts.riskHexCells,
      timeline,
      artifacts.riskHexCells[0]?.h3_index ?? null
    );

    expect(response.available_times).toHaveLength(25);
    expect(response.cells).toHaveLength(artifacts.riskHexCells.length);
    expect(response.h3_index).toBeTruthy();
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
          risk_score: 45,
          signal_count: 1,
          red_signal_count: 0,
          yellow_signal_count: 1,
          confidence_multiplier: 1,
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

    expect(artifacts.riskHexCells[0]?.risk_level).toBe("red");
    expect(artifacts.riskHexCells[0]?.signal_count).toBe(4);
    expect(artifacts.riskHexCells[0]?.confidence_multiplier).toBe(1);
  });

  it("surfaces meteo risk even when most points in the hex are neutral", () => {
    const signalsWithNeutralMeteo: RawSignalRecord[] = [
      {
        id: "sig-y1",
        source: "meteo",
        layer_id: "meteo-forecast-points",
        forecast_time_utc: "2026-03-07T06:00:00.000Z",
        latitude: 54.6872,
        longitude: 25.2797,
        location_name: "Warning point",
        metrics: {
          wind_gust_ms: 15
        }
      },
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `sig-g${index + 1}`,
        source: "meteo" as const,
        layer_id: "meteo-forecast-points",
        forecast_time_utc: "2026-03-07T06:00:00.000Z",
        latitude: 54.6872 + (index + 1) * 0.0001,
        longitude: 25.2797 + (index + 1) * 0.0001,
        location_name: `Neutral point ${index + 1}`,
        metrics: {}
      }))
    ];

    const artifacts = buildSyntheticArtifacts(
      signalsWithNeutralMeteo,
      "2026-03-07T00:00:00.000Z",
      7
    );

    expect(artifacts.riskHexCells[0]?.risk_level).toBe("yellow");
    expect(artifacts.riskHexCells[0]?.yellow_signal_count).toBe(1);
  });
});
