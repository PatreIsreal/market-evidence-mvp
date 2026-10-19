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

function mockProvider(snapshotReadyAt: number | null = Date.parse("2026-10-16T16:30:00+08:00")) {
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
        timestamp: snapshotReadyAt,
        total: 2,
        item: [
          { thscode: "600000.SH", last_price: 11, prev_price: 10 },
          { thscode: "000001.SZ", last_price: 9, prev_price: 10 },
        ],
      };
    } else if (url.pathname === "/api/a-share/special-data/limit-up-statistics") {
      data = {
        timestamp: Date.parse("2026-10-16T16:40:00+08:00"),
        trade_date: "2026-10-16",
        seal_rate: 0.65,
        open_stock_count: 7,
        limit_up_stock_count: 13,
        touched_limit_up_stock_count: 20,
        exact_boards: [
          { board_num: 2, stock_count: 4 },
          { board_num: 3, stock_count: 1 },
        ],
      };
    } else if (url.pathname === "/api/news/flash/list") {
      data = {
        items: [
          { id: "1000", seq: "9007199254740993", title: "A股重要政策快讯", encoded_url: "https://example.com/news/1000", summary: "相关部门发布政策信息。", tags: [{ id: 21103, name: "A股" }], type: 1, create_time_ms: Date.parse("2026-10-16T09:00:00.000Z") },
          { id: "1001", seq: "9007199254740994", title: "A股重要政策快讯", encoded_url: "https://example.com/news/1001", summary: "同标题较新版本。", tags: [{ id: 21103, name: "A股" }], type: 1, create_time_ms: Date.parse("2026-10-16T09:30:00.000Z") },
          { id: "1002", seq: "2", title: "港股资讯", encoded_url: "https://example.com/news/1002", summary: "不应纳入。", tags: [{ id: 3, name: "港股" }], type: 1, create_time_ms: Date.parse("2026-10-16T09:40:00.000Z") },
          { id: "1003", seq: "3", title: "旧 A 股资讯", encoded_url: "https://example.com/news/1003", summary: "超过 72 小时。", tags: [{ id: 21103, name: "A股" }], type: 1, create_time_ms: Date.parse("2026-10-12T09:00:00.000Z") },
          { id: "1004", seq: "4", title: "未来资讯", encoded_url: "https://example.com/news/1004", summary: "未来时间。", tags: [{ id: 21103, name: "A股" }], type: 1, create_time_ms: Date.parse("2026-10-16T10:10:00.000Z") },
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
    const events: Array<{ type: string; data: { callId?: string; status?: string } }> = [];
    const snapshot = await createFuyaoSnapshot(liveInput(), { FUYAO_API_KEY: "test-key" }, (type, data) => events.push({ type, data: data as { callId?: string; status?: string } }), {
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
    expect(events.filter((event) => event.type === "tool_started").length).toBeGreaterThanOrEqual(5);
    expect(events.filter((event) => event.type === "tool_finished" && event.data.callId === "market-snapshot-1").at(-1)?.data.status).toBe("available");
  });

  it("adds dated limit-up sentiment evidence only when the statistics match the research close", async () => {
    const mock = mockProvider();
    const snapshot = await createFuyaoSnapshot(liveInput(), { FUYAO_API_KEY: "test-key" }, () => undefined, {
      fetcher: mock.fetcher,
      now: new Date("2026-10-16T10:00:00.000Z"),
      dimensions: ["price", "sentiment"],
    });

    expect(snapshot.dimensionStatuses.sentiment).toMatchObject({ status: "available", dataAsOf: "2026-10-16" });
    expect(snapshot.evidence.filter((item) => item.dimension === "sentiment").map((item) => [item.label, item.value])).toEqual([
      ["涨停封板家数", 13],
      ["涨停打开家数", 7],
      ["涨停封板率", 65],
      ["最高连板高度", 3],
    ]);
    expect(snapshot.evidence.find((item) => item.label === "涨停封板率")?.sourceRefs[0]?.datasetId).toBe("fuyao.limit_up.statistics");
    expect(mock.calls.some((call) => call.includes("limit-up-statistics?date=2026-10-16"))).toBe(true);
  });

  it("marks sentiment stale when the provider trade date does not match the selected close", async () => {
    const mock = mockProvider();
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("limit-up-statistics")) {
        return Response.json({
          code: 0,
          message: "success",
          data: {
            timestamp: Date.parse("2026-10-16T16:40:00+08:00"),
            trade_date: "2026-10-15",
            seal_rate: 0.65,
            open_stock_count: 7,
            limit_up_stock_count: 13,
            exact_boards: [],
          },
        });
      }
      return mock.fetcher(input, init);
    };
    const snapshot = await createFuyaoSnapshot(liveInput(), { FUYAO_API_KEY: "test-key" }, () => undefined, {
      fetcher,
      now: new Date("2026-10-16T10:00:00.000Z"),
      dimensions: ["price", "sentiment"],
    });

    expect(snapshot.dimensionStatuses.sentiment.status).toBe("stale");
    expect(snapshot.evidence.some((item) => item.dimension === "sentiment")).toBe(false);
  });

  it("adds only fresh, deduplicated A-share news as traceable event candidates", async () => {
    const mock = mockProvider();
    const snapshot = await createFuyaoSnapshot(liveInput(), { FUYAO_API_KEY: "test-key" }, () => undefined, {
      fetcher: mock.fetcher,
      now: new Date("2026-10-16T10:00:00.000Z"),
      dimensions: ["price", "events"],
    });

    expect(snapshot.dimensionStatuses.events).toMatchObject({ status: "available", dataAsOf: "2026-10-16" });
    const candidates = snapshot.evidence.filter((item) => item.dimension === "events");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      label: "A股重要政策快讯",
      value: "同标题较新版本。",
      kind: "source_excerpt",
      sourceRefs: [{ datasetId: "fuyao.news.flash", recordKeys: ["1001"], sourceUrl: "https://example.com/news/1001" }],
    });
    expect(candidates[0]?.issues.join(" ")).toContain("候选摘要");
    expect(mock.calls.some((call) => call.includes("/api/news/flash/list?tag_id=21103&seq=0"))).toBe(true);
  });

  it("does not backfill current news into a historical event study", async () => {
    const mock = mockProvider();
    const snapshot = await createFuyaoSnapshot(liveInput("2026-10-15"), { FUYAO_API_KEY: "test-key" }, () => undefined, {
      fetcher: mock.fetcher,
      now: new Date("2026-10-16T10:00:00.000Z"),
      dimensions: ["price", "events"],
    });

    expect(snapshot.dimensionStatuses.events.status).toBe("unavailable");
    expect(mock.calls.some((call) => call.includes("/api/news/flash/list"))).toBe(false);
  });

  it("does not use the latest snapshot to fill an older historical breadth date", async () => {
    const mock = mockProvider();
    const events: Array<{ type: string; data: { callId?: string; status?: string } }> = [];
    const snapshot = await createFuyaoSnapshot(liveInput("2026-10-15"), { FUYAO_API_KEY: "test-key" }, (type, data) => events.push({ type, data: data as { callId?: string; status?: string } }), {
      fetcher: mock.fetcher,
      now: new Date("2026-10-16T10:00:00.000Z"),
    });

    expect(snapshot.dimensionStatuses.breadth.status).toBe("unavailable");
    expect(snapshot.metrics.breadthLatest).toBeNull();
    expect(mock.calls.some((call) => call.includes("prices/snapshot"))).toBe(false);
    expect(events.filter((event) => event.type === "tool_finished" && event.data.callId === "market-snapshot-1").at(-1)?.data.status).toBe("unavailable");
  });

  it("assigns a weekend-ready snapshot to the latest completed trading day", async () => {
    const readyAt = Date.parse("2026-10-18T22:30:00+08:00");
    const mock = mockProvider(readyAt);
    const snapshot = await createFuyaoSnapshot(liveInput(), { FUYAO_API_KEY: "test-key" }, () => undefined, {
      fetcher: mock.fetcher,
      now: new Date("2026-10-18T14:35:00.000Z"),
    });

    expect(snapshot.dimensionStatuses.breadth.status).toBe("available");
    expect(snapshot.dimensionStatuses.breadth.dataAsOf).toBe("2026-10-16");
    expect(snapshot.breadthSeries[0]?.tradeDate).toBe("2026-10-16");
    expect(snapshot.breadthSeries[0]?.upCount).toBe(1);
    expect(snapshot.breadthSeries[0]?.downCount).toBe(1);
    expect(snapshot.evidence.find((item) => item.dimension === "breadth")?.scopeDescription).toContain("数据就绪时间");
    expect(snapshot.evidence.find((item) => item.dimension === "breadth")?.scopeDescription).toContain("2026-10-16");
  });

  it("does not mix an intraday snapshot with the previous completed close", async () => {
    const mock = mockProvider(Date.parse("2026-10-16T10:00:00+08:00"));
    const events: Array<{ type: string; data: { callId?: string; status?: string } }> = [];
    const snapshot = await createFuyaoSnapshot(liveInput("2026-10-15"), { FUYAO_API_KEY: "test-key" }, (type, data) => events.push({ type, data: data as { callId?: string; status?: string } }), {
      fetcher: mock.fetcher,
      now: new Date("2026-10-16T02:00:00.000Z"),
    });

    expect(snapshot.dimensionStatuses.breadth.status).toBe("stale");
    expect(snapshot.dimensionStatuses.breadth.explanation).toContain("交易或收盘确认时段");
    expect(snapshot.metrics.breadthLatest).toBeNull();
    expect(mock.calls.some((call) => call.includes("prices/snapshot"))).toBe(false);
    expect(events.filter((event) => event.type === "tool_finished" && event.data.callId === "market-snapshot-1").at(-1)?.data.status).toBe("stale");
  });

  it("rejects a same-day snapshot timestamp before close confirmation", async () => {
    const mock = mockProvider(Date.parse("2026-10-16T15:50:00+08:00"));
    const snapshot = await createFuyaoSnapshot(liveInput(), { FUYAO_API_KEY: "test-key" }, () => undefined, {
      fetcher: mock.fetcher,
      now: new Date("2026-10-16T10:00:00.000Z"),
    });

    expect(snapshot.dimensionStatuses.breadth.status).toBe("stale");
    expect(snapshot.dimensionStatuses.breadth.explanation).toContain("无法确认");
    expect(snapshot.metrics.breadthLatest).toBeNull();
  });

  it("rejects a market snapshot that is missing its data-ready timestamp", async () => {
    const mock = mockProvider(null);
    const snapshot = await createFuyaoSnapshot(liveInput(), { FUYAO_API_KEY: "test-key" }, () => undefined, {
      fetcher: mock.fetcher,
      now: new Date("2026-10-16T10:00:00.000Z"),
    });

    expect(snapshot.dimensionStatuses.breadth.status).toBe("stale");
    expect(snapshot.dimensionStatuses.breadth.explanation).toContain("就绪时间为 未知");
    expect(snapshot.metrics.breadthLatest).toBeNull();
  });

  it("refuses to compute breadth from an incomplete full-market pagination", async () => {
    const mock = mockProvider();
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/a-share/prices/snapshot") {
        return Response.json({
          code: 0,
          message: "success",
          data: {
            timestamp: Date.parse("2026-10-16T16:30:00+08:00"),
            total: 3,
            item: url.searchParams.get("offset") === "0"
              ? [
                { thscode: "600000.SH", last_price: 11, prev_price: 10 },
                { thscode: "000001.SZ", last_price: 9, prev_price: 10 },
              ]
              : [],
          },
        });
      }
      return mock.fetcher(input, init);
    };
    const snapshot = await createFuyaoSnapshot(liveInput(), { FUYAO_API_KEY: "test-key" }, () => undefined, {
      fetcher,
      now: new Date("2026-10-16T10:00:00.000Z"),
    });

    expect(snapshot.dimensionStatuses.breadth.status).toBe("failed");
    expect(snapshot.dimensionStatuses.breadth.explanation).toContain("仅返回 2/3 条记录");
    expect(snapshot.metrics.breadthLatest).toBeNull();
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

  it("surfaces upstream HTTP errors instead of returning synthetic data", async () => {
    let attempts = 0;
    const fetcher: typeof fetch = async () => {
      attempts += 1;
      return new Response("upstream unavailable", { status: 503, headers: { "cf-ray": "test-ray-522" } });
    };
    await expect(createFuyaoSnapshot(liveInput(), { FUYAO_API_KEY: "test-key" }, () => undefined, { fetcher }))
      .rejects.toMatchObject({ code: "FUYAO_UPSTREAM_HTTP_ERROR", retryable: true, message: expect.stringContaining("test-ray-522") });
    expect(attempts).toBe(3);
  });

  it("recovers from a transient Cloudflare 522 and exposes a key-free retry diagnostic", async () => {
    const mock = mockProvider();
    let calendarAttempts = 0;
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/a-share/calendar/trading-days" && calendarAttempts++ === 0) {
        return new Response("origin timeout", { status: 522, headers: { "cf-ray": "retry-ray-123" } });
      }
      return mock.fetcher(input, init);
    };

    const snapshot = await createFuyaoSnapshot(liveInput(), { FUYAO_API_KEY: "test-key" }, (type, data) => {
      events.push({ type, data: data as Record<string, unknown> });
    }, {
      fetcher,
      now: new Date("2026-10-16T10:00:00.000Z"),
      dimensions: ["price"],
    });

    expect(snapshot.priceSeries).toHaveLength(5);
    expect(calendarAttempts).toBe(2);
    expect(events.find((event) => event.type === "tool_retrying")?.data).toMatchObject({
      callId: "calendar",
      attempt: 1,
      nextAttempt: 2,
      httpStatus: 522,
      rayId: "retry-ray-123",
    });
    expect(JSON.stringify(events)).not.toContain("test-key");
  });
});
