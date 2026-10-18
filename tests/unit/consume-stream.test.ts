import { describe, expect, it } from "vitest";
import { consumeResearchStream } from "@/lib/client/consume-stream";

function ndjsonResponse(lines: string[], status = 200) {
  return new Response(lines.join("\n"), {
    status,
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

describe("research stream consumer", () => {
  it("delivers events and accepts a final line without a newline", async () => {
    const events = [
      { type: "snapshot", requestId: "r1", seq: 0, data: { synthetic: true } },
      { type: "done", requestId: "r1", seq: 1, data: { outcome: "partial" } },
    ];
    const received: string[] = [];
    await consumeResearchStream(ndjsonResponse(events.map((event) => JSON.stringify(event))), (event) => received.push(event.type));
    expect(received).toEqual(["snapshot", "done"]);
  });

  it("rejects a truncated stream and invalid event envelope", async () => {
    await expect(consumeResearchStream(ndjsonResponse([
      JSON.stringify({ type: "snapshot", requestId: "r1", seq: 0, data: {} }),
    ]), () => undefined)).rejects.toThrow("提前结束");
    await expect(consumeResearchStream(ndjsonResponse(["{\"type\":\"done\"}"]), () => undefined)).rejects.toThrow("无效事件");
  });

  it("surfaces the server message for an HTTP error", async () => {
    await expect(consumeResearchStream(ndjsonResponse([JSON.stringify({ message: "缺少配置" })], 503), () => undefined))
      .rejects.toThrow("缺少配置");
  });
});
