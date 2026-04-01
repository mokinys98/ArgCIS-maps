export interface MeteoForecastRunSelection {
  id: string;
  place_code: string;
  forecast_creation_time_utc: string;
}

export function selectLatestHistoricalMeteoRuns(
  runs: MeteoForecastRunSelection[],
  anchorIso: string
): MeteoForecastRunSelection[] {
  const anchorTime = new Date(anchorIso).getTime();
  const selected = new Map<string, MeteoForecastRunSelection>();
  const sortedRuns = [...runs].sort(
    (left, right) =>
      new Date(right.forecast_creation_time_utc).getTime() -
      new Date(left.forecast_creation_time_utc).getTime()
  );

  for (const run of sortedRuns) {
    if (new Date(run.forecast_creation_time_utc).getTime() > anchorTime) {
      continue;
    }

    if (!selected.has(run.place_code)) {
      selected.set(run.place_code, run);
    }
  }

  return Array.from(selected.values()).sort((left, right) =>
    left.place_code.localeCompare(right.place_code)
  );
}
