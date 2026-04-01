import {
  LAYER_CATALOG,
  aggregateRiskSummaries,
  buildForecastTimeline,
  evaluateRisk,
  FORECAST_SHORT_TERM_SEGMENT_HOURS,
  floorToForecastHour,
  isShortTermForecastTime,
  roundToNearestForecastHour
} from "@argcis/shared";
import type {
  BBox,
  CoordinateRiskTimelineResponse,
  ExerciseActivity,
  H3OutlineCell,
  GeoJsonFeature,
  GeoJsonFeatureCollection,
  JsonObject,
  MapFrameResponse,
  MapHexResponse,
  RawSignalMetrics,
  RawSignalRecord,
  RiskHexCell,
  RiskSummary
} from "@argcis/shared";
import {
  cellToBoundary,
  cellToLatLng,
  getResolution,
  latLngToCell,
  polygonToCells
} from "h3-js";

export interface ForecastFrameRow {
  source_id: string;
  source: "meteo" | "road";
  layer_id: string;
  forecast_time_utc: string;
  location_name: string;
  latitude: number;
  longitude: number;
  h3_index: string;
  geometry: GeoJsonFeature["geometry"];
  metrics: JsonObject;
}

export interface RiskFrameRow {
  forecast_time_utc: string;
  generated_at: string;
  raw_feature_count: number;
  hex_cell_count: number;
}

export interface RiskHexCellRow extends RiskHexCell {
  center_lat: number;
  center_lng: number;
}

export interface ExerciseActivityRow {
  id: string;
  scenario_id: string;
  geometry_id: string | null;
  name: string;
  activity_type: string;
  starts_at: string;
  ends_at: string;
  geometry: GeoJsonFeature["geometry"] | null;
  geometry_h3_index: string | null;
  centroid_lng: number | null;
  centroid_lat: number | null;
}

export interface SyntheticArtifacts {
  availableTimes: string[];
  rawRows: ForecastFrameRow[];
  riskFrames: RiskFrameRow[];
  riskHexCells: RiskHexCellRow[];
}

export function buildTimeline(startIso: string): string[] {
  return buildForecastTimeline(startIso);
}

export function normalizeSignalToSegment(
  signal: RawSignalRecord,
  generatedAt: string = signal.forecast_time_utc,
  timeline: string[] = buildForecastTimeline(generatedAt)
): RawSignalRecord | null {
  const normalizedAnchor = floorToForecastHour(generatedAt);
  const normalizedSourceTime = new Date(signal.forecast_time_utc).toISOString();
  const timelineSet = new Set(timeline);

  if (signal.source === "meteo") {
    if (!timelineSet.has(normalizedSourceTime)) {
      return null;
    }

    return {
      ...signal,
      forecast_time_utc: normalizedSourceTime
    };
  }

  const mappedTime = roundToNearestForecastHour(normalizedSourceTime);
  if (!timelineSet.has(mappedTime) || !isShortTermForecastTime(normalizedAnchor, mappedTime)) {
    return null;
  }

  return {
    ...signal,
    forecast_time_utc: mappedTime
  };
}

export function buildSyntheticArtifacts(
  signals: RawSignalRecord[],
  generatedAt: string,
  resolution: number,
  timeline: string[] = buildForecastTimeline(generatedAt)
): SyntheticArtifacts {
  const normalizedSignals = alignSignalsToTimeline(signals, generatedAt, timeline);
  const availableTimes = timeline;

  const rawRows: ForecastFrameRow[] = normalizedSignals.map((signal) => {
    const h3Index = latLngToCell(signal.latitude, signal.longitude, resolution);
    return {
      source_id: signal.id,
      source: signal.source,
      layer_id: signal.layer_id,
      forecast_time_utc: signal.forecast_time_utc,
      location_name: signal.location_name,
      latitude: signal.latitude,
      longitude: signal.longitude,
      h3_index: h3Index,
      geometry: {
        type: "Point",
        coordinates: [signal.longitude, signal.latitude]
      },
      metrics: signal.metrics
    };
  });

  const buckets = new Map<string, ForecastFrameRow[]>();
  for (const row of rawRows) {
    const key = `${row.forecast_time_utc}::${row.h3_index}`;
    const list = buckets.get(key) ?? [];
    list.push(row);
    buckets.set(key, list);
  }

  const riskHexCells: RiskHexCellRow[] = [];
  for (const [key, rows] of buckets) {
    const [forecast_time_utc, h3Index] = key.split("::");
    const summaries = rows.map((row) => ({
      summary: evaluateRisk(row.metrics as RawSignalMetrics),
      layer_id: row.layer_id,
      source: row.source
    }));
    const aggregate = aggregateRiskSummaries(summaries);
    const boundary = cellToBoundary(h3Index, true) as [number, number][];
    const ring =
      boundary[0]?.[0] === boundary[boundary.length - 1]?.[0] &&
      boundary[0]?.[1] === boundary[boundary.length - 1]?.[1]
        ? boundary
        : [...boundary, boundary[0]!];
    const center = cellToLatLng(h3Index);

    riskHexCells.push({
      h3_index: h3Index,
      forecast_time_utc,
      geometry: {
        type: "Polygon",
        coordinates: [ring]
      },
      center: [center[1], center[0]],
      center_lat: center[0],
      center_lng: center[1],
      raw_metrics: aggregateMetrics(rows.map((row) => row.metrics)),
      ...aggregate
    });
  }

  const riskFrames = availableTimes.map((forecast_time_utc) => {
    const frameRows = rawRows.filter((row) => row.forecast_time_utc === forecast_time_utc);
    const frameCells = riskHexCells.filter(
      (cell) => cell.forecast_time_utc === forecast_time_utc
    );

    return {
      forecast_time_utc,
      generated_at: generatedAt,
      raw_feature_count: frameRows.length,
      hex_cell_count: frameCells.length
    };
  });

  return {
    availableTimes,
    rawRows,
    riskFrames,
    riskHexCells
  };
}

function alignSignalsToTimeline(
  signals: RawSignalRecord[],
  generatedAt: string,
  timeline: string[]
): RawSignalRecord[] {
  if (signals.length === 0 || timeline.length === 0) {
    return signals;
  }

  const dedupedSignals = new Map<string, RawSignalRecord>();
  const sortedSignals = [...signals].sort(
    (left, right) =>
      new Date(left.forecast_time_utc).getTime() -
      new Date(right.forecast_time_utc).getTime()
  );

  for (const signal of sortedSignals) {
    const normalizedSignal = normalizeSignalToSegment(signal, generatedAt, timeline);
    if (!normalizedSignal) {
      continue;
    }

    const key = `${buildSignalSeriesKey(normalizedSignal)}::${normalizedSignal.forecast_time_utc}`;
    dedupedSignals.set(key, normalizedSignal);
  }

  return Array.from(dedupedSignals.values()).sort(
    (left, right) =>
      new Date(left.forecast_time_utc).getTime() -
      new Date(right.forecast_time_utc).getTime()
  );
}

function buildSignalSeriesKey(signal: RawSignalRecord): string {
  const alertCode =
    signal.layer_id === "road-alerts" ? String(signal.metrics.alert_code ?? "") : "";

  return [
    signal.source,
    signal.layer_id,
    signal.location_name,
    signal.latitude.toFixed(6),
    signal.longitude.toFixed(6),
    alertCode
  ].join("::");
}

export function buildFrameResponse(
  time: string,
  availableTimes: string[],
  rawRows: ForecastFrameRow[],
  exerciseAreas: GeoJsonFeatureCollection,
  activities: ExerciseActivity[]
): MapFrameResponse {
  const grouped = new Map<string, GeoJsonFeatureCollection>();

  for (const row of rawRows) {
    const current = grouped.get(row.layer_id) ?? {
      type: "FeatureCollection" as const,
      features: []
    };

    current.features.push({
      type: "Feature",
      id: row.source_id,
      geometry: row.geometry,
      properties: {
        label: row.location_name,
        layer_id: row.layer_id,
        source: row.source,
        ...row.metrics
      }
    });

    grouped.set(row.layer_id, current);
  }

  if (exerciseAreas.features.length > 0) {
    grouped.set("exercise-areas", exerciseAreas);
  }

  const activityFeatures = activities
    .filter((activity) => activity.geometry)
    .map((activity) => ({
      type: "Feature" as const,
      id: activity.id,
      geometry: activity.geometry!,
      properties: {
        label: activity.name,
        risk_score: activity.risk_score,
        signal_count: activity.signal_count,
        red_signal_count: activity.red_signal_count,
        yellow_signal_count: activity.yellow_signal_count,
        confidence_multiplier: activity.confidence_multiplier,
        activity_type: activity.activity_type,
        risk_level: activity.risk_level,
        risk_summary: activity.risk_summary,
        recommended_action: activity.recommended_action
      }
    }));

  if (activityFeatures.length > 0) {
    grouped.set("activity-risk", {
      type: "FeatureCollection",
      features: activityFeatures
    });
  }

  return {
    time,
    available_times: availableTimes,
    layers: Array.from(grouped.entries()).map(([layerId, feature_collection]) => ({
      layer_id: layerId,
      layer_name:
        LAYER_CATALOG.find((layer) => layer.id === layerId)?.name ?? layerId,
      feature_collection
    })),
    activities
  };
}

export function buildHexResponse(
  time: string,
  cells: RiskHexCellRow[],
  bbox: BBox | null,
  resolution?: number
): MapHexResponse {
  const filtered = bbox ? cells.filter((cell) => withinBbox(cell, bbox)) : cells;
  const outline_cells = buildOutlineCells(time, filtered, bbox, resolution);

  return {
    time,
    cells: filtered.map(({ center_lat: _lat, center_lng: _lng, ...rest }) => rest),
    outline_cells
  };
}

function buildOutlineCells(
  time: string,
  filteredCells: RiskHexCellRow[],
  bbox: BBox | null,
  resolution?: number
): H3OutlineCell[] {
  if (!bbox) {
    return filteredCells.map((cell) => ({
      h3_index: cell.h3_index,
      forecast_time_utc: cell.forecast_time_utc,
      geometry: cell.geometry,
      center: cell.center
    }));
  }

  const outlineResolution =
    resolution ??
    (filteredCells[0] ? getResolution(filteredCells[0].h3_index) : 5);
  const polygon = [[
    [bbox.west, bbox.south],
    [bbox.east, bbox.south],
    [bbox.east, bbox.north],
    [bbox.west, bbox.north],
    [bbox.west, bbox.south]
  ]];
  const indexes = polygonToCells(polygon, outlineResolution, true);

  return indexes.map((h3Index) => {
    const boundary = cellToBoundary(h3Index, true) as [number, number][];
    const ring =
      boundary[0]?.[0] === boundary[boundary.length - 1]?.[0] &&
      boundary[0]?.[1] === boundary[boundary.length - 1]?.[1]
        ? boundary
        : [...boundary, boundary[0]!];
    const center = cellToLatLng(h3Index);

    return {
      h3_index: h3Index,
      forecast_time_utc: time,
      geometry: {
        type: "Polygon",
        coordinates: [ring]
      },
      center: [center[1], center[0]]
    };
  });
}

export function buildCoordinateRiskResponse(
  latitude: number,
  longitude: number,
  cells: RiskHexCellRow[],
  availableTimes: string[],
  h3Index: string | null
): CoordinateRiskTimelineResponse {
  return {
    latitude,
    longitude,
    h3_index: h3Index,
    available_times: availableTimes,
    cells: [...cells]
      .sort(
        (left, right) =>
          new Date(left.forecast_time_utc).getTime() -
          new Date(right.forecast_time_utc).getTime()
      )
      .map(({ center_lat: _lat, center_lng: _lng, ...rest }) => rest)
  };
}

export function attachRiskToActivities(
  rows: ExerciseActivityRow[],
  cells: RiskHexCellRow[]
): ExerciseActivity[] {
  return rows.map((row) => {
    const matched = matchCell(row, cells);
    const summary: RiskSummary =
      matched ??
      ({
        risk_score: 0,
        signal_count: 0,
        red_signal_count: 0,
        yellow_signal_count: 0,
        confidence_multiplier: 0,
        risk_level: "green",
        risk_reasons: [],
        recommended_action: "vykdyti",
        risk_summary: "Aktyvios rizikos siam laikui nerasta."
      } satisfies RiskSummary);

    return {
      id: row.id,
      scenario_id: row.scenario_id,
      geometry_id: row.geometry_id,
      name: row.name,
      activity_type: row.activity_type,
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      geometry: row.geometry,
      ...summary
    };
  });
}

function matchCell(
  row: ExerciseActivityRow,
  cells: RiskHexCellRow[]
): RiskSummary | null {
  if (row.geometry_h3_index) {
    const byIndex = cells.find((cell) => cell.h3_index === row.geometry_h3_index);
    if (byIndex) {
      return byIndex;
    }
  }

  if (row.centroid_lat !== null && row.centroid_lng !== null) {
    const centroidLat = row.centroid_lat;
    const centroidLng = row.centroid_lng;
    const nearest = cells
      .map((cell) => ({
        cell,
        distance:
          Math.abs(cell.center_lat - centroidLat) +
          Math.abs(cell.center_lng - centroidLng)
      }))
      .sort((left, right) => left.distance - right.distance)[0];

    return nearest?.cell ?? null;
  }

  return null;
}

function aggregateMetrics(metricsList: JsonObject[]): JsonObject {
  const numericTotals = new Map<string, { total: number; count: number }>();
  const flags = new Map<string, boolean>();

  for (const metrics of metricsList) {
    for (const [key, value] of Object.entries(metrics)) {
      if (typeof value === "number") {
        const current = numericTotals.get(key) ?? { total: 0, count: 0 };
        numericTotals.set(key, {
          total: current.total + value,
          count: current.count + 1
        });
      }

      if (typeof value === "boolean" && value) {
        flags.set(key, true);
      }
    }
  }

  const output: JsonObject = {};
  for (const [key, value] of numericTotals.entries()) {
    output[key] = Number((value.total / value.count).toFixed(2));
  }
  for (const [key, value] of flags.entries()) {
    output[key] = value;
  }
  output.signal_count = metricsList.length;
  return output;
}

function withinBbox(cell: RiskHexCellRow, bbox: BBox): boolean {
  return (
    cell.center_lng >= bbox.west &&
    cell.center_lng <= bbox.east &&
    cell.center_lat >= bbox.south &&
    cell.center_lat <= bbox.north
  );
}

export function expandSignalWindow(
  startIso: string,
  endIso: string
): { fetchStartIso: string; fetchEndIso: string } {
  const halfSegmentMs = (FORECAST_SHORT_TERM_SEGMENT_HOURS * 60 * 60 * 1000) / 2;
  return {
    fetchStartIso: new Date(new Date(startIso).getTime() - halfSegmentMs).toISOString(),
    fetchEndIso: new Date(new Date(endIso).getTime() + halfSegmentMs).toISOString()
  };
}
