import {
  demoActivities,
  demoFrame,
  demoHex,
  demoLayerCatalog
} from "@argcis/shared";
import type {
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
import type { AppConfig } from "./config";
import {
  attachRiskToActivities,
  buildFrameResponse,
  buildHexResponse,
  buildSyntheticArtifacts,
  buildTimeline,
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
        "h3_index, forecast_time_utc, geometry, center_lng, center_lat, risk_level, risk_reasons, recommended_action, summary, raw_metrics"
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
      risk_level: row.risk_level as RiskHexCellRow["risk_level"],
      risk_reasons: (row.risk_reasons as string[]) ?? [],
      recommended_action: row.recommended_action as RiskHexCellRow["recommended_action"],
      risk_summary: row.summary as string,
      raw_metrics: ((row.raw_metrics as JsonObject | null) ?? {}) as JsonObject
    }));

    return buildHexResponse(time, cells, bbox);
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
    if (this.config.useDemoData) {
      const frame = demoFrame(nowIso);
      const hex = demoHex(nowIso);
      return {
        generated_at: nowIso,
        frame_count: frame.available_times.length,
        raw_frame_count: frame.layers.reduce(
          (total, layer) => total + layer.feature_collection.features.length,
          0
        ),
        hex_cell_count: hex.cells.length
      };
    }

    const timeline = buildTimeline(nowIso);
    const start = timeline[0];
    const end = timeline[timeline.length - 1];
    const sourceSignals = await this.fetchSourceSignals(start, end);
    const artifacts = buildSyntheticArtifacts(
      sourceSignals,
      nowIso,
      this.config.h3Resolution
    );

    await this.deleteSyntheticWindow(start, end);
    await this.insertRawFrames(artifacts.rawRows);
    await this.insertRiskFrames(artifacts.riskFrames);
    await this.insertRiskHexCells(artifacts.riskHexCells);

    return {
      generated_at: nowIso,
      frame_count: artifacts.riskFrames.length,
      raw_frame_count: artifacts.rawRows.length,
      hex_cell_count: artifacts.riskHexCells.length
    };
  }

  private async fetchSourceSignals(
    start: string,
    end: string
  ): Promise<RawSignalRecord[]> {
    const [meteoRows, roadRows] = await Promise.all([
      this.fetchSignalView(
        this.config.meteoSourceView,
        "meteo",
        "meteo-forecast-points",
        start,
        end
      ),
      this.fetchSignalView(
        this.config.roadSourceView,
        "road",
        "road-weather-points",
        start,
        end
      )
    ]);

    return [...meteoRows, ...roadRows];
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

      throw error;
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

  private async listAvailableTimes(): Promise<string[]> {
    const { data, error } = await this.client
      .from("risk_frames")
      .select("forecast_time_utc")
      .order("forecast_time_utc", { ascending: true });

    if (error) {
      throw error;
    }

    return (data ?? []).map((item) => item.forecast_time_utc as string);
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

    return (data ?? []) as ForecastFrameRow[];
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
        "h3_index, forecast_time_utc, geometry, center_lng, center_lat, risk_level, risk_reasons, recommended_action, summary, raw_metrics"
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

  private async deleteSyntheticWindow(start: string, end: string): Promise<void> {
    const tables = ["forecast_frames_raw", "risk_hex_cells", "risk_frames"];
    for (const table of tables) {
      const { error } = await this.client
        .from(table)
        .delete()
        .gte("forecast_time_utc", start)
        .lte("forecast_time_utc", end);

      if (error) {
        throw error;
      }
    }
  }

  private async insertRawFrames(rows: ForecastFrameRow[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    const payload = rows.map((row) => ({
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
      throw error;
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
      throw error;
    }
  }

  private async insertRiskHexCells(rows: RiskHexCellRow[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    const payload = rows.map((row) => ({
      h3_index: row.h3_index,
      forecast_time_utc: row.forecast_time_utc,
      geometry: row.geometry,
      center_lng: row.center_lng,
      center_lat: row.center_lat,
      risk_level: row.risk_level,
      risk_reasons: row.risk_reasons,
      recommended_action: row.recommended_action,
      summary: row.risk_summary,
      raw_metrics: row.raw_metrics
    }));

    const { error } = await this.client.from("risk_hex_cells").insert(payload);
    if (error) {
      throw error;
    }
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
