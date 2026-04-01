import { describe, expect, it } from "vitest";
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
});
