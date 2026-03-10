import { roundToNearestForecastSegment } from "@argcis/shared";
import { floorToHour, getConfig, requireSupabase, type Env } from "./config";
import { authenticateRequest } from "./auth";
import {
  emptyResponse,
  jsonResponse,
  parseBbox,
  parseLayerIds,
  readJson
} from "./http";
import { ArgcisRepository } from "./repository";

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const config = getConfig(env);
  const requestOrigin = request.headers.get("origin");

  if (request.method === "OPTIONS") {
    return emptyResponse(config, 204, requestOrigin);
  }

  if (!config.useDemoData) {
    requireSupabase(config);
  }

  const url = new URL(request.url);
  const repository = new ArgcisRepository(config);

  try {
    if (url.pathname === "/health") {
      return jsonResponse(config, {
        ok: true,
        service: "argcis-risk-worker",
        demo_mode: config.useDemoData,
        h3_resolution: config.h3Resolution
      }, 200, requestOrigin);
    }

    const requireAuth = !config.allowAnonRead;
    const user = await authenticateRequest(request, config, requireAuth);

    if (request.method === "GET" && url.pathname === "/api/map/layers") {
      return jsonResponse(config, await repository.getLayerCatalog(), 200, requestOrigin);
    }

    if (request.method === "GET" && url.pathname === "/api/map/frame") {
      const time = url.searchParams.get("time")
        ? roundToNearestForecastSegment(url.searchParams.get("time")!)
        : floorToHour(new Date());
      const layers = parseLayerIds(url.searchParams.get("layers"));
      return jsonResponse(config, await repository.getFrame(time, layers), 200, requestOrigin);
    }

    if (request.method === "GET" && url.pathname === "/api/map/hex") {
      const time = url.searchParams.get("time")
        ? roundToNearestForecastSegment(url.searchParams.get("time")!)
        : floorToHour(new Date());
      const bbox = parseBbox(url.searchParams.get("bbox"));
      return jsonResponse(config, await repository.getHex(time, bbox), 200, requestOrigin);
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
      const time = url.searchParams.get("time")
        ? roundToNearestForecastSegment(url.searchParams.get("time")!)
        : floorToHour(new Date());
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
      const recomputeTime = url.searchParams.get("time")
        ? roundToNearestForecastSegment(url.searchParams.get("time")!)
        : floorToHour(new Date());
      return jsonResponse(
        config,
        await repository.recompute(recomputeTime),
        200,
        requestOrigin
      );
    }

    return jsonResponse(config, { error: "Not found." }, 404, requestOrigin);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error !== null
          ? JSON.stringify(error)
          : "Unexpected error.";

    return jsonResponse(
      config,
      {
        error: message
      },
      500,
      requestOrigin
    );
  }
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
