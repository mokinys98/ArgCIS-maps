export type JsonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | JsonObject
  | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export type RiskLevel = "green" | "yellow" | "red";

export type RecommendedAction =
  | "vykdyti"
  | "vykdyti su ribojimais"
  | "keisti marsruta"
  | "perkelti"
  | "stabdyti";

export interface RiskSummary {
  risk_score: number;
  risk_level: RiskLevel;
  risk_reasons: string[];
  recommended_action: RecommendedAction;
  risk_summary: string;
}

export interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface PointGeometry {
  type: "Point";
  coordinates: [number, number];
}

export interface LineStringGeometry {
  type: "LineString";
  coordinates: [number, number][];
}

export interface PolygonGeometry {
  type: "Polygon";
  coordinates: [number, number][][];
}

export type GeoJsonGeometry =
  | PointGeometry
  | LineStringGeometry
  | PolygonGeometry;

export interface GeoJsonFeature<
  G extends GeoJsonGeometry = GeoJsonGeometry,
  P extends JsonObject = JsonObject
> {
  type: "Feature";
  id?: string;
  geometry: G;
  properties: P;
}

export interface GeoJsonFeatureCollection<
  G extends GeoJsonGeometry = GeoJsonGeometry,
  P extends JsonObject = JsonObject
> {
  type: "FeatureCollection";
  features: GeoJsonFeature<G, P>[];
}

export type LayerKind = "raw" | "calculated" | "exercise";
export type LayerRenderType = "circle" | "line" | "fill" | "hex" | "hex-outline";

export interface LayerDefinition {
  id: string;
  name: string;
  description: string;
  kind: LayerKind;
  render_type: LayerRenderType;
  default_visible: boolean;
  default_opacity: number;
  color_hint: string;
}

export interface RawSignalMetrics extends JsonObject {
  wind_gust_ms?: number;
  wind_speed_ms?: number;
  visibility_m?: number;
  thunder_probability?: number;
  precipitation_mm?: number;
  road_ice?: boolean;
  road_restriction?: boolean;
  surface_state?: string;
  air_temperature_c?: number;
}

export interface RawSignalRecord {
  id: string;
  source: "meteo" | "road";
  layer_id: string;
  forecast_time_utc: string;
  latitude: number;
  longitude: number;
  location_name: string;
  metrics: RawSignalMetrics;
}

export interface FrameLayerData {
  layer_id: string;
  layer_name: string;
  feature_collection: GeoJsonFeatureCollection;
}

export interface MapFrameResponse {
  time: string;
  available_times: string[];
  layers: FrameLayerData[];
  activities: ExerciseActivity[];
}

export interface RiskHexCell extends RiskSummary {
  h3_index: string;
  forecast_time_utc: string;
  geometry: PolygonGeometry;
  center: [number, number];
  raw_metrics: JsonObject;
}

export interface H3OutlineCell {
  h3_index: string;
  forecast_time_utc: string;
  geometry: PolygonGeometry;
  center: [number, number];
}

export interface MapHexResponse {
  time: string;
  cells: RiskHexCell[];
  outline_cells: H3OutlineCell[];
}

export interface ExerciseScenario {
  id: string;
  name: string;
  description: string | null;
  starts_at: string | null;
  ends_at: string | null;
  owner_id: string | null;
}

export interface ExerciseGeometry {
  id: string;
  scenario_id: string;
  name: string;
  geometry: GeoJsonGeometry;
  centroid: [number, number];
  h3_index: string | null;
}

export interface ExerciseActivity extends RiskSummary {
  id: string;
  scenario_id: string;
  geometry_id: string | null;
  name: string;
  activity_type: string;
  starts_at: string;
  ends_at: string;
  geometry: GeoJsonGeometry | null;
}

export interface SavedMapLayer {
  id: string;
  layer_id: string;
  ordering: number;
  visible: boolean;
  opacity: number;
  filters: JsonObject;
  active_time_utc: string | null;
}

export interface SavedMap {
  id: string;
  owner_id: string | null;
  name: string;
  description: string | null;
  active_time_utc: string | null;
  layers: SavedMapLayer[];
}

export interface LayerCatalogResponse {
  layers: LayerDefinition[];
}

export interface RecomputeResult {
  generated_at: string;
  frame_count: number;
  raw_frame_count: number;
  hex_cell_count: number;
}
