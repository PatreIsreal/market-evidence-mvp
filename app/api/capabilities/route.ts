import { env } from "cloudflare:workers";
import { readRuntimeConfig, capabilityState } from "@/lib/server/runtime";
import { dimensionLabels, dimensions } from "@/lib/contracts/research";

export const dynamic = "force-dynamic";

export async function GET() {
  const source = env as unknown as Record<string, string | undefined>;
  const config = readRuntimeConfig(source);
  const hasFuyao = Boolean(source.FUYAO_BASE_URL && source.FUYAO_API_KEY);
  const hasIfind = Boolean(source.IFIND_MCP_URL && source.IFIND_ACCESS_TOKEN);

  return Response.json(
    {
      mode: config.mode,
      liveDataAdapter: "unverified",
      modelAdapter: "unverified",
      providers: {
        fuyao: capabilityState(hasFuyao),
        ifind: capabilityState(hasIfind),
        model: capabilityState(config.modelConfigured),
      },
      dimensions: dimensions.map((dimension) => ({
        id: dimension,
        label: dimensionLabels[dimension],
        status: config.mode === "demo" ? "synthetic_demo" : "not_connected",
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
