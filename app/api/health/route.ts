import { env } from "cloudflare:workers";
import { readRuntimeConfig } from "@/lib/server/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = readRuntimeConfig(env as unknown as Record<string, string | undefined>);
  return Response.json(
    {
      status: "ok",
      mode: config.mode,
      dataProviderConfigured: config.dataProviderConfigured,
      modelConfigured: config.modelConfigured,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
