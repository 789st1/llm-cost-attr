import { Command } from "commander";
import fs from "fs/promises";
import path from "path";
import { scanDirectory } from "./scanner/index.js";
import { estimateCosts } from "./estimator/index.js";
import { analyzeOptimizations } from "./analyzer/index.js";
import { printReport, printComparison } from "./reporter/terminal.js";
import { generateJsonReport } from "./reporter/json.js";
import { generateHtmlReport } from "./reporter/html.js";
import { listPricing } from "./pricing/index.js";
import { auditAllCallSites } from "./accuracy/gemini-auditor.js";
import { runAccuracyLoop } from "./accuracy/loop.js";
import chalk from "chalk";

const PKG_VERSION = "0.3.1";

const program = new Command();

program
  .name("llm-cost-attr")
  .description("FinOps cost attribution tool for LLM API usage")
  .version(PKG_VERSION);

async function validatePath(p: string): Promise<string> {
  const resolved = path.resolve(p);
  try {
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) {
      console.error(chalk.red(`  Error: ${p} is not a directory`));
      process.exit(1);
    }
  } catch {
    console.error(chalk.red(`  Error: ${p} does not exist`));
    process.exit(1);
  }
  return resolved;
}

program
  .command("scan")
  .description("Scan a codebase for LLM API calls and estimate costs")
  .argument("<path>", "Path to the repository root")
  .option("-v, --volume <number>", "Monthly invocations for cost estimation", "1000")
  .option("-f, --format <format>", "Output format: terminal, json, html", "terminal")
  .option("-o, --output <file>", "Write output to file (for json/html)")
  .option("--smart", "Use Gemini AI to improve estimate accuracy (requires GEMINI_API_KEY)")
  .action(async (repoPath: string, opts: { volume: string; format: string; output?: string; smart?: boolean }) => {
    const volume = parseInt(opts.volume, 10);
    if (isNaN(volume) || volume < 1) {
      console.error(chalk.red("  Error: --volume must be a positive number"));
      process.exit(1);
    }

    if (opts.smart && !process.env.GEMINI_API_KEY) {
      console.error(chalk.red("  Error: --smart requires GEMINI_API_KEY environment variable"));
      process.exit(1);
    }

    const resolved = await validatePath(repoPath);

    try {
      console.log(chalk.gray(`  Scanning ${resolved}...`));
      const scanResult = await scanDirectory(resolved);

      if (opts.smart) {
        console.log(chalk.cyan("  Smart mode: running Gemini analysis on each call site..."));
        // Load file contents for Gemini
        const fileContents = new Map<string, string>();
        for (const site of scanResult.callSites) {
          if (!fileContents.has(site.file)) {
            try {
              const content = await fs.readFile(site.file, "utf-8");
              fileContents.set(site.file, content);
            } catch { /* skip */ }
          }
        }

        const geminiEstimates = await auditAllCallSites(scanResult.callSites, fileContents);

        // Override scanner estimates with Gemini's estimates
        for (let i = 0; i < scanResult.callSites.length; i++) {
          const ge = geminiEstimates[i];
          if (ge && ge.reasoning && !ge.reasoning.startsWith("Failed")) {
            scanResult.callSites[i].estimatedInputTokens = ge.estimatedInputTokens;
            if (!scanResult.callSites[i].maxTokens) {
              scanResult.callSites[i].maxTokens = ge.estimatedOutputTokens;
            }
            if (ge.loopMultiplier !== scanResult.callSites[i].loopMultiplier) {
              scanResult.callSites[i].loopMultiplier = ge.loopMultiplier;
              scanResult.callSites[i].inLoop = ge.loopMultiplier > 1;
            }
          }
        }
        console.log(chalk.green(`  Smart mode: enhanced ${geminiEstimates.filter(g => !g.reasoning.startsWith("Failed")).length}/${scanResult.callSites.length} estimates`));
      }

      const report = estimateCosts(scanResult.callSites, scanResult.root, scanResult.files, volume, scanResult.errors);
      const recommendations = analyzeOptimizations(report.estimates, volume);

      if (opts.format === "json") {
        const json = generateJsonReport(report, recommendations);
        if (opts.output) {
          await fs.writeFile(opts.output, json);
          console.log(chalk.green(`  JSON report written to ${opts.output}`));
        } else {
          console.log(json);
        }
      } else if (opts.format === "html") {
        const html = generateHtmlReport(report, recommendations);
        const outFile = opts.output ?? "llm-cost-report.html";
        await fs.writeFile(outFile, html);
        console.log(chalk.green(`  HTML report written to ${outFile}`));
      } else {
        printReport(report, recommendations);
      }
    } catch (err: any) {
      console.error(chalk.red(`  Error scanning ${resolved}: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command("compare")
  .description("Compare LLM costs across multiple repositories")
  .argument("<paths...>", "Paths to repository roots")
  .option("-v, --volume <number>", "Monthly invocations per repo", "1000")
  .option("-f, --format <format>", "Output format: terminal, json", "terminal")
  .option("-o, --output <file>", "Write output to file")
  .action(async (paths: string[], opts: { volume: string; format: string; output?: string }) => {
    const volume = parseInt(opts.volume, 10);
    if (isNaN(volume) || volume < 1) {
      console.error(chalk.red("  Error: --volume must be a positive number"));
      process.exit(1);
    }
    const reports = [];

    for (const repoPath of paths) {
      const resolved = await validatePath(repoPath);
      try {
        console.log(chalk.gray(`  Scanning ${resolved}...`));
        const scanResult = await scanDirectory(resolved);
        const report = estimateCosts(scanResult.callSites, scanResult.root, scanResult.files, volume, scanResult.errors);
        reports.push(report);
      } catch (err: any) {
        console.error(chalk.yellow(`  Warning: Failed to scan ${resolved}: ${err.message}`));
      }
    }

    if (reports.length === 0) {
      console.error(chalk.red("  No repositories were successfully scanned."));
      process.exit(1);
    }

    if (opts.format === "json") {
      const output = JSON.stringify(reports.map((r) => ({
        root: r.root,
        filesScanned: r.filesScanned,
        totalCallSites: r.totalCallSites,
        totalMonthlyCost: Math.round(r.totalMonthlyCost * 100) / 100,
        byProvider: r.byProvider,
      })), null, 2);
      if (opts.output) {
        await fs.writeFile(opts.output, output);
        console.log(chalk.green(`  JSON written to ${opts.output}`));
      } else {
        console.log(output);
      }
    } else {
      printComparison(reports);
      for (const report of reports) {
        const recommendations = analyzeOptimizations(report.estimates, volume);
        printReport(report, recommendations);
      }
    }
  });

program
  .command("accuracy")
  .description("Run adversarial accuracy loop to self-improve estimates (requires GEMINI_API_KEY)")
  .argument("<paths...>", "Paths to repository roots to calibrate against")
  .option("-r, --rounds <number>", "Maximum rounds", "10")
  .option("-t, --target <number>", "Target % of sites within ±20% accuracy", "90")
  .option("-v, --volume <number>", "Monthly invocations for cost estimation", "1000")
  .action(async (paths: string[], opts: { rounds: string; target: string; volume: string }) => {
    if (!process.env.GEMINI_API_KEY) {
      console.error(chalk.red("  Error: GEMINI_API_KEY environment variable is required"));
      process.exit(1);
    }

    const maxRounds = parseInt(opts.rounds, 10);
    const targetAccuracy = parseInt(opts.target, 10);
    const volume = parseInt(opts.volume, 10);

    if (isNaN(maxRounds) || maxRounds < 1) {
      console.error(chalk.red("  Error: --rounds must be a positive number"));
      process.exit(1);
    }
    if (isNaN(targetAccuracy) || targetAccuracy < 1 || targetAccuracy > 100) {
      console.error(chalk.red("  Error: --target must be between 1 and 100"));
      process.exit(1);
    }
    if (isNaN(volume) || volume < 1) {
      console.error(chalk.red("  Error: --volume must be a positive number"));
      process.exit(1);
    }

    const repoPaths = [];
    for (const p of paths) {
      repoPaths.push(await validatePath(p));
    }

    const result = await runAccuracyLoop({
      repoPaths,
      maxRounds,
      targetAccuracy,
      volume,
    });

    if (result.converged) {
      console.log(chalk.green("  Accuracy loop converged successfully."));
    } else {
      console.log(chalk.yellow("  Accuracy loop did not fully converge. Consider adding more test repos or adjusting target."));
    }
  });

program
  .command("pricing")
  .description("Show current model pricing")
  .action(() => {
    const models = listPricing();
    console.log("");
    console.log(chalk.bold.cyan("  LLM Model Pricing (per 1M tokens)"));
    console.log(chalk.gray("  " + "━".repeat(50)));
    console.log("");

    let currentProvider = "";
    for (const m of models) {
      if (m.provider !== currentProvider) {
        currentProvider = m.provider;
        console.log(chalk.bold(`  ${currentProvider.toUpperCase()}`));
      }
      const input = m.inputPer1M === 0 ? "free" : "$" + m.inputPer1M.toFixed(2);
      const output = m.outputPer1M === 0 ? "free" : "$" + m.outputPer1M.toFixed(2);
      console.log(`    ${m.model.padEnd(35)} ${input.padStart(8)} in / ${output.padStart(8)} out  [${m.category}]`);
    }
    console.log("");
  });

export { program };
