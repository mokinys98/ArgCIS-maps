export const FORECAST_HORIZON_DAYS = 1;
export const FORECAST_HORIZON_HOURS = FORECAST_HORIZON_DAYS * 24;
export const FORECAST_SHORT_TERM_HOURS = 24;
export const FORECAST_SHORT_TERM_SEGMENT_HOURS = 1;
export const FORECAST_LONG_TERM_SEGMENT_HOURS = FORECAST_SHORT_TERM_SEGMENT_HOURS;
export const FORECAST_LONG_TERM_START_HOURS = FORECAST_SHORT_TERM_HOURS;
export const FORECAST_LAST_TIMELINE_OFFSET_HOURS = FORECAST_HORIZON_HOURS;
export const FORECAST_SEGMENT_HOURS = FORECAST_SHORT_TERM_SEGMENT_HOURS;
export const FORECAST_SEGMENT_COUNT =
  FORECAST_HORIZON_HOURS / FORECAST_SEGMENT_HOURS + 1;

const HOUR_MS = 60 * 60 * 1000;
const SHORT_TERM_SEGMENT_MS = FORECAST_SHORT_TERM_SEGMENT_HOURS * HOUR_MS;

export function floorToForecastHour(input: Date | string): string {
  const date = typeof input === "string" ? new Date(input) : new Date(input);
  const time = date.getTime();
  return new Date(Math.floor(time / HOUR_MS) * HOUR_MS).toISOString();
}

export function floorToForecastSegment(input: Date | string): string {
  return floorToForecastHour(input);
}

export function roundToNearestForecastHour(input: Date | string): string {
  const date = typeof input === "string" ? new Date(input) : new Date(input);
  const time = date.getTime();
  return new Date(Math.round(time / HOUR_MS) * HOUR_MS).toISOString();
}

export function roundToNearestForecastSegment(input: Date | string): string {
  return roundToNearestForecastHour(input);
}

export function shiftForecastHours(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * HOUR_MS).toISOString();
}

export function findClosestForecastTime(
  availableTimes: string[],
  input: Date | string
): string | null {
  if (availableTimes.length === 0) {
    return null;
  }

  const date = typeof input === "string" ? new Date(input) : new Date(input);
  const targetTime = date.getTime();

  let closest = availableTimes[0]!;
  let closestTime = new Date(closest).getTime();
  let closestDiff = Math.abs(closestTime - targetTime);

  for (const candidate of availableTimes.slice(1)) {
    const candidateTime = new Date(candidate).getTime();
    const candidateDiff = Math.abs(candidateTime - targetTime);

    if (candidateDiff < closestDiff) {
      closest = candidate;
      closestTime = candidateTime;
      closestDiff = candidateDiff;
      continue;
    }

    if (candidateDiff === closestDiff && candidateTime < closestTime) {
      closest = candidate;
      closestTime = candidateTime;
    }
  }

  return closest;
}

export function forecastOffsetHours(anchorIso: string, input: Date | string): number {
  const anchorTime = new Date(anchorIso).getTime();
  const date = typeof input === "string" ? new Date(input) : new Date(input);
  return (date.getTime() - anchorTime) / HOUR_MS;
}

export function isShortTermForecastTime(
  anchorIso: string,
  input: Date | string
): boolean {
  const offsetHours = forecastOffsetHours(anchorIso, input);
  return Number.isInteger(offsetHours) &&
    offsetHours >= 0 &&
    offsetHours <= FORECAST_SHORT_TERM_HOURS;
}

export function isLongTermForecastTime(
  anchorIso: string,
  input: Date | string
): boolean {
  return false;
}

export function buildShortTermForecastTimeline(startIso: string): string[] {
  const start = new Date(floorToForecastHour(startIso));
  return Array.from(
    { length: FORECAST_SHORT_TERM_HOURS / FORECAST_SHORT_TERM_SEGMENT_HOURS + 1 },
    (_, index) =>
      new Date(start.getTime() + index * SHORT_TERM_SEGMENT_MS).toISOString()
  );
}

export function buildForecastTimeline(startIso: string): string[] {
  return buildShortTermForecastTimeline(startIso);
}
