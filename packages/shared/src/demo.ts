import {
  LAYER_CATALOG
} from "./layers";
import { aggregateRiskSummaries, evaluateRisk } from "./risk";
import type {
  ExerciseActivity,
  ExerciseGeometry,
  FrameLayerData,
  GeoJsonFeature,
  GeoJsonFeatureCollection,
  LayerCatalogResponse,
  MapFrameResponse,
  MapHexResponse,
  RawSignalMetrics,
  RiskHexCell
} from "./types";

const TIMELINE_HOURS = 7 * 24;
const START = new Date("2026-03-07T00:00:00.000Z");

function atHour(offset: number): string {
  return new Date(START.getTime() + offset * 60 * 60 * 1000).toISOString();
}

function makeHexagon(
  lon: number,
  lat: number,
  radiusLon = 0.18,
  radiusLat = 0.11
) {
  const coords: [number, number][] = [];
  for (let step = 0; step < 6; step += 1) {
    const angle = (Math.PI / 3) * step + Math.PI / 6;
    coords.push([
      lon + Math.cos(angle) * radiusLon,
      lat + Math.sin(angle) * radiusLat
    ]);
  }
  coords.push(coords[0]);
  return {
    type: "Polygon" as const,
    coordinates: [coords]
  };
}

function makePointFeature(
  id: string,
  coordinates: [number, number],
  properties: Record<string, string | number | boolean | null>
): GeoJsonFeature {
  return {
    type: "Feature",
    id,
    geometry: {
      type: "Point",
      coordinates
    },
    properties
  };
}

function buildMetrics(hourOffset: number, variant: number): RawSignalMetrics {
  return {
    wind_speed_ms: 6 + variant,
    wind_gust_ms: 10 + variant * 3 + (hourOffset % 5),
    visibility_m: 1600 - variant * 180 - (hourOffset % 4) * 120,
    thunder_probability: ((hourOffset + variant) % 6) * 15,
    precipitation_mm: ((hourOffset + variant) % 4) * 4,
    road_ice: variant === 2 && hourOffset % 9 === 0,
    road_restriction: variant === 3 && hourOffset % 7 === 0,
    surface_state: variant === 2 ? "wet" : "dry",
    air_temperature_c: 3 + variant - (hourOffset % 6)
  };
}

export function demoTimeline(): string[] {
  return Array.from({ length: TIMELINE_HOURS }, (_, index) => atHour(index));
}

export function demoLayerCatalog(): LayerCatalogResponse {
  return {
    layers: LAYER_CATALOG
  };
}

export function demoActivities(time: string): ExerciseActivity[] {
  const shared = evaluateRisk({
    wind_gust_ms: 17,
    visibility_m: 900,
    thunder_probability: 40
  });

  return [
    {
      id: "act-1",
      scenario_id: "scn-1",
      geometry_id: "geo-1",
      name: "Kolonos judejimas",
      activity_type: "movement",
      starts_at: time,
      ends_at: new Date(new Date(time).getTime() + 2 * 60 * 60 * 1000).toISOString(),
      geometry: {
        type: "LineString",
        coordinates: [
          [24.92, 54.67],
          [25.28, 54.75]
        ]
      },
      ...shared
    }
  ];
}

export function demoGeometries(): ExerciseGeometry[] {
  return [
    {
      id: "geo-1",
      scenario_id: "scn-1",
      name: "Marsuotas judejimas",
      geometry: {
        type: "Polygon",
        coordinates: [[
          [24.86, 54.62],
          [25.34, 54.62],
          [25.34, 54.82],
          [24.86, 54.82],
          [24.86, 54.62]
        ]]
      },
      centroid: [25.1, 54.72],
      h3_index: null
    }
  ];
}

function buildFrameLayerData(time: string): FrameLayerData[] {
  const hourOffset = Math.floor(
    (new Date(time).getTime() - START.getTime()) / (60 * 60 * 1000)
  );

  const meteoPoints: GeoJsonFeatureCollection = {
    type: "FeatureCollection",
    features: [
      makePointFeature("meteo-1", [25.2797, 54.6872], {
        label: "Vilnius",
        temperature: 4 + (hourOffset % 4),
        wind_gust_ms: 11 + (hourOffset % 6)
      }),
      makePointFeature("meteo-2", [23.8813, 54.8985], {
        label: "Kaunas",
        temperature: 3 + (hourOffset % 3),
        wind_gust_ms: 13 + (hourOffset % 5)
      })
    ]
  };

  const roadPoints: GeoJsonFeatureCollection = {
    type: "FeatureCollection",
    features: [
      makePointFeature("road-1", [25.0, 54.71], {
        label: "A1 ruozo stotis",
        road_ice: hourOffset % 9 === 0,
        restriction: hourOffset % 7 === 0
      }),
      makePointFeature("road-2", [24.4, 55.05], {
        label: "Panevezio kryptis",
        road_ice: false,
        restriction: hourOffset % 11 === 0
      })
    ]
  };

  const alertPoints: GeoJsonFeatureCollection = {
    type: "FeatureCollection",
    features:
      hourOffset % 5 === 0
        ? [
            makePointFeature("alert-1", [24.95, 54.73], {
              label: "Eismo apribojimas",
              severity: "high"
            })
          ]
        : []
  };

  const exerciseAreas: GeoJsonFeatureCollection = {
    type: "FeatureCollection",
    features: demoGeometries().map((item) => ({
      type: "Feature",
      id: item.id,
      geometry: item.geometry,
      properties: {
        label: item.name,
        kind: "exercise"
      }
    }))
  };

  return [
    {
      layer_id: "meteo-forecast-points",
      layer_name: "Meteo forecast taskai",
      feature_collection: meteoPoints
    },
    {
      layer_id: "road-weather-points",
      layer_name: "Keliu oro taskai",
      feature_collection: roadPoints
    },
    {
      layer_id: "road-alerts",
      layer_name: "Keliu perspejimai",
      feature_collection: alertPoints
    },
    {
      layer_id: "exercise-areas",
      layer_name: "Pratybu geometrijos",
      feature_collection: exerciseAreas
    }
  ];
}

export function demoFrame(time: string): MapFrameResponse {
  return {
    time,
    available_times: demoTimeline(),
    layers: buildFrameLayerData(time),
    activities: demoActivities(time)
  };
}

export function demoHex(time: string): MapHexResponse {
  const hourOffset = Math.floor(
    (new Date(time).getTime() - START.getTime()) / (60 * 60 * 1000)
  );

  const cells: RiskHexCell[] = [
    {
      h3_index: "demo-hex-1",
      forecast_time_utc: time,
      geometry: makeHexagon(25.14, 54.71),
      center: [25.14, 54.71],
      raw_metrics: buildMetrics(hourOffset, 1),
      ...evaluateRisk(buildMetrics(hourOffset, 1))
    },
    {
      h3_index: "demo-hex-2",
      forecast_time_utc: time,
      geometry: makeHexagon(24.78, 54.85),
      center: [24.78, 54.85],
      raw_metrics: buildMetrics(hourOffset, 2),
      ...evaluateRisk(buildMetrics(hourOffset, 2))
    },
    {
      h3_index: "demo-hex-3",
      forecast_time_utc: time,
      geometry: makeHexagon(25.48, 54.88),
      center: [25.48, 54.88],
      raw_metrics: buildMetrics(hourOffset, 3),
      ...aggregateRiskSummaries([
        evaluateRisk(buildMetrics(hourOffset, 3)),
        evaluateRisk({ road_restriction: hourOffset % 7 === 0 })
      ])
    }
  ];

  return {
    time,
    cells
  };
}
