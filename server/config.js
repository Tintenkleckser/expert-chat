import "dotenv/config";

export const config = {
  port: Number(process.env.PORT || 8787),
  supabase: {
    url: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    matchDik2Function: process.env.SUPABASE_MATCH_DIK2_FUNCTION || "match_wissen_dik2",
    matchHandbuchFunction:
      process.env.SUPABASE_MATCH_HANDBUCH_FUNCTION || "match_wissen_handbuch"
  },
  sources: ["DIK2", "Handbuch"],
  llm: {
    provider: process.env.LLM_PROVIDER || "mistral",
    mistralApiKey: process.env.MISTRAL_API_KEY,
    mistralChatModel: process.env.MISTRAL_CHAT_MODEL || "mistral-large-latest",
    mistralEmbeddingModel: process.env.MISTRAL_EMBEDDING_MODEL || "mistral-embed",
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiChatModel: process.env.OPENAI_CHAT_MODEL || "gpt-4.1",
    openaiEmbeddingModel: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-large"
  }
};

export function assertRuntimeConfig() {
  const missing = [];

  if (!config.supabase.url) missing.push("SUPABASE_URL");
  if (!config.supabase.serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");

  if (config.llm.provider === "mistral" && !config.llm.mistralApiKey) {
    missing.push("MISTRAL_API_KEY");
  }

  if (config.llm.provider === "openai" && !config.llm.openaiApiKey) {
    missing.push("OPENAI_API_KEY");
  }

  if (missing.length > 0) {
    const error = new Error(`Missing environment variables: ${missing.join(", ")}`);
    error.status = 500;
    throw error;
  }
}
