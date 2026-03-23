import type { CallSite } from "../scanner/types.js";
import type { GeminiEstimate } from "./types.js";
import { resolveModel } from "../pricing/index.js";
import { DEFAULT_TOKENS } from "../estimator/tokens.js";

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

// Sane bounds for validation
const MAX_INPUT_TOKENS = 200_000; // Gemini context window
const MAX_OUTPUT_TOKENS = 65_536;
const MAX_LOOP_MULTIPLIER = 1000;

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY environment variable is required for smart mode / accuracy loop");
  }
  return key;
}

function buildPrompt(site: CallSite, contextLines: string): string {
  return `You are an expert at estimating LLM API costs. Analyze this code snippet that makes an LLM API call.

Provider: ${site.provider}
Detected model: ${site.model || "unknown"}
Call type: ${site.callType}
Detected max_tokens: ${site.maxTokens || "not set"}
Detected input tokens: ${site.estimatedInputTokens || "unknown"}
In loop: ${site.inLoop} (multiplier: ${site.loopMultiplier})
Has caching: ${site.hasCaching}

Code context (surrounding the call at line ${site.line}):
\`\`\`
${contextLines}
\`\`\`

Estimate the following for a SINGLE invocation of this call:
1. Expected input tokens (consider: system prompt length, user message template, any injected data)
2. Expected output tokens (consider: task type, max_tokens cap, typical response length for this kind of task)
3. The actual model being used (resolve any variables or defaults)
4. Loop multiplier (how many times this call executes per invocation — trace caller functions if needed)
5. Whether the result is cacheable (same input = same output for repeated calls)

Return ONLY valid JSON, no markdown, no explanation:
{"inputTokens": <number>, "outputTokens": <number>, "model": "<string>", "loopMultiplier": <number>, "cacheable": <boolean>, "reasoning": "<brief explanation>"}`;
}

async function callGeminiWithRetry(prompt: string, maxRetries: number = 3): Promise<string> {
  const apiKey = getApiKey();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 500,
          },
        }),
      });

      if (response.status === 429) {
        // Rate limited — wait with exponential backoff
        const delay = Math.min(30000, 2000 * Math.pow(2, attempt));
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      if (response.status >= 500) {
        // Server error — retry
        const delay = 1000 * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Gemini API error ${response.status}: ${err.substring(0, 200)}`);
      }

      const data = await response.json() as any;
      return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    } catch (err: any) {
      lastError = err;
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
  }

  throw lastError ?? new Error("Gemini API call failed after retries");
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseGeminiResponse(raw: string, site: CallSite): GeminiEstimate {
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const defaults = DEFAULT_TOKENS[site.callType] ?? DEFAULT_TOKENS.chat;

  try {
    const parsed = JSON.parse(cleaned);
    const model = parsed.model || site.model || "unknown";
    const pricing = resolveModel(model, site.provider);

    // Validate and clamp values to sane ranges
    const inputTokens = clamp(Math.round(Number(parsed.inputTokens) || defaults.input), 1, MAX_INPUT_TOKENS);
    const outputTokens = clamp(Math.round(Number(parsed.outputTokens) || defaults.output), 0, MAX_OUTPUT_TOKENS);
    const loopMultiplier = clamp(Math.round(Number(parsed.loopMultiplier) || site.loopMultiplier), 1, MAX_LOOP_MULTIPLIER);

    const inputCost = pricing ? (inputTokens * pricing.inputPer1M) / 1_000_000 : 0;
    const outputCost = pricing ? (outputTokens * pricing.outputPer1M) / 1_000_000 : 0;

    return {
      file: site.file,
      line: site.line,
      estimatedInputTokens: inputTokens,
      estimatedOutputTokens: outputTokens,
      estimatedCostPerCall: inputCost + outputCost,
      model,
      reasoning: String(parsed.reasoning || "").substring(0, 500),
      loopMultiplier,
      cacheable: Boolean(parsed.cacheable),
    };
  } catch {
    // Fallback: preserve scanner's own estimates (not different hardcoded values)
    return {
      file: site.file,
      line: site.line,
      estimatedInputTokens: site.estimatedInputTokens ?? defaults.input,
      estimatedOutputTokens: site.maxTokens ?? defaults.output,
      estimatedCostPerCall: 0,
      model: site.model || "unknown",
      reasoning: "Failed to parse Gemini response",
      loopMultiplier: site.loopMultiplier,
      cacheable: false,
    };
  }
}

export async function auditCallSite(
  site: CallSite,
  fileContent: string,
): Promise<GeminiEstimate> {
  const lines = fileContent.split("\n");
  const start = Math.max(0, site.line - 25);
  const end = Math.min(lines.length, site.line + 25);
  const contextLines = lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join("\n");

  const prompt = buildPrompt(site, contextLines);
  const raw = await callGeminiWithRetry(prompt);
  return parseGeminiResponse(raw, site);
}

export async function auditAllCallSites(
  sites: CallSite[],
  fileContents: Map<string, string>,
): Promise<GeminiEstimate[]> {
  const results: GeminiEstimate[] = [];
  const defaults = DEFAULT_TOKENS.chat;

  for (let i = 0; i < sites.length; i++) {
    const site = sites[i];
    const content = fileContents.get(site.file);
    if (!content) {
      results.push({
        file: site.file,
        line: site.line,
        estimatedInputTokens: site.estimatedInputTokens ?? defaults.input,
        estimatedOutputTokens: site.maxTokens ?? defaults.output,
        estimatedCostPerCall: 0,
        model: site.model || "unknown",
        reasoning: "File content not available",
        loopMultiplier: site.loopMultiplier,
        cacheable: false,
      });
      continue;
    }

    try {
      const estimate = await auditCallSite(site, content);
      results.push(estimate);
      // Rate limit: wait 4s between calls (15 RPM = 1 per 4s)
      if (i < sites.length - 1) {
        await new Promise(r => setTimeout(r, 4000));
      }
    } catch (err: any) {
      console.error(`  Warning: Gemini audit failed for ${site.file}:${site.line}: ${err.message}`);
      results.push({
        file: site.file,
        line: site.line,
        estimatedInputTokens: site.estimatedInputTokens ?? defaults.input,
        estimatedOutputTokens: site.maxTokens ?? defaults.output,
        estimatedCostPerCall: 0,
        model: site.model || "unknown",
        reasoning: `Audit failed: ${err.message}`,
        loopMultiplier: site.loopMultiplier,
        cacheable: false,
      });
    }
  }

  return results;
}
