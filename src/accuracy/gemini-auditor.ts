import type { CallSite } from "../scanner/types.js";
import type { GeminiEstimate } from "./types.js";
import { resolveModel } from "../pricing/index.js";

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

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

async function callGemini(prompt: string): Promise<string> {
  const apiKey = getApiKey();
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

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${err}`);
  }

  const data = await response.json() as any;
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

function parseGeminiResponse(raw: string, site: CallSite): GeminiEstimate {
  // Strip markdown code fences if present
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  
  try {
    const parsed = JSON.parse(cleaned);
    const model = parsed.model || site.model || "unknown";
    const pricing = resolveModel(model, site.provider);
    
    const inputTokens = Math.max(1, Math.round(parsed.inputTokens || 500));
    const outputTokens = Math.max(0, Math.round(parsed.outputTokens || 300));
    
    const inputCost = pricing ? (inputTokens * pricing.inputPer1M) / 1_000_000 : 0;
    const outputCost = pricing ? (outputTokens * pricing.outputPer1M) / 1_000_000 : 0;
    
    return {
      file: site.file,
      line: site.line,
      estimatedInputTokens: inputTokens,
      estimatedOutputTokens: outputTokens,
      estimatedCostPerCall: inputCost + outputCost,
      model,
      reasoning: parsed.reasoning || "",
      loopMultiplier: parsed.loopMultiplier || site.loopMultiplier,
      cacheable: parsed.cacheable ?? false,
    };
  } catch {
    // Fallback: return defaults if Gemini response is unparseable
    return {
      file: site.file,
      line: site.line,
      estimatedInputTokens: 500,
      estimatedOutputTokens: 300,
      estimatedCostPerCall: 0,
      model: site.model || "unknown",
      reasoning: "Failed to parse Gemini response: " + raw.substring(0, 100),
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
  const raw = await callGemini(prompt);
  return parseGeminiResponse(raw, site);
}

export async function auditAllCallSites(
  sites: CallSite[],
  fileContents: Map<string, string>,
): Promise<GeminiEstimate[]> {
  const results: GeminiEstimate[] = [];
  
  // Process sequentially to respect rate limits (15 RPM on free tier)
  for (const site of sites) {
    const content = fileContents.get(site.file);
    if (!content) {
      results.push({
        file: site.file,
        line: site.line,
        estimatedInputTokens: 500,
        estimatedOutputTokens: 300,
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
      if (sites.indexOf(site) < sites.length - 1) {
        await new Promise(r => setTimeout(r, 4000));
      }
    } catch (err: any) {
      console.error(`  Warning: Gemini audit failed for ${site.file}:${site.line}: ${err.message}`);
      results.push({
        file: site.file,
        line: site.line,
        estimatedInputTokens: 500,
        estimatedOutputTokens: 300,
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
