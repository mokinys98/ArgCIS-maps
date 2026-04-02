import { floorToHour, getConfig, requireSupabase, type Env } from "./config";
import { authenticateRequest } from "./auth";
import {
  emptyResponse,
  jsonResponse,
  parseBbox,
  parseLayerIds,
  readJson
} from "./http";
import { formatErrorMessage, safeStringify, serializeError } from "./logging";
import { ArgcisRepository } from "./repository";
import { getRouteRisk, RoutePlanningError } from "./route-risk";

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const config = getConfig(env);
  const requestOrigin = request.headers.get("origin");
  const url = new URL(request.url);
  const apiIndex = buildApiIndex(url, config);

  if (request.method === "OPTIONS") {
    return emptyResponse(config, 204, requestOrigin);
  }

  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/api")) {
    return jsonResponse(config, apiIndex, 200, requestOrigin);
  }

  if (!config.useDemoData) {
    requireSupabase(config);
  }

  const repository = new ArgcisRepository(config);

  try {
    if (url.pathname === "/health") {
      return jsonResponse(
        config,
        {
          ok: true,
          service: "argcis-risk-worker",
          demo_mode: config.useDemoData,
          h3_resolution: config.h3Resolution,
          docs_url: `${url.origin}/api`,
          endpoints_url: `${url.origin}/api`
        },
        200,
        requestOrigin
      );
    }

    const requireAuth = !config.allowAnonRead;
    const user = await authenticateRequest(request, config, requireAuth);

    if (request.method === "GET" && url.pathname === "/api/map/layers") {
      return jsonResponse(config, await repository.getLayerCatalog(), 200, requestOrigin);
    }

    if (request.method === "GET" && url.pathname === "/api/map/frame") {
      const time = resolveRequestTime(url.searchParams.get("time"));
      const layers = parseLayerIds(url.searchParams.get("layers"));
      return jsonResponse(config, await repository.getFrame(time, layers), 200, requestOrigin);
    }

    if (request.method === "GET" && url.pathname === "/api/map/hex") {
      const time = resolveRequestTime(url.searchParams.get("time"));
      const bbox = parseBbox(url.searchParams.get("bbox"));
      return jsonResponse(config, await repository.getHex(time, bbox), 200, requestOrigin);
    }

    if (request.method === "GET" && url.pathname === "/api/risk/coordinate") {
      const coordinates = resolveCoordinateQuery(
        url.searchParams.get("lat"),
        url.searchParams.get("lng") ?? url.searchParams.get("lon")
      );

      if (
        !coordinates ||
        coordinates.latitude < -90 ||
        coordinates.latitude > 90 ||
        coordinates.longitude < -180 ||
        coordinates.longitude > 180
      ) {
        return jsonResponse(
          config,
          { error: "Query params lat and lng (or lon) must be valid coordinates." },
          400,
          requestOrigin
        );
      }

      return jsonResponse(
        config,
        await repository.getRiskByCoordinate(coordinates.latitude, coordinates.longitude),
        200,
        requestOrigin
      );
    }

    if (request.method === "POST" && url.pathname === "/api/route/risk") {
      const body = await readJson<{
        from_address?: string;
        to_address?: string;
        time?: string;
      }>(request);

      return jsonResponse(
        config,
        await getRouteRisk(
          config,
          repository,
          {
            from_address: body.from_address ?? "",
            to_address: body.to_address ?? "",
            time: resolveRequestTime(body.time ?? null)
          },
          fetch
        ),
        200,
        requestOrigin
      );
    }

    if (request.method === "GET" && url.pathname === "/api/internal/debug/forecast") {
      const time = resolveRequestTime(url.searchParams.get("time"));
      return jsonResponse(
        config,
        await repository.debugForecastTime(time),
        200,
        requestOrigin
      );
    }

    if (request.method === "GET" && url.pathname === "/api/exercises") {
      return jsonResponse(config, await repository.listExercises(), 200, requestOrigin);
    }

    if (request.method === "POST" && url.pathname === "/api/exercises") {
      const body = await readJson<{
        name: string;
        description?: string | null;
        starts_at?: string | null;
        ends_at?: string | null;
        geometry_name?: string | null;
        geometry?: unknown;
      }>(request);

      return jsonResponse(
        config,
        await repository.createExercise(user?.id ?? null, {
          name: body.name,
          description: body.description ?? null,
          starts_at: body.starts_at ?? null,
          ends_at: body.ends_at ?? null,
          geometry_name: body.geometry_name ?? null,
          geometry: (body.geometry as never) ?? null
        }),
        201,
        requestOrigin
      );
    }

    if (request.method === "GET" && url.pathname === "/api/exercise-activities") {
      const time = resolveRequestTime(url.searchParams.get("time"));
      return jsonResponse(
        config,
        await repository.listExerciseActivities(time),
        200,
        requestOrigin
      );
    }

    if (request.method === "POST" && url.pathname === "/api/exercise-activities") {
      const body = await readJson<{
        scenario_id: string;
        geometry_id?: string | null;
        name: string;
        activity_type: string;
        starts_at: string;
        ends_at: string;
      }>(request);

      return jsonResponse(
        config,
        await repository.createExerciseActivity(user?.id ?? null, body),
        201,
        requestOrigin
      );
    }

    if (request.method === "GET" && url.pathname === "/api/saved-maps") {
      return jsonResponse(
        config,
        await repository.listSavedMaps(user?.id ?? null),
        200,
        requestOrigin
      );
    }

    if (request.method === "POST" && url.pathname === "/api/saved-maps") {
      const body = await readJson<{
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
      }>(request);

      return jsonResponse(
        config,
        await repository.createSavedMap(user?.id ?? null, body),
        201,
        requestOrigin
      );
    }

    if (request.method === "POST" && url.pathname === "/api/internal/recompute") {
      const recomputeTime = resolveRequestTime(url.searchParams.get("time"));
      console.info(
        `[api.internal.recompute] ${safeStringify({
          method: request.method,
          path: url.pathname,
          requested_time: url.searchParams.get("time"),
          recompute_time_utc: recomputeTime
        })}`
      );
      return jsonResponse(
        config,
        await repository.recompute(recomputeTime),
        200,
        requestOrigin
      );
    }

    if (request.method === "GET" && url.pathname === "/api/internal/recompute/table") {
      const recomputeTime = resolveRequestTime(url.searchParams.get("time"));
      console.info(
        `[api.internal.recompute.table] ${safeStringify({
          method: request.method,
          path: url.pathname,
          requested_time: url.searchParams.get("time"),
          recompute_time_utc: recomputeTime
        })}`
      );
      return jsonResponse(
        config,
        await repository.getRecomputeSegmentsTable(recomputeTime),
        200,
        requestOrigin
      );
    }

    const allowedMethods = getAllowedMethods(url.pathname);
    if (allowedMethods.length > 0) {
      return jsonResponse(
        config,
        {
          error: `Method ${request.method} is not allowed for ${url.pathname}.`,
          allowed_methods: allowedMethods,
          docs_url: `${url.origin}/api`
        },
        405,
        requestOrigin
      );
    }

    return jsonResponse(
      config,
      {
        error: "Not found.",
        docs_url: `${url.origin}/api`,
        available_paths: apiIndex.endpoints.map((endpoint) => endpoint.path)
      },
      404,
      requestOrigin
    );
  } catch (error) {
    if (error instanceof RoutePlanningError) {
      return jsonResponse(
        config,
        {
          error: error.message
        },
        error.status,
        requestOrigin
      );
    }

    const details = serializeError(error, { includeStack: true });
    const message = formatErrorMessage(error);

    console.error(
      `[request.failed] ${safeStringify({
        method: request.method,
        path: url.pathname,
        query: url.search,
        error: details
      })}`
    );

    return jsonResponse(
      config,
      url.pathname.startsWith("/api/internal/")
        ? {
            error: message,
            details: serializeError(error)
          }
        : {
            error: message
          },
      500,
      requestOrigin
    );
  }
}

function normalizeRequestTime(input: string): string {
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid time query param.");
  }

  return parsed.toISOString();
}

function resolveRequestTime(input: string | null): string {
  if (!input?.trim()) {
    return new Date().toISOString();
  }

  return normalizeRequestTime(input);
}

function resolveCoordinateQuery(
  latitudeInput: string | null,
  longitudeInput: string | null
): { latitude: number; longitude: number } | null {
  const defaultLatitude = 54.6872;
  const defaultLongitude = 25.2797;
  const latitude = parseCoordinateValue(latitudeInput, defaultLatitude);
  const longitude = parseCoordinateValue(longitudeInput, defaultLongitude);

  if (latitude === null || longitude === null) {
    return null;
  }

  return {
    latitude,
    longitude
  };
}

function parseCoordinateValue(input: string | null, fallback: number): number | null {
  if (!input?.trim()) {
    return fallback;
  }

  const value = Number(input);
  if (!Number.isFinite(value)) {
    return null;
  }

  return value;
}

function buildApiIndex(url: URL, config: ReturnType<typeof getConfig>) {
  const baseUrl = url.origin;
  const methodPriority: Record<string, number> = {
    GET: 0,
    POST: 1
  };

  const endpoints = [
    {
      method: "GET",
      path: "/health",
      summary: "Worker health status.",
      response_example: {
        ok: true,
        service: "argcis-risk-worker"
      }
    },
    {
      method: "GET",
      path: "/api",
      summary: "API index with usage instructions."
    },
    {
      method: "GET",
      path: "/api/map/layers",
      summary: "Returns available map layers."
    },
    {
      method: "GET",
      path: "/api/map/frame",
        summary: "Returns map frame data for a specific forecast time.",
        query: {
          time: "ISO datetime, optional, defaults to current time",
          layers: "Comma-separated layer ids, optional"
        },
      example: `${baseUrl}/api/map/frame?time=2026-04-01T09:00:00.000Z&layers=meteo_risk,road_risk`
    },
    {
      method: "GET",
      path: "/api/map/hex",
        summary: "Returns H3 hex risk cells.",
        query: {
          time: "ISO datetime, optional, defaults to current time",
          bbox: "west,south,east,north, optional"
        },
      example: `${baseUrl}/api/map/hex?time=2026-04-01T09:00:00.000Z&bbox=20,54,27,57`
    },
    {
      method: "GET",
      path: "/api/risk/coordinate",
      summary: "Returns risk timeline for one coordinate.",
      query: {
        lat: "Optional latitude, defaults to Vilnius",
        lng: "Optional longitude, defaults to Vilnius"
      },
      example: `${baseUrl}/api/risk/coordinate?lat=54.6872&lng=25.2797`
    },
    {
      method: "POST",
      path: "/api/route/risk",
      summary: "Geocodes two addresses, returns a route and risk evaluation.",
      body: {
        from_address: "Required origin address",
        to_address: "Required destination address",
        time: "Required ISO datetime"
      },
      body_example: {
        from_address: "Vilnius, Lithuania",
        to_address: "Kaunas, Lithuania",
        time: "2026-04-01T09:00:00.000Z"
      }
    },
    {
      method: "GET",
      path: "/api/exercises",
      summary: "Lists exercises."
    },
    {
      method: "POST",
      path: "/api/exercises",
      summary: "Creates an exercise.",
      body: {
        name: "Required string",
        description: "Optional string",
        starts_at: "Optional ISO datetime",
        ends_at: "Optional ISO datetime",
        geometry_name: "Optional string",
        geometry: "Optional GeoJSON geometry"
      },
      body_example: {
        name: "Spring exercise",
        description: "Scenario for risk simulation",
        starts_at: "2026-04-01T09:00:00.000Z",
        ends_at: "2026-04-01T15:00:00.000Z",
        geometry_name: "Vilnius area",
        geometry: {
          type: "Point",
          coordinates: [25.2797, 54.6872]
        }
      }
    },
    {
      method: "GET",
      path: "/api/exercise-activities",
      summary: "Lists exercise activities for a time.",
      query: {
        time: "ISO datetime, optional, defaults to current time"
      }
    },
    {
      method: "POST",
      path: "/api/exercise-activities",
      summary: "Creates an exercise activity.",
      body: {
        scenario_id: "Required exercise id",
        geometry_id: "Optional geometry id",
        name: "Required string",
        activity_type: "Required string",
        starts_at: "Required ISO datetime",
        ends_at: "Required ISO datetime"
      },
      body_example: {
        scenario_id: "exercise-id",
        geometry_id: "geometry-id",
        name: "Evacuation stage",
        activity_type: "evacuation",
        starts_at: "2026-04-01T10:00:00.000Z",
        ends_at: "2026-04-01T12:00:00.000Z"
      }
    },
    {
      method: "GET",
      path: "/api/saved-maps",
      summary: "Lists saved maps for the current user."
    },
    {
      method: "POST",
      path: "/api/saved-maps",
      summary: "Creates a saved map.",
      body: {
        name: "Required string",
        description: "Optional string",
        active_time_utc: "Optional ISO datetime",
        layers: "Required array of layer configurations"
      },
      body_example: {
        name: "Morning risk view",
        description: "Saved layer set",
        active_time_utc: "2026-04-01T09:00:00.000Z",
        layers: [
          {
            layer_id: "meteo_risk",
            ordering: 0,
            visible: true,
            opacity: 0.9,
            filters: {},
            active_time_utc: "2026-04-01T09:00:00.000Z"
          }
        ]
      }
    },
    {
      method: "GET",
      path: "/api/internal/debug/forecast",
      summary: "Debug forecast time resolution.",
      query: {
        time: "ISO datetime, optional, defaults to current time"
      },
      internal: true
    },
    {
      method: "POST",
      path: "/api/internal/recompute",
      summary: "Recomputes risk data for a specific hour.",
      query: {
        time: "ISO datetime, optional, defaults to current time"
      },
      internal: true
    },
    {
      method: "GET",
      path: "/api/internal/recompute/table",
      summary: "Returns the data table that recompute would use for a specific time.",
      query: {
        time: "ISO datetime, optional, defaults to current time"
      },
      internal: true
    }
  ].sort((left, right) => {
    const methodOrder =
      (methodPriority[left.method] ?? Number.MAX_SAFE_INTEGER) -
      (methodPriority[right.method] ?? Number.MAX_SAFE_INTEGER);

    if (methodOrder !== 0) {
      return methodOrder;
    }

    return left.path.localeCompare(right.path);
  });

  return {
    service: "argcis-risk-worker",
    description: "Risk, map and exercise data API for ArgCIS.",
    base_url: baseUrl,
    docs: {
      self: `${baseUrl}/api`,
      health: `${baseUrl}/health`
    },
    auth: {
      bearer_token_header: "Authorization: Bearer <supabase-access-token>",
      allow_anonymous_requests: config.allowAnonRead,
      note: config.allowAnonRead
        ? "Anonymous requests are currently allowed."
        : "Bearer token is required for API requests."
    },
    endpoints
  };
}

function getAllowedMethods(pathname: string): string[] {
  const routes: Record<string, string[]> = {
    "/": ["GET"],
    "/api": ["GET"],
    "/health": ["GET"],
    "/api/map/layers": ["GET"],
    "/api/map/frame": ["GET"],
    "/api/map/hex": ["GET"],
    "/api/risk/coordinate": ["GET"],
    "/api/route/risk": ["POST"],
    "/api/internal/debug/forecast": ["GET"],
    "/api/exercises": ["GET", "POST"],
    "/api/exercise-activities": ["GET", "POST"],
    "/api/saved-maps": ["GET", "POST"],
    "/api/internal/recompute": ["POST"],
    "/api/internal/recompute/table": ["GET"]
  };

  return routes[pathname] ?? [];
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const config = getConfig(env);
    if (!config.useDemoData) {
      requireSupabase(config);
    }

    const repository = new ArgcisRepository(config);
    await repository.recompute(floorToHour(new Date()));
  }
};
