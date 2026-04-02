import {
  aggregateRiskSummaries,
  demoRouteRisk,
  evaluateRisk,
  type MapHexResponse,
  type RiskSummary,
  type RouteEndpoint,
  type RouteRiskRequest,
  type RouteRiskResponse,
  type RouteSegmentRisk
} from "@argcis/shared";
import { latLngToCell } from "h3-js";
import type { AppConfig } from "./config";

const MAX_SAMPLE_SPACING_M = 12000;

interface RouteRiskRepository {
  getHex(time: string, bbox: null): Promise<MapHexResponse>;
}

interface MapboxGeocodingResponse {
  features?: Array<{
    place_name?: string;
    center?: [number, number];
  }>;
}

interface MapboxDirectionsResponse {
  routes?: Array<{
    distance?: number;
    duration?: number;
    geometry?: {
      type?: "LineString";
      coordinates?: [number, number][];
    };
    legs?: Array<{
      steps?: Array<{
        distance?: number;
        duration?: number;
        name?: string;
        geometry?: {
          type?: "LineString";
          coordinates?: [number, number][];
        };
        maneuver?: {
          instruction?: string;
        };
      }>;
    }>;
  }>;
}

export class RoutePlanningError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

export async function getRouteRisk(
  config: AppConfig,
  repository: RouteRiskRepository,
  request: RouteRiskRequest,
  fetchImpl: typeof fetch = fetch
): Promise<RouteRiskResponse> {
  if (!request.from_address.trim()) {
    throw new RoutePlanningError("Pradzios adresas yra privalomas.", 400);
  }

  if (!request.to_address.trim()) {
    throw new RoutePlanningError("Pabaigos adresas yra privalomas.", 400);
  }

  if (config.useDemoData) {
    try {
      return demoRouteRisk(request);
    } catch (error) {
      throw new RoutePlanningError(
        error instanceof Error ? error.message : "Nepavyko suplanuoti marsruto.",
        404
      );
    }
  }

  if (!config.mapboxAccessToken) {
    throw new RoutePlanningError("MAPBOX_ACCESS_TOKEN nera sukonfiguruotas.", 500);
  }

  const [origin, destination] = await Promise.all([
    geocodeAddress(request.from_address, config.mapboxAccessToken, fetchImpl, "Pradzios"),
    geocodeAddress(request.to_address, config.mapboxAccessToken, fetchImpl, "Pabaigos")
  ]);

  const route = await fetchDirections(
    origin.coordinates,
    destination.coordinates,
    config.mapboxAccessToken,
    fetchImpl
  );
  const hex = await repository.getHex(request.time, null);
  const segmentBlueprints = buildSegmentBlueprints(route);
  const segments: RouteSegmentRisk[] = [];
  const cellLookup = new Map(hex.cells.map((cell) => [cell.h3_index, cell]));

  for (const blueprint of segmentBlueprints) {
    const summaries = blueprint.sampleCoordinates.map((coordinates) =>
      getCoordinateRiskForTime(
        coordinates[1],
        coordinates[0],
        config.h3Resolution,
        hex.cells,
        cellLookup
      )
    );
    const summary = aggregateRiskSummaries(summaries);

    segments.push({
      id: blueprint.id,
      geometry: blueprint.geometry,
      distance_m: blueprint.distance_m,
      duration_s:
        route.distance_m > 0
          ? Math.max(1, Math.round(route.duration_s * (blueprint.distance_m / route.distance_m)))
          : blueprint.duration_s,
      sample_count: blueprint.sampleCoordinates.length,
      instruction: blueprint.instruction,
      road_name: blueprint.road_name,
      ...summary
    });
  }

  return {
    time: request.time,
    origin,
    destination,
    route,
    segments,
    summary: aggregateRiskSummaries(segments)
  };
}

async function geocodeAddress(
  address: string,
  accessToken: string,
  fetchImpl: typeof fetch,
  label: string
): Promise<RouteEndpoint> {
  const params = new URLSearchParams({
    access_token: accessToken,
    limit: "1",
    autocomplete: "true"
  });
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?` +
    params.toString();
  const response = await fetchImpl(url);

  if (!response.ok) {
    throw new RoutePlanningError(`${label} adreso geocoding uzklausa nepavyko.`, 502);
  }

  const body = (await response.json()) as MapboxGeocodingResponse;
  const feature = body.features?.[0];
  const coordinates = feature?.center;

  if (!feature?.place_name || !coordinates || coordinates.length !== 2) {
    throw new RoutePlanningError(`${label} adresas nerastas.`, 404);
  }

  return {
    address: feature.place_name,
    coordinates
  };
}

async function fetchDirections(
  origin: [number, number],
  destination: [number, number],
  accessToken: string,
  fetchImpl: typeof fetch
): Promise<RouteRiskResponse["route"]> {
  const coordinates = `${origin[0]},${origin[1]};${destination[0]},${destination[1]}`;
  const params = new URLSearchParams({
    access_token: accessToken,
    geometries: "geojson",
    overview: "full",
    steps: "true"
  });
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving/${coordinates}?${params.toString()}`;
  const response = await fetchImpl(url);

  if (!response.ok) {
    throw new RoutePlanningError("Directions uzklausa nepavyko.", 502);
  }

  const body = (await response.json()) as MapboxDirectionsResponse;
  const route = body.routes?.[0];
  const geometry = route?.geometry;

  if (
    !route ||
    !geometry ||
    geometry.type !== "LineString" ||
    !geometry.coordinates ||
    geometry.coordinates.length < 2
  ) {
    throw new RoutePlanningError("Marsrutas tarp nurodytu adresu nerastas.", 404);
  }

  return {
    geometry: {
      type: "LineString",
      coordinates: geometry.coordinates
    },
    distance_m: Math.round(route.distance ?? 0),
    duration_s: Math.round(route.duration ?? 0),
    steps:
      route.legs?.flatMap((leg) => leg.steps ?? []).map((step, index) => ({
        id: `route-step-${index + 1}`,
        distance_m: Math.round(step.distance ?? 0),
        duration_s: Math.round(step.duration ?? 0),
        instruction: step.maneuver?.instruction?.trim() || step.name?.trim() || `Zingsnis ${index + 1}`,
        road_name: step.name?.trim() || "",
        geometry:
          step.geometry?.type === "LineString" &&
          step.geometry.coordinates &&
          step.geometry.coordinates.length >= 2
            ? {
                type: "LineString" as const,
                coordinates: step.geometry.coordinates
              }
            : null
      })) ?? []
  };
}

function getCoordinateRiskForTime(
  latitude: number,
  longitude: number,
  h3Resolution: number,
  cells: MapHexResponse["cells"],
  cellLookup: Map<string, MapHexResponse["cells"][number]>
): RiskSummary {
  const h3Index = latLngToCell(latitude, longitude, h3Resolution);
  const matched = cellLookup.get(h3Index) ?? findNearestCell(latitude, longitude, cells);

  return matched ?? evaluateRisk({});
}

function findNearestCell(
  latitude: number,
  longitude: number,
  cells: MapHexResponse["cells"]
): MapHexResponse["cells"][number] | null {
  if (cells.length === 0) {
    return null;
  }

  return cells.reduce<{
    cell: MapHexResponse["cells"][number];
    distance: number;
  } | null>((best, cell) => {
    const distance =
      Math.abs(cell.center[1] - latitude) + Math.abs(cell.center[0] - longitude);

    if (!best || distance < best.distance) {
      return {
        cell,
        distance
      };
    }

    return best;
  }, null)?.cell ?? null;
}

function buildSegmentBlueprints(
  route: RouteRiskResponse["route"] & {
    steps?: Array<{
      id: string;
      distance_m: number;
      duration_s: number;
      instruction: string;
      road_name: string;
      geometry: {
        type: "LineString";
        coordinates: [number, number][];
      } | null;
    }>;
  }
) {
  const steps = route.steps?.filter(
    (step) => step.geometry && step.geometry.coordinates.length >= 2
  );

  if (steps && steps.length > 0) {
    return steps.map((step) => {
      const coordinates = step.geometry!.coordinates;
      const samplePoints = densifyCoordinates(coordinates, MAX_SAMPLE_SPACING_M);
      const midpoint =
        samplePoints.length > 2
          ? samplePoints[Math.floor(samplePoints.length / 2)]!
          : interpolateCoordinate(coordinates[0]!, coordinates.at(-1)!, 0.5);

      return {
        id: step.id,
        geometry: step.geometry!,
        distance_m: step.distance_m,
        duration_s: step.duration_s,
        instruction: step.instruction,
        road_name: step.road_name,
        sampleCoordinates: [coordinates[0]!, midpoint, coordinates.at(-1)!]
      };
    });
  }

  const samplePoints = densifyCoordinates(route.geometry.coordinates, MAX_SAMPLE_SPACING_M);

  return samplePoints.slice(0, -1).map((coordinates, index) => {
    const next = samplePoints[index + 1]!;
    const midpoint = interpolateCoordinate(coordinates, next, 0.5);
    const distance_m = getDistanceMeters(coordinates, next);

    return {
      id: `route-segment-${index + 1}`,
      geometry: {
        type: "LineString" as const,
        coordinates: [coordinates, next]
      },
      distance_m,
      duration_s:
        route.distance_m > 0
          ? Math.max(1, Math.round(route.duration_s * (distance_m / route.distance_m)))
          : 0,
      instruction: `Atkarpa ${index + 1}`,
      road_name: "",
      sampleCoordinates: [coordinates, midpoint, next]
    };
  });
}

function densifyCoordinates(
  coordinates: [number, number][],
  maxSpacingM: number
): [number, number][] {
  const densified: [number, number][] = [];

  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const start = coordinates[index]!;
    const end = coordinates[index + 1]!;
    const distance = getDistanceMeters(start, end);
    const steps = Math.max(1, Math.ceil(distance / maxSpacingM));

    if (index === 0) {
      densified.push(start);
    }

    for (let step = 1; step <= steps; step += 1) {
      densified.push(interpolateCoordinate(start, end, step / steps));
    }
  }

  return densified;
}

function interpolateCoordinate(
  start: [number, number],
  end: [number, number],
  factor: number
): [number, number] {
  return [
    start[0] + (end[0] - start[0]) * factor,
    start[1] + (end[1] - start[1]) * factor
  ];
}

function getLineDistanceMeters(coordinates: [number, number][]): number {
  return coordinates.slice(0, -1).reduce((total, coordinate, index) => {
    return total + getDistanceMeters(coordinate, coordinates[index + 1]!);
  }, 0);
}

function getDistanceMeters(
  start: [number, number],
  end: [number, number]
): number {
  const earthRadius = 6371000;
  const lat1 = toRadians(start[1]);
  const lat2 = toRadians(end[1]);
  const deltaLat = toRadians(end[1] - start[1]);
  const deltaLng = toRadians(end[0] - start[0]);
  const haversine =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);

  return 2 * earthRadius * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}
