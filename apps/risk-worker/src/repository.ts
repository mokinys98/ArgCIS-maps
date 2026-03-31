import {
  demoCoordinateRiskTimeline,
  demoActivities,
  demoFrame,
  demoHex,
  demoLayerCatalog
} from "@argcis/shared";
import type {
  CoordinateRiskTimelineResponse,
  ExerciseScenario,
  GeoJsonFeatureCollection,
  GeoJsonGeometry,
  JsonObject,
  LayerCatalogResponse,
  RawSignalRecord,
  RecomputeResult,
  SavedMap,
  SavedMapLayer
} from "@argcis/shared";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { latLngToCell } from "h3-js";
import type { AppConfig } from "./config";
import { formatErrorMessage, safeStringify, serializeError } from "./logging";
import {
  attachRiskToActivities,
  buildCoordinateRiskResponse,
  buildFrameResponse,
  buildHexResponse,
  buildSyntheticArtifacts,
  buildTimeline,
  expandSignalWindow,
  type ExerciseActivityRow,
  type ForecastFrameRow,
  type RiskHexCellRow
} from "./risk-engine";

interface CreateExerciseInput {
  name: string;
  description?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  geometry_name?: string | null;
  geometry?: GeoJsonGeometry | null;
}

interface CreateExerciseActivityInput {
  scenario_id: string;
  geometry_id?: string | null;
  name: string;
  activity_type: string;
  starts_at: string;
  ends_at: string;
}

interface CreateSavedMapInput {
  name: string;
  description?: string | null;
  active_time_utc?: string | null;
  layers: Array<{
    layer_id: string;
    ordering: number;
    visible: boolean;
    opacity: number;
    filters?: Record<string, unknown>;
    active_time_utc?: string | null;
  }>;
}

interface ExerciseGeometryRow {
  id: string;
  scenario_id: string;
  name: string;
  geometry: GeoJsonGeometry;
  centroid_lng: number | null;
  centroid_lat: number | null;
  h3_index: string | null;
}

interface SourceDebugRow {
  source_id: string;
  forecast_time_utc: string;
  location_name: string;
}

interface RawFrameDebugRow {
  source_id: string;
  layer_id: string;
  forecast_time_utc: string;
  location_name: string;
}

const ROAD_POINT_LOOKBACK_HOURS = 12;
const RAW_FRAME_INSERT_BATCH_SIZE = 500;
const RISK_HEX_INSERT_BATCH_SIZE = 250;

export class ArgcisRepository {
  private readonly client: SupabaseClient;

  constructor(private readonly config: AppConfig) {
    const url = config.supabaseUrl || "https://demo.supabase.local";
    const key = config.supabaseServiceRoleKey || "demo-service-role-key";
    this.client = createClient(
      url,
      key,
      {
        auth: {
          persistSession: false
        }
      }
    );
  }

  async getLayerCatalog(): Promise<LayerCatalogResponse> {
    return demoLayerCatalog();
  }

  async getFrame(time: string, layerIds: string[]) {
    if (this.config.useDemoData) {
      return demoFrame(time);
    }

    const [availableTimes, rawRows, exerciseAreas, activities] = await Promise.all([
      this.listAvailableTimes(),
      this.listForecastRows(time, layerIds),
      this.listExerciseAreas(),
      this.listActivitiesAtTime(time)
    ]);

    return buildFrameResponse(
      time,
      availableTimes,
      rawRows,
      exerciseAreas,
      activities
    );
  }

  async getHex(
    time: string,
    bbox: {
      west: number;
      south: number;
      east: number;
      north: number;
    } | null
  ) {
    if (this.config.useDemoData) {
      return demoHex(time);
    }

    const { data, error } = await this.client
      .from("risk_hex_cells")
      .select(
        "h3_index, forecast_time_utc, geometry, center_lng, center_lat, risk_score, signal_count, red_signal_count, yellow_signal_count, confidence_multiplier, risk_level, risk_reasons, recommended_action, summary, raw_metrics"
      )
      .eq("forecast_time_utc", time);

    if (error) {
      throw error;
    }

    const cells: RiskHexCellRow[] = (data ?? []).map((row) => ({
      h3_index: row.h3_index as string,
      forecast_time_utc: row.forecast_time_utc as string,
      geometry: row.geometry as RiskHexCellRow["geometry"],
      center: [row.center_lng as number, row.center_lat as number],
      center_lng: row.center_lng as number,
      center_lat: row.center_lat as number,
      risk_score: row.risk_score as number,
      signal_count: row.signal_count as number,
      red_signal_count: row.red_signal_count as number,
      yellow_signal_count: row.yellow_signal_count as number,
      confidence_multiplier: Number(row.confidence_multiplier),
      risk_level: row.risk_level as RiskHexCellRow["risk_level"],
      risk_reasons: (row.risk_reasons as string[]) ?? [],
      recommended_action: row.recommended_action as RiskHexCellRow["recommended_action"],
      risk_summary: row.summary as string,
      raw_metrics: ((row.raw_metrics as JsonObject | null) ?? {}) as JsonObject
    }));

    return buildHexResponse(time, cells, bbox);
  }

  async getRiskByCoordinate(
    latitude: number,
    longitude: number
  ): Promise<CoordinateRiskTimelineResponse> {
    if (this.config.useDemoData) {
      return demoCoordinateRiskTimeline(latitude, longitude);
    }

    const availableTimes = buildTimeline(new Date().toISOString());
    const h3Index = latLngToCell(latitude, longitude, this.config.h3Resolution);

    const { data, error } = await this.client
      .from("risk_hex_cells")
      .select(
        "h3_index, forecast_time_utc, geometry, center_lng, center_lat, risk_score, signal_count, red_signal_count, yellow_signal_count, confidence_multiplier, risk_level, risk_reasons, recommended_action, summary, raw_metrics"
      )
      .eq("h3_index", h3Index)
      .gte("forecast_time_utc", availableTimes[0]!)
      .lte("forecast_time_utc", availableTimes.at(-1)!)
      .order("forecast_time_utc", { ascending: true });

    if (error) {
      throw error;
    }

    const cells: RiskHexCellRow[] = (data ?? []).map((row) => ({
      h3_index: row.h3_index as string,
      forecast_time_utc: row.forecast_time_utc as string,
      geometry: row.geometry as RiskHexCellRow["geometry"],
      center: [row.center_lng as number, row.center_lat as number],
      center_lng: row.center_lng as number,
      center_lat: row.center_lat as number,
      risk_score: row.risk_score as number,
      signal_count: row.signal_count as number,
      red_signal_count: row.red_signal_count as number,
      yellow_signal_count: row.yellow_signal_count as number,
      confidence_multiplier: Number(row.confidence_multiplier),
      risk_level: row.risk_level as RiskHexCellRow["risk_level"],
      risk_reasons: (row.risk_reasons as string[]) ?? [],
      recommended_action: row.recommended_action as RiskHexCellRow["recommended_action"],
      risk_summary: row.summary as string,
      raw_metrics: ((row.raw_metrics as JsonObject | null) ?? {}) as JsonObject
    }));

    return buildCoordinateRiskResponse(
      latitude,
      longitude,
      cells,
      availableTimes,
      h3Index
    );
  }

  async debugForecastTime(time: string) {
    const { fetchStartIso, fetchEndIso } = expandSignalWindow(time, time);
    const nearbyStart = new Date(new Date(time).getTime() - 12 * 60 * 60 * 1000).toISOString();
    const nearbyEnd = new Date(new Date(time).getTime() + 12 * 60 * 60 * 1000).toISOString();

    const [meteoSource, roadSource, rawRows, nearbyRawTimes, riskFrame, nearbyRiskTimes] =
      await Promise.all([
        this.debugSourceWindow(this.config.meteoSourceView, fetchStartIso, fetchEndIso),
        this.debugSourceWindow(this.config.roadSourceView, fetchStartIso, fetchEndIso),
        this.debugRawFrameRows(time),
        this.debugNearbyTimes("forecast_frames_raw", nearbyStart, nearbyEnd),
        this.debugRiskFrame(time),
        this.debugNearbyTimes("risk_frames", nearbyStart, nearbyEnd)
      ]);

    const rawByLayer = rawRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.layer_id] = (acc[row.layer_id] ?? 0) + 1;
      return acc;
    }, {});

    return {
      time,
      ingest_window: {
        start_utc: fetchStartIso,
        end_utc: fetchEndIso
      },
      ingest: {
        meteo: meteoSource,
        road: roadSource
      },
      worker_storage: {
        raw_frame_count: rawRows.length,
        raw_by_layer: rawByLayer,
        raw_sample: rawRows.slice(0, 8),
        nearby_raw_times: nearbyRawTimes,
        risk_frame: riskFrame,
        nearby_risk_times: nearbyRiskTimes
      }
    };
  }

  async listExercises(): Promise<ExerciseScenario[]> {
    if (this.config.useDemoData) {
      return [
        {
          id: "scn-1",
          name: "Vidinis demo scenarijus",
          description: "Demo scenarijus zemelapio validacijai.",
          starts_at: "2026-03-07T06:00:00.000Z",
          ends_at: "2026-03-07T18:00:00.000Z",
          owner_id: null
        }
      ];
    }

    const { data, error } = await this.client
      .from("exercise_scenarios")
      .select("id, name, description, starts_at, ends_at, owner_id")
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    return (data ?? []) as ExerciseScenario[];
  }

  async createExercise(userId: string | null, input: CreateExerciseInput) {
    if (this.config.useDemoData) {
      return {
        id: crypto.randomUUID(),
        name: input.name,
        description: input.description ?? null,
        starts_at: input.starts_at ?? null,
        ends_at: input.ends_at ?? null,
        owner_id: userId
      } satisfies ExerciseScenario;
    }

    const { data, error } = await this.client
      .from("exercise_scenarios")
      .insert({
        owner_id: userId,
        name: input.name,
        description: input.description ?? null,
        starts_at: input.starts_at ?? null,
        ends_at: input.ends_at ?? null
      })
      .select("id, name, description, starts_at, ends_at, owner_id")
      .single();

    if (error) {
      throw error;
    }

    if (input.geometry) {
      const centroid = geometryCentroid(input.geometry);
      await this.client.from("exercise_geometries").insert({
        scenario_id: data.id,
        name: input.geometry_name ?? `${input.name} area`,
        geometry: input.geometry,
        centroid_lng: centroid[0],
        centroid_lat: centroid[1]
      });
    }

    return data as ExerciseScenario;
  }

  async listExerciseActivities(time?: string) {
    if (this.config.useDemoData) {
      return demoActivities(time ?? demoFrame("2026-03-07T00:00:00.000Z").time);
    }

    return this.listActivitiesAtTime(time ?? new Date().toISOString());
  }

  async createExerciseActivity(
    userId: string | null,
    input: CreateExerciseActivityInput
  ) {
    void userId;

    if (this.config.useDemoData) {
      return {
        id: crypto.randomUUID(),
        scenario_id: input.scenario_id,
        geometry_id: input.geometry_id ?? null,
        name: input.name,
        activity_type: input.activity_type,
        starts_at: input.starts_at,
        ends_at: input.ends_at,
        geometry: null,
        risk_score: 0,
        signal_count: 0,
        red_signal_count: 0,
        yellow_signal_count: 0,
        confidence_multiplier: 0,
        risk_level: "green",
        risk_reasons: [],
        recommended_action: "vykdyti",
        risk_summary: "Demo veikla sukurta be server-side iraso."
      };
    }

    const { data, error } = await this.client
      .from("exercise_activities")
      .insert({
        scenario_id: input.scenario_id,
        geometry_id: input.geometry_id ?? null,
        name: input.name,
        activity_type: input.activity_type,
        starts_at: input.starts_at,
        ends_at: input.ends_at
      })
      .select("id, scenario_id, geometry_id, name, activity_type, starts_at, ends_at")
      .single();

    if (error) {
      throw error;
    }

    return {
      ...data,
      geometry: null,
      risk_score: 0,
      signal_count: 0,
      red_signal_count: 0,
      yellow_signal_count: 0,
      confidence_multiplier: 0,
      risk_level: "green",
      risk_reasons: [],
      recommended_action: "vykdyti",
      risk_summary: "Rizika bus priskirta pagal pasirinkta laika."
    };
  }

  async listSavedMaps(userId: string | null): Promise<SavedMap[]> {
    if (this.config.useDemoData) {
      return [
        {
          id: "saved-1",
          owner_id: userId,
          name: "Demo risk vaizdas",
          description: "Meteo + road + hex risk",
          active_time_utc: "2026-03-07T06:00:00.000Z",
          layers: [
            {
              id: "saved-layer-1",
              layer_id: "meteo-forecast-points",
              ordering: 1,
              visible: true,
              opacity: 0.85,
              filters: {},
              active_time_utc: null
            }
          ]
        }
      ];
    }

    let query = this.client
      .from("saved_maps")
      .select("id, owner_id, name, description, active_time_utc")
      .order("created_at", { ascending: false });

    if (userId) {
      query = query.eq("owner_id", userId);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    const savedMaps = (data ?? []) as SavedMap[];
    if (savedMaps.length === 0) {
      return [];
    }

    const ids = savedMaps.map((item) => item.id);
    const { data: layers, error: layersError } = await this.client
      .from("saved_map_layers")
      .select("id, saved_map_id, layer_id, ordering, visible, opacity, filters, active_time_utc")
      .in("saved_map_id", ids)
      .order("ordering", { ascending: true });

    if (layersError) {
      throw layersError;
    }

    const grouped = new Map<string, SavedMapLayer[]>();
    for (const layer of layers ?? []) {
      const current = grouped.get(layer.saved_map_id as string) ?? [];
      current.push({
        id: layer.id as string,
        layer_id: layer.layer_id as string,
        ordering: layer.ordering as number,
        visible: layer.visible as boolean,
        opacity: layer.opacity as number,
        filters: ((layer.filters as JsonObject | null) ?? {}) as JsonObject,
        active_time_utc: (layer.active_time_utc as string | null) ?? null
      });
      grouped.set(layer.saved_map_id as string, current);
    }

    return savedMaps.map((item) => ({
      ...item,
      layers: grouped.get(item.id) ?? []
    }));
  }

  async createSavedMap(userId: string | null, input: CreateSavedMapInput) {
    if (this.config.useDemoData) {
      return {
        id: crypto.randomUUID(),
        owner_id: userId,
        name: input.name,
        description: input.description ?? null,
        active_time_utc: input.active_time_utc ?? null,
        layers: input.layers.map((layer, index) => ({
          id: `demo-layer-${index}`,
          layer_id: layer.layer_id,
          ordering: layer.ordering,
          visible: layer.visible,
          opacity: layer.opacity,
          filters: ((layer.filters as SavedMapLayer["filters"] | null) ?? {}) as SavedMapLayer["filters"],
          active_time_utc: layer.active_time_utc ?? null
        }))
      } satisfies SavedMap;
    }

    const { data, error } = await this.client
      .from("saved_maps")
      .insert({
        owner_id: userId,
        name: input.name,
        description: input.description ?? null,
        active_time_utc: input.active_time_utc ?? null
      })
      .select("id, owner_id, name, description, active_time_utc")
      .single();

    if (error) {
      throw error;
    }

    if (input.layers.length > 0) {
      const layerRows = input.layers.map((layer) => ({
        saved_map_id: data.id,
        layer_id: layer.layer_id,
        ordering: layer.ordering,
        visible: layer.visible,
        opacity: layer.opacity,
        filters: layer.filters ?? {},
        active_time_utc: layer.active_time_utc ?? null
      }));

      const { error: layerError } = await this.client
        .from("saved_map_layers")
        .insert(layerRows);

      if (layerError) {
        throw layerError;
      }
    }

    return {
      ...(data as SavedMap),
      layers: input.layers.map((layer, index) => ({
        id: `pending-${index}`,
        layer_id: layer.layer_id,
        ordering: layer.ordering,
        visible: layer.visible,
        opacity: layer.opacity,
        filters: (layer.filters as SavedMapLayer["filters"]) ?? {},
        active_time_utc: layer.active_time_utc ?? null
      }))
    };
  }

  async recompute(nowIso: string): Promise<RecomputeResult> {
    this.logInfo("recompute.start", {
      recompute_time_utc: nowIso,
      demo_mode: this.config.useDemoData,
      h3_resolution: this.config.h3Resolution,
      meteo_source_view: this.config.meteoSourceView,
      road_source_view: this.config.roadSourceView
    });

    if (this.config.useDemoData) {
      const frame = demoFrame(nowIso);
      const hex = demoHex(nowIso);
      const result = {
        generated_at: nowIso,
        frame_count: frame.available_times.length,
        raw_frame_count: frame.layers.reduce(
          (total, layer) => total + layer.feature_collection.features.length,
          0
        ),
        hex_cell_count: hex.cells.length
      };
      this.logInfo("recompute.demo_complete", result);
      return result;
    }

    try {
      const timeline = buildTimeline(nowIso);
      const start = timeline[0];
      const end = timeline[timeline.length - 1];

      this.logInfo("recompute.timeline_built", {
        segment_count: timeline.length,
        start_utc: start,
        end_utc: end
      });

      const sourceSignals = await this.fetchSourceSignals(start, end);

      this.logInfo("recompute.source_signals_fetched", {
        total_count: sourceSignals.length,
        by_source: countBy(sourceSignals, (signal) => signal.source),
        by_layer: countBy(sourceSignals, (signal) => signal.layer_id),
        earliest_time_utc: sourceSignals[0]?.forecast_time_utc ?? null,
        latest_time_utc: sourceSignals.at(-1)?.forecast_time_utc ?? null
      });

      const artifacts = buildSyntheticArtifacts(
        sourceSignals,
        nowIso,
        this.config.h3Resolution,
        timeline
      );

      this.logInfo("recompute.artifacts_built", {
        raw_row_count: artifacts.rawRows.length,
        risk_frame_count: artifacts.riskFrames.length,
        risk_hex_count: artifacts.riskHexCells.length
      });

      const rawRowsByTime = groupBy(artifacts.rawRows, (row) => row.forecast_time_utc);
      const riskHexCellsByTime = groupBy(artifacts.riskHexCells, (row) => row.forecast_time_utc);
      const riskFrameByTime = new Map(
        artifacts.riskFrames.map((row) => [row.forecast_time_utc, row])
      );

      for (const forecastTime of timeline) {
        const rawRows = rawRowsByTime.get(forecastTime) ?? [];
        const riskFrame = riskFrameByTime.get(forecastTime) ?? null;
        const riskHexCells = riskHexCellsByTime.get(forecastTime) ?? [];

        this.logInfo("recompute.time_slice_start", {
          forecast_time_utc: forecastTime,
          raw_row_count: rawRows.length,
          has_risk_frame: riskFrame !== null,
          risk_hex_count: riskHexCells.length
        });

        await this.replaceForecastTimeSlice(forecastTime, rawRows, riskFrame, riskHexCells);

        this.logInfo("recompute.time_slice_complete", {
          forecast_time_utc: forecastTime,
          raw_row_count: rawRows.length,
          risk_hex_count: riskHexCells.length
        });
      }

      const result = {
        generated_at: nowIso,
        frame_count: artifacts.riskFrames.length,
        raw_frame_count: artifacts.rawRows.length,
        hex_cell_count: artifacts.riskHexCells.length
      };

      this.logInfo("recompute.complete", result);
      return result;
    } catch (error) {
      this.logError("recompute.failed", error, {
        recompute_time_utc: nowIso
      });
      throw error;
    }
  }

  private async fetchSourceSignals(
    start: string,
    end: string
  ): Promise<RawSignalRecord[]> {
    const { fetchStartIso, fetchEndIso } = expandSignalWindow(start, end);
    const [meteoRows, roadRows, roadAlertRows] = await Promise.all([
      this.fetchSignalView(
        this.config.meteoSourceView,
        "meteo",
        "meteo-forecast-points",
        fetchStartIso,
        fetchEndIso
      ),
      this.fetchSignalView(
        this.config.roadSourceView,
        "road",
        "road-weather-points",
        fetchStartIso,
        fetchEndIso
      ),
      this.fetchRoadAlertSignals(fetchStartIso, fetchEndIso)
    ]);

    this.logInfo("source_signals.loaded", {
      fetch_start_utc: fetchStartIso,
      fetch_end_utc: fetchEndIso,
      meteo_count: meteoRows.length,
      road_count: roadRows.length,
      road_alert_count: roadAlertRows.length
    });

    return [...meteoRows, ...roadRows, ...roadAlertRows];
  }

  private async fetchSignalView(
    viewName: string,
    source: "meteo" | "road",
    layerId: string,
    start: string,
    end: string
  ): Promise<RawSignalRecord[]> {
    const { data, error } = await this.client
      .from(viewName)
      .select("source_id, forecast_time_utc, latitude, longitude, location_name, metrics")
      .gte("forecast_time_utc", start)
      .lte("forecast_time_utc", end)
      .order("forecast_time_utc", { ascending: true });

    if (error) {
      if (this.config.useDemoData) {
        return [];
      }

      throw this.createContextError(
        `Failed to fetch signals from view ${viewName}`,
        error,
        {
          view: viewName,
          source,
          layer_id: layerId,
          start_utc: start,
          end_utc: end
        }
      );
    }

    return (data ?? []).map((row) => ({
      id: row.source_id as string,
      source,
      layer_id: layerId,
      forecast_time_utc: row.forecast_time_utc as string,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      location_name: row.location_name as string,
      metrics: ((row.metrics as RawSignalRecord["metrics"] | null) ?? {}) as RawSignalRecord["metrics"]
    }));
  }

  private async debugSourceWindow(viewName: string, start: string, end: string) {
    const { data, error } = await this.client
      .from(viewName)
      .select("source_id, forecast_time_utc, location_name")
      .gte("forecast_time_utc", start)
      .lte("forecast_time_utc", end)
      .order("forecast_time_utc", { ascending: true });

    if (error) {
      throw error;
    }

    const rows = ((data ?? []) as SourceDebugRow[]).map((row) => ({
      source_id: row.source_id,
      forecast_time_utc: row.forecast_time_utc,
      location_name: row.location_name
    }));

    return {
      view: viewName,
      row_count: rows.length,
      distinct_locations: new Set(rows.map((row) => row.location_name)).size,
      earliest_time_utc: rows[0]?.forecast_time_utc ?? null,
      latest_time_utc: rows.at(-1)?.forecast_time_utc ?? null,
      sample_rows: rows.slice(0, 8)
    };
  }

  private async listAvailableTimes(): Promise<string[]> {
    return buildTimeline(new Date().toISOString());
  }

  private async debugRawFrameRows(time: string): Promise<RawFrameDebugRow[]> {
    const { data, error } = await this.client
      .from("forecast_frames_raw")
      .select("source_id, layer_id, forecast_time_utc, location_name")
      .eq("forecast_time_utc", time)
      .order("layer_id", { ascending: true })
      .order("location_name", { ascending: true });

    if (error) {
      throw error;
    }

    return (data ?? []) as RawFrameDebugRow[];
  }

  private async debugRiskFrame(time: string) {
    const { data, error } = await this.client
      .from("risk_frames")
      .select("forecast_time_utc, generated_at, raw_feature_count, hex_cell_count")
      .eq("forecast_time_utc", time)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return null;
    }

    return {
      forecast_time_utc: data.forecast_time_utc as string,
      generated_at: data.generated_at as string,
      raw_feature_count: data.raw_feature_count as number,
      hex_cell_count: data.hex_cell_count as number
    };
  }

  private async debugNearbyTimes(
    tableName: "forecast_frames_raw" | "risk_frames",
    start: string,
    end: string
  ): Promise<string[]> {
    const { data, error } = await this.client
      .from(tableName)
      .select("forecast_time_utc")
      .gte("forecast_time_utc", start)
      .lte("forecast_time_utc", end)
      .order("forecast_time_utc", { ascending: true });

    if (error) {
      throw error;
    }

    return Array.from(
      new Set((data ?? []).map((row) => row.forecast_time_utc as string))
    );
  }

  private async listForecastRows(
    time: string,
    layerIds: string[]
  ): Promise<ForecastFrameRow[]> {
    let query = this.client
      .from("forecast_frames_raw")
      .select(
        "source_id, source, layer_id, forecast_time_utc, location_name, latitude, longitude, h3_index, geometry, metrics"
      )
      .eq("forecast_time_utc", time);

    if (layerIds.length > 0) {
      query = query.in("layer_id", layerIds);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    const exactRows = (data ?? []) as ForecastFrameRow[];
    const shouldIncludeRoadLayer =
      layerIds.length === 0 || layerIds.includes("road-weather-points");

    if (!shouldIncludeRoadLayer) {
      return exactRows;
    }

    const latestRoadRows = await this.listLatestRoadRowsByStation(time);
    if (latestRoadRows.length === 0) {
      return exactRows;
    }

    const rowsWithoutRoad = exactRows.filter(
      (row) => row.layer_id !== "road-weather-points"
    );

    return [...rowsWithoutRoad, ...latestRoadRows];
  }

  private async listLatestRoadRowsByStation(time: string): Promise<ForecastFrameRow[]> {
    const selectedTime = new Date(time);
    const lookbackStart = new Date(
      selectedTime.getTime() - ROAD_POINT_LOOKBACK_HOURS * 60 * 60 * 1000
    ).toISOString();

    const { data, error } = await this.client
      .from("forecast_frames_raw")
      .select(
        "source_id, source, layer_id, forecast_time_utc, location_name, latitude, longitude, h3_index, geometry, metrics"
      )
      .eq("layer_id", "road-weather-points")
      .gte("forecast_time_utc", lookbackStart)
      .lte("forecast_time_utc", selectedTime.toISOString())
      .order("forecast_time_utc", { ascending: false });

    if (error) {
      throw error;
    }

    const rows = (data ?? []) as ForecastFrameRow[];
    const perStation = new Map<string, ForecastFrameRow>();

    for (const row of rows) {
      const stationKey = row.source_id.split(":")[0] ?? row.source_id;
      if (!perStation.has(stationKey)) {
        perStation.set(stationKey, row);
      }
    }

    return Array.from(perStation.values());
  }

  private async listExerciseAreas(): Promise<GeoJsonFeatureCollection> {
    const { data, error } = await this.client
      .from("exercise_geometries")
      .select("id, name, geometry")
      .order("created_at", { ascending: true });

    if (error) {
      throw error;
    }

    return {
      type: "FeatureCollection",
      features: (data ?? []).map((row) => ({
        type: "Feature",
        id: row.id as string,
        geometry: row.geometry as GeoJsonGeometry,
        properties: {
          label: row.name as string,
          kind: "exercise"
        }
      }))
    };
  }

  private async listActivitiesAtTime(time: string) {
    const { data, error } = await this.client
      .from("exercise_activities")
      .select(
        "id, scenario_id, geometry_id, name, activity_type, starts_at, ends_at"
      )
      .lte("starts_at", time)
      .gte("ends_at", time)
      .order("starts_at", { ascending: true });

    if (error) {
      throw error;
    }

    const activityRows = (data ?? []) as Array<{
      id: string;
      scenario_id: string;
      geometry_id: string | null;
      name: string;
      activity_type: string;
      starts_at: string;
      ends_at: string;
    }>;

    if (activityRows.length === 0) {
      return [];
    }

    const geometryIds = Array.from(
      new Set(
        activityRows
          .map((item) => item.geometry_id)
          .filter((value): value is string => Boolean(value))
      )
    );

    const geometryMap = new Map<string, ExerciseGeometryRow>();
    if (geometryIds.length > 0) {
      const { data: geometries, error: geometryError } = await this.client
        .from("exercise_geometries")
        .select("id, scenario_id, name, geometry, centroid_lng, centroid_lat, h3_index")
        .in("id", geometryIds);

      if (geometryError) {
        throw geometryError;
      }

      for (const geometry of geometries ?? []) {
        geometryMap.set(geometry.id as string, geometry as ExerciseGeometryRow);
      }
    }

    const { data: cells, error: cellError } = await this.client
      .from("risk_hex_cells")
      .select(
        "h3_index, forecast_time_utc, geometry, center_lng, center_lat, risk_score, signal_count, red_signal_count, yellow_signal_count, confidence_multiplier, risk_level, risk_reasons, recommended_action, summary, raw_metrics"
      )
      .eq("forecast_time_utc", time);

    if (cellError) {
      throw cellError;
    }

    const mappedCells: RiskHexCellRow[] = (cells ?? []).map((row) => ({
      h3_index: row.h3_index as string,
      forecast_time_utc: row.forecast_time_utc as string,
      geometry: row.geometry as RiskHexCellRow["geometry"],
      center: [row.center_lng as number, row.center_lat as number],
      center_lng: row.center_lng as number,
      center_lat: row.center_lat as number,
      risk_score: row.risk_score as number,
      signal_count: row.signal_count as number,
      red_signal_count: row.red_signal_count as number,
      yellow_signal_count: row.yellow_signal_count as number,
      confidence_multiplier: Number(row.confidence_multiplier),
      risk_level: row.risk_level as RiskHexCellRow["risk_level"],
      risk_reasons: (row.risk_reasons as string[]) ?? [],
      recommended_action: row.recommended_action as RiskHexCellRow["recommended_action"],
      risk_summary: row.summary as string,
      raw_metrics: ((row.raw_metrics as JsonObject | null) ?? {}) as JsonObject
    }));

    const rows: ExerciseActivityRow[] = activityRows.map((row) => {
      const geometry = row.geometry_id ? geometryMap.get(row.geometry_id) : null;
      return {
        ...row,
        geometry: geometry?.geometry ?? null,
        geometry_h3_index: geometry?.h3_index ?? null,
        centroid_lng: geometry?.centroid_lng ?? null,
        centroid_lat: geometry?.centroid_lat ?? null
      };
    });

    return attachRiskToActivities(rows, mappedCells);
  }

  private async replaceForecastTimeSlice(
    forecastTime: string,
    rawRows: ForecastFrameRow[],
    riskFrame: {
      forecast_time_utc: string;
      generated_at: string;
      raw_feature_count: number;
      hex_cell_count: number;
    } | null,
    riskHexCells: RiskHexCellRow[]
  ): Promise<void> {
    await this.deleteForecastTimeSlice(forecastTime);

    if (rawRows.length > 0) {
      await this.insertRawFrames(rawRows);
    }

    if (riskFrame) {
      await this.insertRiskFrames([riskFrame]);
    }

    if (riskHexCells.length > 0) {
      await this.insertRiskHexCells(riskHexCells);
    }
  }

  private async deleteForecastTimeSlice(forecastTime: string): Promise<void> {
    const tables = ["forecast_frames_raw", "risk_hex_cells", "risk_frames"];
    for (const table of tables) {
      const { error } = await this.client
        .from(table)
        .delete()
        .eq("forecast_time_utc", forecastTime);

      if (error) {
        throw this.createContextError(
          `Failed to delete forecast time slice from ${table}`,
          error,
          {
            table,
            forecast_time_utc: forecastTime
          }
        );
      }
    }
  }

  private async insertRawFrames(rows: ForecastFrameRow[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    const batches = chunkArray(rows, RAW_FRAME_INSERT_BATCH_SIZE);

    for (const [index, batch] of batches.entries()) {
      const payload = batch.map((row) => ({
        source_id: row.source_id,
        source: row.source,
        layer_id: row.layer_id,
        forecast_time_utc: row.forecast_time_utc,
        location_name: row.location_name,
        latitude: row.latitude,
        longitude: row.longitude,
        h3_index: row.h3_index,
        geometry: row.geometry,
        metrics: row.metrics
      }));

      const { error } = await this.client.from("forecast_frames_raw").insert(payload);
      if (error) {
        throw this.createContextError(
          "Failed to insert forecast_frames_raw rows",
          error,
          {
            row_count: rows.length,
            batch_index: index + 1,
            batch_count: batches.length,
            batch_size: batch.length,
            sample_time_utc: batch[0]?.forecast_time_utc ?? null
          }
        );
      }
    }
  }

  private async insertRiskFrames(rows: Array<{
    forecast_time_utc: string;
    generated_at: string;
    raw_feature_count: number;
    hex_cell_count: number;
  }>): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    const { error } = await this.client.from("risk_frames").insert(rows);
    if (error) {
      throw this.createContextError(
        "Failed to insert risk_frames rows",
        error,
        {
          row_count: rows.length,
          sample_time_utc: rows[0]?.forecast_time_utc ?? null
        }
      );
    }
  }

  private async insertRiskHexCells(rows: RiskHexCellRow[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    const batches = chunkArray(rows, RISK_HEX_INSERT_BATCH_SIZE);

    for (const [index, batch] of batches.entries()) {
      const payload = batch.map((row) => ({
        h3_index: row.h3_index,
        forecast_time_utc: row.forecast_time_utc,
        geometry: row.geometry,
        center_lng: row.center_lng,
        center_lat: row.center_lat,
        risk_score: row.risk_score,
        signal_count: row.signal_count,
        red_signal_count: row.red_signal_count,
        yellow_signal_count: row.yellow_signal_count,
        confidence_multiplier: row.confidence_multiplier,
        risk_level: row.risk_level,
        risk_reasons: row.risk_reasons,
        recommended_action: row.recommended_action,
        summary: row.risk_summary,
        raw_metrics: row.raw_metrics
      }));

      const { error } = await this.client.from("risk_hex_cells").insert(payload);
      if (error) {
        throw this.createContextError(
          "Failed to insert risk_hex_cells rows",
          error,
          {
            row_count: rows.length,
            batch_index: index + 1,
            batch_count: batches.length,
            batch_size: batch.length,
            sample_time_utc: batch[0]?.forecast_time_utc ?? null,
            sample_h3_index: batch[0]?.h3_index ?? null
          }
        );
      }
    }
  }

  private async fetchRoadAlertSignals(
    start: string,
    end: string
  ): Promise<RawSignalRecord[]> {
    const { data, error } = await this.client
      .from("road_weather_alerts")
      .select("station_id, collected_at_utc, code, name")
      .gte("collected_at_utc", start)
      .lte("collected_at_utc", end)
      .order("collected_at_utc", { ascending: true });

    if (error) {
      throw this.createContextError(
        "Failed to fetch road weather alerts",
        error,
        {
          start_utc: start,
          end_utc: end
        }
      );
    }

    const alerts = (data ?? []) as Array<{
      station_id: number;
      collected_at_utc: string;
      code: string;
      name: string;
    }>;

    if (alerts.length === 0) {
      return [];
    }

    const stationIds = Array.from(new Set(alerts.map((alert) => alert.station_id)));
    const { data: stations, error: stationError } = await this.client
      .from("road_weather_stations")
      .select("id, lat, lon, device_name, road_number, road_name")
      .in("id", stationIds);

    if (stationError) {
      throw this.createContextError(
        "Failed to fetch road weather stations",
        stationError,
        {
          station_count: stationIds.length
        }
      );
    }

    const stationMap = new Map<number, {
      id: number;
      lat: number | null;
      lon: number | null;
      device_name: string | null;
      road_number: string | null;
      road_name: string | null;
    }>();

    for (const station of (stations ?? []) as Array<{
      id: number;
      lat: number | null;
      lon: number | null;
      device_name: string | null;
      road_number: string | null;
      road_name: string | null;
    }>) {
      stationMap.set(station.id, station);
    }

    const mappedAlerts: Array<RawSignalRecord | null> = alerts.map((alert) => {
        const station = stationMap.get(alert.station_id);
        if (!station || station.lat === null || station.lon === null) {
          return null;
        }

        return {
          id: `${alert.station_id}:${alert.collected_at_utc}:${alert.code}`,
          source: "road" as const,
          layer_id: "road-alerts",
          forecast_time_utc: alert.collected_at_utc,
          latitude: station.lat,
          longitude: station.lon,
          location_name:
            station.device_name ||
            [station.road_number, station.road_name].filter(Boolean).join(" ") ||
            `Road station ${alert.station_id}`,
          metrics: {
            road_restriction: true,
            alert_code: alert.code,
            alert_name: alert.name
          }
        } satisfies RawSignalRecord;
      });

    return mappedAlerts.filter(
      (value): value is RawSignalRecord => value !== null
    );
  }

  private logInfo(event: string, details: Record<string, unknown>): void {
    console.info(`[repository] ${event} ${safeStringify(details)}`);
  }

  private logError(
    event: string,
    error: unknown,
    details: Record<string, unknown>
  ): void {
    console.error(
      `[repository] ${event} ${safeStringify({
        ...details,
        error: serializeError(error, { includeStack: true })
      })}`
    );
  }

  private createContextError(
    message: string,
    error: unknown,
    context: Record<string, unknown>
  ): Error {
    return Object.assign(
      new Error(`${message}. ${formatErrorMessage(error)}. context=${safeStringify(context)}`),
      { cause: error }
    );
  }
}

function geometryCentroid(geometry: GeoJsonGeometry): [number, number] {
  if (geometry.type === "Point") {
    return geometry.coordinates;
  }

  const points =
    geometry.type === "LineString"
      ? geometry.coordinates
      : geometry.coordinates[0];

  const sum = points.reduce<[number, number]>(
    (current, point) => [current[0] + point[0], current[1] + point[1]],
    [0, 0]
  );

  return [sum[0] / points.length, sum[1] / points.length];
}

function countBy<T>(
  items: T[],
  pickKey: (item: T) => string
): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = pickKey(item);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function groupBy<T>(
  items: T[],
  pickKey: (item: T) => string
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();

  for (const item of items) {
    const key = pickKey(item);
    const current = grouped.get(key) ?? [];
    current.push(item);
    grouped.set(key, current);
  }

  return grouped;
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}
