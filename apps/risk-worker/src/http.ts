import type { AppConfig } from "./config";

export function jsonResponse(
  config: AppConfig,
  body: unknown,
  status = 200,
  requestOrigin?: string | null
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(config, requestOrigin)
  });
}

export function emptyResponse(
  config: AppConfig,
  status = 204,
  requestOrigin?: string | null
): Response {
  return new Response(null, {
    status,
    headers: corsHeaders(config, requestOrigin)
  });
}

export function corsHeaders(
  config: AppConfig,
  requestOrigin?: string | null
): HeadersInit {
  const allowOrigin = resolveAllowedOrigin(config.appOrigin, requestOrigin);

  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type",
    vary: "Origin",
    "content-type": "application/json; charset=utf-8"
  };
}

export async function readJson<T>(request: Request): Promise<T> {
  return (await request.json()) as T;
}

export function parseLayerIds(input: string | null): string[] {
  if (!input) {
    return [];
  }

  return input
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseBbox(input: string | null) {
  if (!input) {
    return null;
  }

  const values = input.split(",").map((part) => Number(part.trim()));
  if (values.length !== 4 || values.some((value) => Number.isNaN(value))) {
    return null;
  }

  return {
    west: values[0],
    south: values[1],
    east: values[2],
    north: values[3]
  };
}

function resolveAllowedOrigin(
  configuredOrigin: string,
  requestOrigin?: string | null
): string {
  if (configuredOrigin.trim() === "*") {
    return "*";
  }

  const allowedOrigins = configuredOrigin
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }

  return allowedOrigins[0] ?? "*";
}
