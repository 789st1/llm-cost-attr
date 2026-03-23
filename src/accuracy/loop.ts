import fs from "fs/promises";
import path from "path";
import chalk from "chalk";
import { scanDirectory } from "../scanner/index.js";
import { estimateCosts } from "../estimator/index.js";
import { DEFAULT_TOKENS } from "../estimator/tokens.js";
import { auditAllCallSites } from "./gemini-auditor.js";
import { scoreAccuracy, summarizeRound } from "./scorer.js";
import { synthesizeImprovements, computeUpdatedDefaults } from "./synthesizer.js";
import type { RoundScore, HeuristicImprovement, LoopResult } from "./types.js";

interface LoopConfig {
  repoPaths: string[];
  maxRounds: number;
  targetAccuracy: number; // % of sites within 20%
  volume: number;
}

async function loadFileContents(repoPaths: string[]): Promise<Map<string, string>> {
  const contents = new Map<string, string>();

  for (const repoPath of repoPaths) {
    const scan = await scanDirectory(repoPath);
    // We need to read the actual files that contain call sites
    for (const site of scan.callSites) {
      if (!contents.has(site.file)) {
        try {
          const content = await fs.readFile(site.file, "utf-8");
          contents.set(site.file, content);
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  return contents;
}

export async function runAccuracyLoop(config: LoopConfig): Promise<LoopResult> {
  const rounds: RoundScore[] = [];
  const allImprovements: HeuristicImprovement[] = [];
  let converged = false;

  // Save original defaults so we can mutate them
  const originalDefaults = {
    chat: { ...DEFAULT_TOKENS.chat },
    "content-generation": { ...DEFAULT_TOKENS["content-generation"] },
    embedding: { ...DEFAULT_TOKENS.embedding },
    "tool-use": { ...DEFAULT_TOKENS["tool-use"] },
  };

  // Output scaling factor (applied to max_tokens when set)
  let outputScalingFactor = 1.0;

  console.log("");
  console.log(chalk.bold.cyan("  Adversarial Accuracy Loop"));
  console.log(chalk.gray("  " + "━".repeat(50)));
  console.log(chalk.gray(`  Repos: ${config.repoPaths.length} | Max rounds: ${config.maxRounds} | Target: ${config.targetAccuracy}% within ±20%`));
  console.log("");

  // Pre-load file contents for Gemini auditor
  console.log(chalk.gray("  Loading file contents..."));
  const fileContents = await loadFileContents(config.repoPaths);

  for (let round = 1; round <= config.maxRounds; round++) {
    console.log(chalk.bold(`  Round ${round}/${config.maxRounds}`));

    // Step 1: Scan all repos with current heuristics
    const allSites = [];
    const allEstimates = [];
    for (const repoPath of config.repoPaths) {
      const scan = await scanDirectory(repoPath);
      const report = estimateCosts(scan.callSites, scan.root, scan.files, config.volume, scan.errors);

      // Apply output scaling to estimates that use max_tokens
      for (const est of report.estimates) {
        if (est.callSite.maxTokens && outputScalingFactor < 1.0) {
          const scaledOutput = Math.round(est.callSite.maxTokens * outputScalingFactor);
          if (scaledOutput !== est.outputTokens) {
            est.outputTokens = scaledOutput;
            // Recalculate cost
            if (est.pricing) {
              const inputCost = (est.inputTokens * est.pricing.inputPer1M) / 1_000_000;
              const outputCost = (est.outputTokens * est.pricing.outputPer1M) / 1_000_000;
              est.costPerCall = inputCost + outputCost;
              est.monthlyCost = est.costPerCall * est.callsPerInvocation * config.volume;
            }
          }
        }
      }

      allSites.push(...scan.callSites);
      allEstimates.push(...report.estimates);
    }

    console.log(chalk.gray(`    Scanned ${allSites.length} call sites`));

    // Step 2: Get Gemini second opinions
    console.log(chalk.gray("    Running Gemini audits..."));
    const geminiEstimates = await auditAllCallSites(allSites, fileContents);

    // Step 3: Score accuracy
    const scores = scoreAccuracy(allEstimates, geminiEstimates);
    const roundScore = summarizeRound(round, scores);
    rounds.push(roundScore);

    const pctWithin20 = scores.length > 0 ? Math.round(roundScore.within20Percent / scores.length * 100) : 0;
    const pctWithin10 = scores.length > 0 ? Math.round(roundScore.within10Percent / scores.length * 100) : 0;

    console.log(chalk.bold(`    Accuracy: ${pctWithin20}% within ±20% | ${pctWithin10}% within ±10%`));
    console.log(chalk.gray(`    Mean error: ${roundScore.meanErrorPercent}% | Median: ${roundScore.medianErrorPercent}%`));

    if (roundScore.worstOffenders.length > 0) {
      console.log(chalk.yellow("    Worst offenders:"));
      for (const w of roundScore.worstOffenders.slice(0, 3)) {
        const relFile = w.file.split("/").slice(-2).join("/");
        console.log(chalk.yellow(`      ${relFile}:${w.line} — ${Math.round(w.errorPercent)}% off (${w.errorCategory})`));
      }
    }

    // Step 4: Check convergence
    if (pctWithin20 >= config.targetAccuracy) {
      console.log(chalk.green(`    Converged! ${pctWithin20}% >= ${config.targetAccuracy}% target`));
      converged = true;
      break;
    }

    // Check if improvement stalled
    if (rounds.length >= 2) {
      const prev = rounds[rounds.length - 2];
      const prevPct = prev.totalCallSites > 0 ? Math.round(prev.within20Percent / prev.totalCallSites * 100) : 0;
      if (pctWithin20 - prevPct < 2 && round > 2) {
        console.log(chalk.yellow(`    Improvement stalled (${prevPct}% → ${pctWithin20}%). Stopping.`));
        break;
      }
    }

    // Step 5: Synthesize improvements
    const improvements = synthesizeImprovements(scores, roundScore);
    allImprovements.push(...improvements);

    if (improvements.length === 0) {
      console.log(chalk.yellow("    No improvements to apply. Stopping."));
      break;
    }

    // Step 6: Apply improvements
    console.log(chalk.gray(`    Applying ${improvements.length} improvements...`));
    for (const imp of improvements) {
      if (imp.type === "token-default") {
        const updated = computeUpdatedDefaults(scores);
        DEFAULT_TOKENS.chat.input = updated.chat.input;
        DEFAULT_TOKENS.chat.output = updated.chat.output;
        DEFAULT_TOKENS["content-generation"].input = updated.chat.input;
        DEFAULT_TOKENS["content-generation"].output = updated.chat.output;
        DEFAULT_TOKENS.embedding.input = updated.embedding.input;
        console.log(chalk.gray(`      Token defaults: chat(${updated.chat.input}/${updated.chat.output}), embed(${updated.embedding.input})`));
      }
      if (imp.type === "output-scaling") {
        // Extract the scaling factor from the description
        const match = imp.after.match(/(\d+\.?\d*)/);
        if (match) {
          outputScalingFactor = parseFloat(match[1]);
          console.log(chalk.gray(`      Output scaling: ${Math.round(outputScalingFactor * 100)}% of max_tokens`));
        }
      }
    }

    console.log("");
  }

  // Final summary
  const lastRound = rounds[rounds.length - 1];
  const finalPct = lastRound && lastRound.totalCallSites > 0
    ? Math.round(lastRound.within20Percent / lastRound.totalCallSites * 100)
    : 0;

  console.log("");
  console.log(chalk.bold.cyan("  Loop Complete"));
  console.log(chalk.gray("  " + "━".repeat(50)));
  console.log(`  Rounds: ${rounds.length}`);
  console.log(`  Final accuracy: ${finalPct}% within ±20%`);
  console.log(`  Converged: ${converged ? chalk.green("yes") : chalk.yellow("no")}`);
  console.log(`  Improvements applied: ${allImprovements.length}`);

  if (allImprovements.length > 0) {
    console.log("");
    console.log(chalk.bold("  Calibrated defaults:"));
    console.log(`    Chat: ${DEFAULT_TOKENS.chat.input} input / ${DEFAULT_TOKENS.chat.output} output tokens`);
    console.log(`    Embedding: ${DEFAULT_TOKENS.embedding.input} input tokens`);
    if (outputScalingFactor < 1.0) {
      console.log(`    Output scaling: ${Math.round(outputScalingFactor * 100)}% of max_tokens`);
    }
  }

  console.log("");

  return {
    rounds,
    finalAccuracy: finalPct,
    converged,
    improvementsApplied: allImprovements,
  };
}
