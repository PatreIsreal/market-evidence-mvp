export type RuntimeMode = "demo" | "live";

export type RuntimeConfig = {
  mode: RuntimeMode;
  dataProviderConfigured: boolean;
  modelConfigured: boolean;
};

export function readRuntimeConfig(source: Record<string, string | undefined>): RuntimeConfig {
  const mode: RuntimeMode = source.APP_DATA_MODE === "demo" ? "demo" : "live";
  const dataProviderConfigured = Boolean(
    source.FUYAO_API_KEY ||
      (source.IFIND_MCP_URL && source.IFIND_ACCESS_TOKEN),
  );
  const modelConfigured = Boolean(source.MODEL_BASE_URL && source.MODEL_API_KEY && source.MODEL_NAME);
  return { mode, dataProviderConfigured, modelConfigured };
}

export function capabilityState(configured: boolean, verified = false): "verified" | "configured_unverified" | "not_configured" {
  if (verified) return "verified";
  return configured ? "configured_unverified" : "not_configured";
}
