import { describe, expect, it } from "vitest";
import { ArgcisRepository } from "../src/repository";
import type { AppConfig } from "../src/config";

interface QueryResult<T> {
  data: T;
  error: null;
}

class FakeSupabaseQuery {
  private filters: Record<string, unknown> = {};
  private rangeStart = 0;
  private rangeEnd = Number.MAX_SAFE_INTEGER;

  constructor(
    private readonly table: string,
    private readonly handlers: {
      onRunsPage(start: number, end: number): void;
      onPointsBatch(batch: string[]): void;
      onPlacesBatch(batch: string[]): void;
    }
  ) {}

  select(): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters[column] = value;
    return this;
  }

  lte(column: string, value: unknown): this {
    this.filters[column] = value;
    return this;
  }

  gte(column: string, value: unknown): this {
    this.filters[column] = value;
    return this;
  }

  order(): this {
    return this;
  }

  range(start: number, end: number): this {
    this.rangeStart = start;
    this.rangeEnd = end;
    return this;
  }

  then<TResult1 = QueryResult<unknown[]>, TResult2 = never>(
    onfulfilled?:
      | ((value: QueryResult<unknown[]>) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private execute(): Promise<QueryResult<unknown[]>> {
    if (this.table === "meteo_forecast_runs") {
      this.handlers.onRunsPage(this.rangeStart, this.rangeEnd);
      const runs = Array.from({ length: 1205 }, (_, index) => ({
        id: `run-${index}`,
        place_code: `place-${index}`,
        forecast_creation_time_utc: "2026-03-29T00:00:00.000Z"
      }));

      return Promise.resolve({
        data: runs.slice(this.rangeStart, this.rangeEnd + 1),
        error: null
      });
    }

    if (this.table === "meteo_forecast_points") {
      const batch = (this.filters.run_id as string[]) ?? [];
      this.handlers.onPointsBatch(batch);

      return Promise.resolve({
        data: batch.map((runId, index) => ({
          run_id: runId,
          forecast_time_utc: "2026-03-30T00:00:00.000Z",
          air_temp: index,
          wind_speed: 3,
          wind_gust: 5,
          total_precipitation: 0,
          condition_code: "cloudy"
        })),
        error: null
      });
    }

    return Promise.resolve({
      data: [],
      error: null
    });
  }

  in(column: string, values: string[]): Promise<QueryResult<unknown[]>> | this {
    this.filters[column] = values;

    if (this.table === "meteo_places") {
      this.handlers.onPlacesBatch(values);

      return Promise.resolve({
        data: values.map((code, index) => ({
          code,
          name: `Place ${index}`,
          lat: 54.6 + index * 0.001,
          lon: 25.2 + index * 0.001
        })),
        error: null
      });
    }

    return this;
  }
}

class FakeSupabaseClient {
  constructor(
    private readonly handlers: {
      onRunsPage(start: number, end: number): void;
      onPointsBatch(batch: string[]): void;
      onPlacesBatch(batch: string[]): void;
    }
  ) {}

  from(table: string): FakeSupabaseQuery {
    return new FakeSupabaseQuery(table, this.handlers);
  }
}

function createConfig(): AppConfig {
  return {
    supabaseUrl: "https://example.supabase.co",
    supabaseServiceRoleKey: "service-role-key",
    supabaseAnonKey: "anon-key",
    appOrigin: "*",
    allowAnonRead: true,
    useDemoData: false,
    h3Resolution: 6,
    meteoSourceView: "argcis_ingest_meteo_feed",
    roadSourceView: "argcis_ingest_road_feed",
    mapboxAccessToken: ""
  };
}

describe("repository meteo batching", () => {
  it("paginates meteo runs and chunks downstream point/place queries", async () => {
    const runPages: Array<[number, number]> = [];
    const pointBatchSizes: number[] = [];
    const placeBatchSizes: number[] = [];
    const repository = new ArgcisRepository(createConfig());

    Object.defineProperty(repository, "client", {
      value: new FakeSupabaseClient({
        onRunsPage: (start, end) => {
          runPages.push([start, end]);
        },
        onPointsBatch: (batch) => {
          pointBatchSizes.push(batch.length);
        },
        onPlacesBatch: (batch) => {
          placeBatchSizes.push(batch.length);
        }
      })
    });

    const signals = await (repository as any).fetchHistoricalMeteoSignals(
      "2026-03-30T00:00:00.000Z",
      "2026-03-30T00:00:00.000Z",
      "2026-04-05T21:00:00.000Z"
    );

    expect(signals).toHaveLength(1205);
    expect(runPages).toEqual([
      [0, 999],
      [1000, 1999]
    ]);
    expect(pointBatchSizes.length).toBeGreaterThan(1);
    expect(placeBatchSizes.length).toBeGreaterThan(1);
    expect(Math.max(...pointBatchSizes)).toBeLessThanOrEqual(200);
    expect(Math.max(...placeBatchSizes)).toBeLessThanOrEqual(200);
  });
});

describe("repository meteo run selection", () => {
  it("does not limit historical run lookup to long-term forecast type", async () => {
    const repository = new ArgcisRepository(createConfig());
    const seenRunFilters: Record<string, unknown>[] = [];

    class MixedRunQuery {
      private filters: Record<string, unknown> = {};

      constructor(private readonly table: string) {}

      select(): this {
        return this;
      }

      eq(column: string, value: unknown): this {
        this.filters[column] = value;
        return this;
      }

      lte(column: string, value: unknown): this {
        this.filters[column] = value;
        return this;
      }

      gte(column: string, value: unknown): this {
        this.filters[column] = value;
        return this;
      }

      order(): this {
        return this;
      }

      range(): this {
        return this;
      }

      then<TResult1 = QueryResult<unknown[]>, TResult2 = never>(
        onfulfilled?:
          | ((value: QueryResult<unknown[]>) => TResult1 | PromiseLike<TResult1>)
          | null,
        onrejected?:
          | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
          | null
      ): Promise<TResult1 | TResult2> {
        return this.execute().then(onfulfilled, onrejected);
      }

      private execute(): Promise<QueryResult<unknown[]>> {
        if (this.table === "meteo_forecast_runs") {
          seenRunFilters.push({ ...this.filters });
          return Promise.resolve({
            data: [
              {
                id: "run-long",
                place_code: "vilnius",
                forecast_creation_time_utc: "2026-03-29T05:00:00.000Z"
              },
              {
                id: "run-short",
                place_code: "vilnius",
                forecast_creation_time_utc: "2026-03-29T06:00:00.000Z"
              }
            ],
            error: null
          });
        }

        if (this.table === "meteo_forecast_points") {
          const batch = (this.filters.run_id as string[]) ?? [];
          return Promise.resolve({
            data: batch.map((runId) => ({
              run_id: runId,
              forecast_time_utc: "2026-03-29T06:00:00.000Z",
              air_temp: runId === "run-short" ? 8 : 2,
              wind_speed: 3,
              wind_gust: 5,
              total_precipitation: 0,
              condition_code: "cloudy"
            })),
            error: null
          });
        }

        return Promise.resolve({
          data: [],
          error: null
        });
      }

      in(column: string, values: string[]): Promise<QueryResult<unknown[]>> | this {
        this.filters[column] = values;

        if (this.table === "meteo_places") {
          return Promise.resolve({
            data: [
              {
                code: "vilnius",
                name: "Vilnius",
                lat: 54.6872,
                lon: 25.2797
              }
            ],
            error: null
          });
        }

        return this;
      }
    }

    class MixedRunClient {
      from(table: string): MixedRunQuery {
        return new MixedRunQuery(table);
      }
    }

    Object.defineProperty(repository, "client", {
      value: new MixedRunClient()
    });

    const signals = await (repository as any).fetchHistoricalMeteoSignals(
      "2026-03-29T06:30:00.000Z",
      "2026-03-29T06:00:00.000Z",
      "2026-03-29T07:00:00.000Z"
    );

    expect(seenRunFilters).toEqual([
      {
        forecast_creation_time_utc: "2026-03-29T06:30:00.000Z"
      }
    ]);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.id).toBe("vilnius:2026-03-29T06:00:00.000Z");
    expect(signals[0]?.metrics.air_temperature_c).toBe(8);
  });
});
