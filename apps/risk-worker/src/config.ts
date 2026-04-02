import { floorToForecastHour } from "@argcis/shared";

export interface Env {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_ANON_KEY?: string;
  APP_ORIGIN?: string;
  ALLOW_ANON_READ?: string;
  USE_DEMO_DATA?: string;
  H3_RESOLUTION?: string;
  METEO_SOURCE_VIEW?: string;
  ROAD_SOURCE_VIEW?: string;
  MAPBOX_ACCESS_TOKEN?: string;
}

export interface AppConfig {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  supabaseAnonKey: string;
  appOrigin: string;
  allowAnonRead: boolean;
  useDemoData: boolean;
  h3Resolution: number;
  meteoSourceView: string;
  roadSourceView: string;
  mapboxAccessToken: string;
}

export function getConfig(env: Env): AppConfig {
  return {
    supabaseUrl: env.SUPABASE_URL ?? "",
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    supabaseAnonKey: env.SUPABASE_ANON_KEY ?? "",
    appOrigin: env.APP_ORIGIN ?? "*",
    allowAnonRead: toBool(env.ALLOW_ANON_READ, false),
    useDemoData: toBool(env.USE_DEMO_DATA, false),
    h3Resolution: Number.parseInt(env.H3_RESOLUTION ?? "6", 10),
    meteoSourceView: env.METEO_SOURCE_VIEW ?? "argcis_ingest_meteo_feed",
    roadSourceView: env.ROAD_SOURCE_VIEW ?? "argcis_ingest_road_feed",
    mapboxAccessToken: env.MAPBOX_ACCESS_TOKEN ?? ""
  };
}

export function toBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  return value.toLowerCase() === "true";
}

export function requireSupabase(config: AppConfig): void {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  if (
    config.supabaseServiceRoleKey.startsWith("sb_publishable_") ||
    config.supabaseServiceRoleKey.startsWith("eyJ")
  ) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY must be the server-side service_role secret, not the publishable or anon key."
    );
  }
}

export function floorToHour(date: Date): string {
  return floorToForecastHour(date);
}
