import { describe, expect, it } from "vitest";
import { researchInputSchema } from "@/lib/contracts/research";
import { createFuyaoSnapshot, FuyaoProviderError } from "@/lib/server/providers/fuyao";

const dateMs = (date: string) => Date.parse(`${date}T00:00:00+08:00`);

function liveInput(endDate = "2026-10-16") {
  return researchInputSchema.parse({
    question: "所选区间市场状态如何？",
    scope: {
      primaryIndex: "SSE_COMPOSITE",
      period: { kind: "range", startDate: "2026-10-12", endDate },
      comparisonIndexes: ["CSI300", "CSI1000"],
    },
  });
}

function mockProvider() {
  const dates = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"];
  const items = dates.map((date, index) => ({
    date_ms: dateMs(date),
    open_price: 100 + index,
    high_price: 102 + index,
    low_price: 99 + index,
    close_price: 101 + index,
    turnover: 1_000_000 + index * 100_000,
  }));
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(`${url.pathname}${url.search}`);
    let data: unknown;
    if (url.pathname === "/api/a-share/calendar/trading-days") {
      data = { timestamp: dateMs("2026-10-16"), item: dates.map((date) => ({ date_ms: dateMs(date), date: date.replaceAll("-", "") })) };
    } else if (url.pathname === "/api/a-share-index/prices/historical") {
      data = { timestamp: dateMs("2026-10-16"), item: items };
    } else if (url.pathname === "/api/a-share/prices/snapshot") {
      data = {
        timestamp: dateMs("2026-10-16"),
        total: 2,
        item: [
          { thscode: "600000.SH", last_price: 11, prev_price: 10 },
          { thscode: "000001.SZ", last_price: 9, prev_price: 10 },
        ],
      };
    } else {
      return Response.json({ code: 404, message: "unknown" });
    }
    return Response.json({ code: 0, message: "success", request_id: "req-test", data });
  };
  return { fetcher, calls };
}

describe("Fuyao REST adapter", () => {
  it("maps documented index bars and computes breadth only from a matching full-market snapshot", async () => {
    const mock = mockProvider();
    const events: string[] = [];
    const snapshot = await createFuyaoSnapshot(liveInput(), { FUYAO_API_KEY: "test-key" }, (type) => events.push(type), {
      fetcher: mock.fetcher,
      now: new Date("2026-10-16T10:00:00.000Z"),
    });

    expect(snapshot.synthetic).toBe(false);
    expect(snapshot.priceSeries).toHaveLength(5);
    expect(snapshot.priceSeries.at(-1)?.close).toBe(105);
    expect(snapshot.metrics.breadthLatest).toBe(0.5);
    expect(snapshot.dimensionStatuses.breadth.status).toBe("available");
    expect(snapshot.dimensionStatuses.valuation.status).toBe("unavailable");
    expect(snapshot.switchConditions[0].evaluation).toBe("not_met");
    expect(snapshot.sourceLabel).toContain("扶摇");
    expect(mock.calls.filter((call) => call.includes("prices/historical"))).toHaveLength(3);
    expect(events.filter((event) => event === "tool_started").length).toBeGreaterThanOrEqual(5);
  });

  it("does not use the latest snapshot to fill an older historical breadth date", async () => {
    const mock = mockProvider();
    const snapshot = await createFuyaoSnapshot(liveInput("2026-10-15"), { FUYAO_API_KEY: "test-key" }, () => undefined, {
      fetcher: mock.fetcher,
      now: new Date("2026-10-16T10:00:00.000Z"),
    });

    expect(snapshot.dimensionStatuses.breadth.status).toBe("unavailable");
    expect(snapshot.metrics.breadthLatest).toBeNull();
    expect(mock.calls.some((call) => call.includes("prices/snapshot"))).toBe(false);
  });

  it("executes only the safe dimensions selected by a validated research plan", async () => {
    const mock = mockProvider();
    const snapshot = await createFuyaoSnapshot(liveInput(), { FUYAO_API_KEY: "test-key" }, () => undefined, {
      fetcher: mock.fetcher,
      now: new Date("2026-10-16T10:00:00.000Z"),
      dimensions: ["price"],
    });

    expect(mock.calls.filter((call) => call.includes("prices/historical"))).toHaveLength(1);
    expect(mock.calls.some((call) => call.includes("prices/snapshot"))).toBe(false);
    expect(snapshot.dimensionStatuses.breadth.explanation).toContain("未请求");
    expect(snapshot.dimensionStatuses.style.explanation).toContain("未请求");
  });

  it("requires a server-side API key and rejects non-HTTPS provider URLs", async () => {
    await expect(createFuyaoSnapshot(liveInput(), {}, () => undefined)).rejects.toMatchObject({ code: "CONFIG_MISSING" });
    await expect(createFuyaoSnapshot(liveInput(), { FUYAO_API_KEY: "test-key", FUYAO_BASE_URL: "http://localhost" }, () => undefined))
      .rejects.toMatchObject({ code: "CONFIG_INVALID" });
  });

  it("surfaces business errors instead of returning synthetic data", async () => {
    const fetcher: typeof fetch = async () => Response.json({ code: 2003, message: "permission denied", data: null });
    await expect(createFuyaoSnapshot(liveInput(), { FUYAO_API_KEY: "test-key" }, () => undefined, { fetcher }))
      .rejects.toBeInstanceOf(FuyaoProviderError);
  });
});
