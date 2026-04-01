import { describe, expect, it } from "vitest";
import { selectLatestHistoricalMeteoRuns } from "../src/meteo-history";

describe("meteo history selection", () => {
  it("selects the latest run at or before the anchor for each place", () => {
    const selected = selectLatestHistoricalMeteoRuns(
      [
        {
          id: "run-a-old",
          place_code: "abromiskes",
          forecast_creation_time_utc: "2026-03-18T11:09:37.000Z"
        },
        {
          id: "run-a-new",
          place_code: "abromiskes",
          forecast_creation_time_utc: "2026-03-21T23:01:27.000Z"
        },
        {
          id: "run-a-future",
          place_code: "abromiskes",
          forecast_creation_time_utc: "2026-03-25T11:01:31.000Z"
        },
        {
          id: "run-b-old",
          place_code: "birzai",
          forecast_creation_time_utc: "2026-03-18T10:00:00.000Z"
        },
        {
          id: "run-b-new",
          place_code: "birzai",
          forecast_creation_time_utc: "2026-03-20T10:00:00.000Z"
        }
      ],
      "2026-03-22T00:00:00.000Z"
    );

    expect(selected).toEqual([
      {
        id: "run-a-new",
        place_code: "abromiskes",
        forecast_creation_time_utc: "2026-03-21T23:01:27.000Z"
      },
      {
        id: "run-b-new",
        place_code: "birzai",
        forecast_creation_time_utc: "2026-03-20T10:00:00.000Z"
      }
    ]);
  });
});
