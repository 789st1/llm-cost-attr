import { PRICING_CATALOG, type ModelPricing } from "./catalog.js";

const exactMap = new Map<string, ModelPricing>();

for (const entry of PRICING_CATALOG) {
  exactMap.set(entry.model.toLowerCase(), entry);
  for (const alias of entry.aliases) {
    exactMap.set(alias.toLowerCase(), entry);
  }
}

export function resolveModel(modelStr: string | null, provider?: string): ModelPricing | null {
  if (!modelStr) {
    // Default models per provider
    if (provider === "claude-cli") return exactMap.get("sonnet") ?? null;
    if (provider === "langchain") return exactMap.get("gemini-2.0-flash") ?? null;
    return null;
  }

  const key = modelStr.toLowerCase().trim();

  // Direct/alias match only — no fuzzy matching
  const direct = exactMap.get(key);
  if (direct) return direct;

  // Strip "models/" prefix (Google API format)
  if (key.startsWith("models/")) {
    const stripped = exactMap.get(key.replace("models/", ""));
    if (stripped) return stripped;
  }

  return null;
}

export function listPricing(): ModelPricing[] {
  return PRICING_CATALOG;
}

export type { ModelPricing } from "./catalog.js";
