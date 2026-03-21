import { PRICING_CATALOG, type ModelPricing } from "./catalog.js";

const aliasMap = new Map<string, ModelPricing>();

for (const entry of PRICING_CATALOG) {
  aliasMap.set(entry.model.toLowerCase(), entry);
  for (const alias of entry.aliases) {
    aliasMap.set(alias.toLowerCase(), entry);
  }
}

export function resolveModel(modelStr: string | null, provider?: string): ModelPricing | null {
  if (!modelStr) {
    // Default models per provider
    if (provider === "claude-cli") return aliasMap.get("sonnet") ?? null;
    if (provider === "langchain") return aliasMap.get("gemini-2.0-flash") ?? null;
    return null;
  }

  const key = modelStr.toLowerCase().trim();

  // Direct match
  const direct = aliasMap.get(key);
  if (direct) return direct;

  // Fuzzy: try stripping "models/" prefix
  if (key.startsWith("models/")) {
    const stripped = aliasMap.get(key.replace("models/", ""));
    if (stripped) return stripped;
  }

  // Fuzzy: try matching partial
  for (const [alias, pricing] of aliasMap) {
    if (alias.includes(key) || key.includes(alias)) return pricing;
  }

  return null;
}

export function listPricing(): ModelPricing[] {
  return PRICING_CATALOG;
}

export type { ModelPricing } from "./catalog.js";
