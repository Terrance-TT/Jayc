interface Env {
  MOONSHOT_API_KEY: string;
  MOONSHOT_MODEL?: string;
  MOONSHOT_BASE_URL?: string;
  MOONSHOT_RELAY?: string;
  MOONSHOT_PLANNER_MODEL?: string;
  MAX_TOKENS?: string;
  K3_PLANNER_EFFORT?: string;
  K3_BUILDER_EFFORT?: string;
  BUILDER_SEGMENT_TIMEOUT_MS?: string;
  CLERK_PUBLISHABLE_KEY?: string;
  CLERK_SECRET_KEY?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  DB?: D1Database;
}
