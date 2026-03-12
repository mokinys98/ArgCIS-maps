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

export function buildForecastTimeline(startIso: string): string[] {
  const start = new Date(floorToForecastSegment(startIso));
  return Array.from({ length: FORECAST_SEGMENT_COUNT }, (_, index) =>
    new Date(start.getTime() + index * SEGMENT_MS).toISOString()
  );
}
