export type ResearchStreamEvent = {
  type: string;
  requestId: string;
  seq: number;
  data: unknown;
};

export async function consumeResearchStream(
  response: Response,
  onEvent: (event: ResearchStreamEvent) => void,
): Promise<void> {
  if (!response.ok) {
    let message = `请求失败（HTTP ${response.status}）`;
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // Keep the useful HTTP status when a proxy returns a non-JSON error page.
    }
    throw new Error(message);
  }
  if (!response.body) throw new Error("浏览器未收到研究结果流。");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let ended = false;
  const parseLine = (line: string) => {
    if (!line.trim()) return;
    const event: unknown = JSON.parse(line);
    if (
      typeof event !== "object" ||
      event === null ||
      !("type" in event) ||
      typeof event.type !== "string" ||
      !("requestId" in event) ||
      typeof event.requestId !== "string" ||
      !("seq" in event) ||
      typeof event.seq !== "number" ||
      !("data" in event)
    ) {
      throw new Error("研究结果流包含无效事件。");
    }
    onEvent(event as ResearchStreamEvent);
    if (event.type === "done") ended = true;
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        parseLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) parseLine(buffer);
    if (!ended) throw new Error("研究结果流提前结束，本轮没有完成。");
  } finally {
    reader.releaseLock();
  }
}
