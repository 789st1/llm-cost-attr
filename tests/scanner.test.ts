import { describe, it, expect } from "vitest";
import { geminiScanner } from "../src/scanner/patterns/gemini.js";
import { anthropicScanner } from "../src/scanner/patterns/anthropic.js";
import { openaiScanner } from "../src/scanner/patterns/openai.js";
import { langchainScanner } from "../src/scanner/patterns/langchain.js";
import { claudeCliScanner } from "../src/scanner/patterns/claude-cli.js";
import fs from "fs";
import path from "path";

function loadFixture(name: string): { content: string; lines: string[]; path: string } {
  const filePath = path.resolve("fixtures", name);
  const content = fs.readFileSync(filePath, "utf-8");
  return { content, lines: content.split("\n"), path: filePath };
}

describe("Gemini Scanner", () => {
  it("detects Google GenAI imports", () => {
    const { content } = loadFixture("sample-gemini.ts");
    expect(geminiScanner.detectImports(content)).toBe(true);
  });

  it("does not detect imports in unrelated files", () => {
    expect(geminiScanner.detectImports('import express from "express"')).toBe(false);
  });

  it("finds generateContent and embedContent call sites", () => {
    const { content, lines, path: fp } = loadFixture("sample-gemini.ts");
    const sites = geminiScanner.findCallSites(fp, content, lines);
    expect(sites.length).toBe(2);
    expect(sites[0].callType).toBe("content-generation");
    expect(sites[0].model).toBe("gemini-2.0-flash");
    expect(sites[0].maxTokens).toBe(300);
    expect(sites[1].callType).toBe("embedding");
    expect(sites[1].model).toBe("gemini-embedding-001");
  });
});

describe("Anthropic Scanner", () => {
  it("detects Anthropic imports", () => {
    const { content } = loadFixture("sample-anthropic.ts");
    expect(anthropicScanner.detectImports(content)).toBe(true);
  });

  it("finds messages.create call sites", () => {
    const { content, lines, path: fp } = loadFixture("sample-anthropic.ts");
    const sites = anthropicScanner.findCallSites(fp, content, lines);
    expect(sites.length).toBe(1);
    expect(sites[0].provider).toBe("anthropic");
    expect(sites[0].model).toBe("claude-haiku-4-5-20251001");
    expect(sites[0].maxTokens).toBe(150);
  });
});

describe("OpenAI Scanner", () => {
  it("detects OpenAI imports", () => {
    const { content } = loadFixture("sample-openai.ts");
    expect(openaiScanner.detectImports(content)).toBe(true);
  });

  it("finds embeddings.create and chat.completions.create", () => {
    const { content, lines, path: fp } = loadFixture("sample-openai.ts");
    const sites = openaiScanner.findCallSites(fp, content, lines);
    expect(sites.length).toBe(2);
    expect(sites.some((s) => s.callType === "embedding")).toBe(true);
    expect(sites.some((s) => s.callType === "chat")).toBe(true);
    expect(sites.find((s) => s.callType === "embedding")?.model).toBe("text-embedding-3-small");
    expect(sites.find((s) => s.callType === "chat")?.model).toBe("gpt-4o-mini");
  });
});

describe("LangChain Scanner", () => {
  it("detects LangChain imports", () => {
    const { content } = loadFixture("sample-langchain.py");
    expect(langchainScanner.detectImports(content)).toBe(true);
  });

  it("finds invoke and factory call sites", () => {
    const { content, lines, path: fp } = loadFixture("sample-langchain.py");
    const sites = langchainScanner.findCallSites(fp, content, lines);
    expect(sites.length).toBeGreaterThanOrEqual(1);
    expect(sites.some((s) => s.provider === "google" || s.provider === "langchain")).toBe(true);
  });
});

describe("Claude CLI Scanner", () => {
  it("detects Claude CLI patterns", () => {
    const { content } = loadFixture("sample-claude-cli.py");
    expect(claudeCliScanner.detectImports(content)).toBe(true);
  });

  it("finds ask and ask_text methods", () => {
    const { content, lines, path: fp } = loadFixture("sample-claude-cli.py");
    const sites = claudeCliScanner.findCallSites(fp, content, lines);
    expect(sites.length).toBe(2);
    expect(sites[0].provider).toBe("claude-cli");
    expect(sites[0].model).toBe("sonnet");
  });
});
