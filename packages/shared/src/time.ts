export const FORECAST_HORIZON_DAYS = 7;
export const FORECAST_SEGMENT_HOURS = 3;
export const FORECAST_SEGMENT_COUNT =
  (FORECAST_HORIZON_DAYS * 24) / FORECAST_SEGMENT_HOURS;

const SEGMENT_MS = FORECAST_SEGMENT_HOURS * 60 * 60 * 1000;

export function floorToForecastSegment(input: Date | string): string {
  const date = typeof input === "string" ? new Date(input) : new Date(input);
  const time = date.getTime();
  return new Date(Math.floor(time / SEGMENT_MS) * SEGMENT_MS).toISOString();
}

export function roundToNearestForecastSegment(input: Date | string): string {
  const date = typeof input === "string" ? new Date(input) : new Date(input);
  const time = date.getTime();
  return new Date(Math.round(time / SEGMENT_MS) * SEGMENT_MS).toISOString();
}

export function shiftForecastHours(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * 60 * 60 * 1000).toISOString();
}

export function buildForecastTimeline(startIso: string): string[] {
  const start = new Date(floorToForecastSegment(startIso));
  return Array.from({ length: FORECAST_SEGMENT_COUNT }, (_, index) =>
    new Date(start.getTime() + index * SEGMENT_MS).toISOString()
  );
}
