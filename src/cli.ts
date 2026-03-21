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
import chalk from "chalk";

const program = new Command();

program
  .name("llm-cost-attr")
  .description("FinOps cost attribution tool for LLM API usage")
  .version("0.1.0");

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
  .action(async (repoPath: string, opts: { volume: string; format: string; output?: string }) => {
    const volume = parseInt(opts.volume, 10);
    if (isNaN(volume) || volume < 1) {
      console.error(chalk.red("  Error: --volume must be a positive number"));
      process.exit(1);
    }

    const resolved = await validatePath(repoPath);

    try {
      console.log(chalk.gray(`  Scanning ${resolved}...`));
      const scanResult = await scanDirectory(resolved);
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
