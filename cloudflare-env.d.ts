declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    APP_DATA_MODE?: string;
    FUYAO_BASE_URL?: string;
    FUYAO_API_KEY?: string;
    IFIND_MCP_URL?: string;
    IFIND_ACCESS_TOKEN?: string;
    MODEL_BASE_URL?: string;
    MODEL_API_KEY?: string;
    MODEL_NAME?: string;
  }
}
