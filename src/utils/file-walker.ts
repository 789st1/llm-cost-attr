import fg from "fast-glob";
import fs from "fs/promises";
import path from "path";

const ALWAYS_IGNORE = [
  "node_modules/**",
  ".git/**",
  "dist/**",
  "build/**",
  "__pycache__/**",
  "*.pyc",
  ".venv/**",
  "venv/**",
  ".env",
  "*.min.js",
  "*.bundle.js",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
];

const CODE_EXTENSIONS = [
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "py",
];

export async function walkFiles(root: string): Promise<string[]> {
  const patterns = CODE_EXTENSIONS.map((ext) => `**/*.${ext}`);
  const files = await fg(patterns, {
    cwd: root,
    absolute: true,
    ignore: ALWAYS_IGNORE,
    dot: false,
    followSymbolicLinks: false,
  });
  return files.sort();
}

export async function readFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf-8");
}
