import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";

function createEnv() {
  return {
    APP_ORIGIN: "*",
    ALLOW_ANON_READ: "true",
    USE_DEMO_DATA: "true",
    H3_RESOLUTION: "6"
  };
}

describe("risk worker api index", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns API documentation on root path", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/"),
      createEnv()
    );

    expect(response.status).toBe(200);

    const body = await response.json() as {
      service: string;
      endpoints: Array<{ path: string; method: string }>;
    };

    expect(body.service).toBe("argcis-risk-worker");
    expect(body.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/health", method: "GET" }),
        expect.objectContaining({ path: "/api/exercises", method: "POST" })
      ])
    );
    const methods = body.endpoints.map((endpoint) => endpoint.method);
    const firstPostIndex = methods.indexOf("POST");

    expect(firstPostIndex).toBeGreaterThan(0);
    expect(methods.slice(0, firstPostIndex).every((method) => method === "GET")).toBe(true);
    expect(methods.slice(firstPostIndex).every((method) => method === "POST")).toBe(true);
  });

  it("returns docs link on health endpoint", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/health"),
      createEnv()
    );

    expect(response.status).toBe(200);

    const body = await response.json() as {
      ok: boolean;
      docs_url: string;
    };

    expect(body.ok).toBe(true);
    expect(body.docs_url).toBe("https://example.com/api");
  });

  it("returns allowed methods for known path with wrong method", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/api/map/layers", { method: "POST" }),
      createEnv()
    );

    expect(response.status).toBe(405);

    const body = await response.json() as {
      allowed_methods: string[];
    };

    expect(body.allowed_methods).toEqual(["GET"]);
  });

  it("defaults time query params to the current time when omitted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T10:15:30.000Z"));

    const frameResponse = await worker.fetch(
      new Request("https://example.com/api/map/frame"),
      createEnv()
    );
    const activitiesResponse = await worker.fetch(
      new Request("https://example.com/api/exercise-activities"),
      createEnv()
    );

    expect(frameResponse.status).toBe(200);
    expect(activitiesResponse.status).toBe(200);

    const frameBody = await frameResponse.json() as { time: string };
    const activitiesBody = await activitiesResponse.json() as Array<{ starts_at: string }>;

    expect(frameBody.time).toBe("2026-04-02T10:15:30.000Z");
    expect(activitiesBody[0]?.starts_at).toBe("2026-04-02T10:15:30.000Z");
  });

  it("defaults missing coordinate query params to Vilnius values", async () => {
    const defaultResponse = await worker.fetch(
      new Request("https://example.com/api/risk/coordinate"),
      createEnv()
    );
    const partialResponse = await worker.fetch(
      new Request("https://example.com/api/risk/coordinate?lat=54.9"),
      createEnv()
    );

    expect(defaultResponse.status).toBe(200);
    expect(partialResponse.status).toBe(200);

    const defaultBody = await defaultResponse.json() as {
      latitude: number;
      longitude: number;
    };
    const partialBody = await partialResponse.json() as {
      latitude: number;
      longitude: number;
    };

    expect(defaultBody).toMatchObject({
      latitude: 54.6872,
      longitude: 25.2797
    });
    expect(partialBody).toMatchObject({
      latitude: 54.9,
      longitude: 25.2797
    });
  });

  it("returns route risk response for two addresses", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/api/route/risk", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          from_address: "Vilnius, Lithuania",
          to_address: "Kaunas, Lithuania",
          time: "2026-04-02T10:00:00.000Z"
        })
      }),
      createEnv()
    );

    expect(response.status).toBe(200);

    const body = await response.json() as {
      route: { geometry: { type: string; coordinates: unknown[] } };
      segments: unknown[];
      summary: { risk_level: string };
    };

    expect(body.route.geometry.type).toBe("LineString");
    expect(body.route.geometry.coordinates.length).toBeGreaterThan(1);
    expect(body.segments.length).toBeGreaterThan(0);
    expect(["green", "yellow", "red"]).toContain(body.summary.risk_level);
  });

  it("returns 404 when origin address is not found", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/api/route/risk", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          from_address: "missing-origin",
          to_address: "Kaunas, Lithuania",
          time: "2026-04-02T10:00:00.000Z"
        })
      }),
      createEnv()
    );

    expect(response.status).toBe(404);
  });

  it("returns 404 when destination address is not found", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/api/route/risk", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          from_address: "Vilnius, Lithuania",
          to_address: "missing-destination",
          time: "2026-04-02T10:00:00.000Z"
        })
      }),
      createEnv()
    );

    expect(response.status).toBe(404);
  });

  it("returns 404 when route cannot be built", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/api/route/risk", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          from_address: "no-route",
          to_address: "Kaunas, Lithuania",
          time: "2026-04-02T10:00:00.000Z"
        })
      }),
      createEnv()
    );

    expect(response.status).toBe(404);
  });
});
