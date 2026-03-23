import fg from "fast-glob";
import fs from "fs/promises";
import path from "path";

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

const ALWAYS_IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/__pycache__/**",
  "**/*.pyc",
  "**/.venv/**",
  "**/venv/**",
  "**/.env",
  "**/*.min.js",
  "**/*.bundle.js",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
  "**/site-packages/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/coverage/**",
  "**/.tox/**",
  "**/.mypy_cache/**",
  "**/.pytest_cache/**",
  "**/eggs/**",
  "**/*.egg-info/**",
];

const CODE_EXTENSIONS = [
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "py",
];

async function loadGitignore(root: string): Promise<string[]> {
  try {
    const content = await fs.readFile(path.join(root, ".gitignore"), "utf-8");
    return content
      .split("\n")
      .filter((line) => line.trim() && !line.startsWith("#"))
      .map((line) => {
        // Ensure patterns work at any depth
        const trimmed = line.trim();
        if (!trimmed.startsWith("**/") && !trimmed.startsWith("/")) {
          return `**/${trimmed}`;
        }
        return trimmed;
      });
  } catch {
    return [];
  }
}

export async function walkFiles(root: string): Promise<string[]> {
  const gitignorePatterns = await loadGitignore(root);
  const allIgnore = [...ALWAYS_IGNORE, ...gitignorePatterns];

  const patterns = CODE_EXTENSIONS.map((ext) => `**/*.${ext}`);
  const files = await fg(patterns, {
    cwd: root,
    absolute: true,
    ignore: allIgnore,
    dot: false,
    followSymbolicLinks: false,
  });
  return files.sort();
}

export async function readFile(filePath: string): Promise<string> {
  const stat = await fs.stat(filePath);
  if (stat.size > MAX_FILE_SIZE) {
    throw new Error(`File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB), skipping`);
  }
  return fs.readFile(filePath, "utf-8");
}
