import {
  demoFrame,
  demoHex,
  demoLayerCatalog
} from "@argcis/shared";
import type {
  ExerciseActivity,
  ExerciseScenario,
  LayerCatalogResponse,
  MapFrameResponse,
  MapHexResponse,
  SavedMap
} from "@argcis/shared";

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  token?: string | null;
}

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787";
const demoMode = import.meta.env.VITE_DEMO_MODE === "true";

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (demoMode) {
    return demoResponse<T>(path, options);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

function demoResponse<T>(path: string, options: RequestOptions): T {
  void options;
  const url = new URL(path, "https://argcis.local");
  if (url.pathname === "/api/map/layers") {
    return demoLayerCatalog() as T;
  }
  if (url.pathname === "/api/map/frame") {
    return demoFrame(url.searchParams.get("time") ?? "2026-03-07T00:00:00.000Z") as T;
  }
  if (url.pathname === "/api/map/hex") {
    return demoHex(url.searchParams.get("time") ?? "2026-03-07T00:00:00.000Z") as T;
  }
  if (url.pathname === "/api/exercises") {
    return [
      {
        id: "scn-1",
        name: "Demo scenarijus",
        description: "Vidinis mokomasis scenarijus.",
        starts_at: "2026-03-07T06:00:00.000Z",
        ends_at: "2026-03-07T18:00:00.000Z",
        owner_id: null
      }
    ] as T;
  }
  if (url.pathname === "/api/exercise-activities") {
    return demoFrame(url.searchParams.get("time") ?? "2026-03-07T00:00:00.000Z")
      .activities as T;
  }
  if (url.pathname === "/api/saved-maps") {
    if (options.method === "POST") {
      const payload = options.body as {
        name: string;
        description?: string | null;
        active_time_utc?: string | null;
        layers: SavedMap["layers"];
      };

      return {
        id: `saved-${crypto.randomUUID()}`,
        owner_id: null,
        name: payload.name,
        description: payload.description ?? null,
        active_time_utc: payload.active_time_utc ?? null,
        layers: payload.layers.map((layer, index) => ({
          id: `saved-layer-${index}`,
          layer_id: layer.layer_id,
          ordering: layer.ordering,
          visible: layer.visible,
          opacity: layer.opacity,
          filters: layer.filters ?? {},
          active_time_utc: layer.active_time_utc ?? null
        }))
      } as T;
    }

    return [
      {
        id: "saved-1",
        owner_id: null,
        name: "Demo preset",
        description: "Meteo ir risk sluoksniai",
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
          },
          {
            id: "saved-layer-2",
            layer_id: "risk-hex",
            ordering: 2,
            visible: true,
            opacity: 0.65,
            filters: {},
            active_time_utc: null
          }
        ]
      }
    ] as T;
  }

  throw new Error(`No demo response defined for ${path}`);
}

export const api = {
  getLayerCatalog(token?: string | null) {
    return request<LayerCatalogResponse>("/api/map/layers", { token });
  },

  getFrame(time: string, layers: string[], token?: string | null) {
    const params = new URLSearchParams({
      time,
      layers: layers.join(",")
    });
    return request<MapFrameResponse>(`/api/map/frame?${params.toString()}`, { token });
  },

  getHex(time: string, bbox: string | null, token?: string | null) {
    const params = new URLSearchParams({ time });
    if (bbox) {
      params.set("bbox", bbox);
    }
    return request<MapHexResponse>(`/api/map/hex?${params.toString()}`, { token });
  },

  getExercises(token?: string | null) {
    return request<ExerciseScenario[]>("/api/exercises", { token });
  },

  getActivities(time: string, token?: string | null) {
    const params = new URLSearchParams({ time });
    return request<ExerciseActivity[]>(`/api/exercise-activities?${params.toString()}`, {
      token
    });
  },

  getSavedMaps(token?: string | null) {
    return request<SavedMap[]>("/api/saved-maps", { token });
  },

  saveMap(payload: {
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
  }, token?: string | null) {
    return request<SavedMap>("/api/saved-maps", {
      method: "POST",
      token,
      body: payload
    });
  }
};
