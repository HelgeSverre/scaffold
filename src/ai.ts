import Anthropic from "@anthropic-ai/sdk";
import { join } from "path";
import { existsSync, readFileSync, readdirSync } from "fs";
import type { AIConfig, AIContext, PageSummary } from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

const CORE_SYSTEM_PROMPT = `You are an expert frontend developer working on HTML prototypes.

CRITICAL RULES:
- Output ONLY valid HTML. No markdown, no explanations, no code fences.
- Every page is self-contained: includes its own <style>, CDN links, and complete markup.
- Match the existing design system exactly — use the CSS variables, class names, and layout patterns described in the project style guide below.`;

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_MAX_TOKENS = 16000;

// ─── Anthropic Client (lazy singleton) ────────────────────────────────────────

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic();
  }
  return _client;
}

// ─── Claude Code CLI Detection ────────────────────────────────────────────────

let _claudeCodeAvailable: boolean | null = null;

export function isClaudeCodeAvailable(): boolean {
  if (_claudeCodeAvailable === null) {
    try {
      const result = Bun.spawnSync(["which", "claude"]);
      _claudeCodeAvailable = result.exitCode === 0;
    } catch {
      _claudeCodeAvailable = false;
    }
  }
  return _claudeCodeAvailable;
}

// ─── Context Assembly ─────────────────────────────────────────────────────────

export function buildAIContext(
  dir: string,
  yamlContent: string,
  opts?: {
    currentPageHtml?: string;
    selectedHtml?: string;
    basePageHtml?: string;
    components?: AIContext["components"];
  }
): AIContext {
  // Read .scaffold/prompt.md
  const promptMdPath = join(dir, ".scaffold", "prompt.md");
  const promptMd = existsSync(promptMdPath) ? readFileSync(promptMdPath, "utf-8") : "";

  // Scan pages for summaries
  const projectPages = scanPageSummaries(dir);

  return {
    scaffoldYml: yamlContent,
    projectPages,
    promptMd,
    currentPageHtml: opts?.currentPageHtml,
    selectedHtml: opts?.selectedHtml,
    basePageHtml: opts?.basePageHtml,
    components: opts?.components,
  };
}

function scanPageSummaries(dir: string): PageSummary[] {
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter((f) => f.endsWith(".html") && !f.startsWith("."));

  return files.map((f) => {
    const content = readFileSync(join(dir, f), "utf-8");
    const titleMatch = content.match(/<title>(.+?)<\/title>/i);
    return {
      filename: f,
      title: titleMatch ? titleMatch[1] : f.replace(/\.html$/, ""),
      lineCount: content.split("\n").length,
    };
  });
}

// ─── System Prompt ────────────────────────────────────────────────────────────

export function buildSystemPrompt(ctx: AIContext, config?: AIConfig): string {
  const parts: string[] = [CORE_SYSTEM_PROMPT];

  if (ctx.promptMd) {
    parts.push(ctx.promptMd);
  }

  parts.push(`DATA MODEL:\n${ctx.scaffoldYml}`);

  if (ctx.projectPages.length > 0) {
    const pageList = ctx.projectPages
      .map((p) => `- ${p.filename}: "${p.title}" (${p.lineCount} lines)`)
      .join("\n");
    parts.push(`EXISTING PAGES:\n${pageList}`);
  }

  if (ctx.components && ctx.components.length > 0) {
    const compList = ctx.components
      .map((c) => `- ${c.name} (${c.category}): ${c.description}`)
      .join("\n");
    parts.push(`AVAILABLE COMPONENTS:\n${compList}`);
  }

  if (config?.instructions) {
    parts.push(config.instructions);
  }

  return parts.join("\n\n");
}

// ─── Streaming AI ─────────────────────────────────────────────────────────────

export async function* streamAI(
  systemPrompt: string,
  userPrompt: string,
  config?: AIConfig
): AsyncGenerator<string> {
  const client = getClient();
  const stream = client.messages.stream({
    model: config?.model || DEFAULT_MODEL,
    max_tokens: config?.max_tokens || DEFAULT_MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }
}

// ─── Claude Code CLI ──────────────────────────────────────────────────────────

export async function claudeCode(prompt: string, cwd: string): Promise<string> {
  const proc = Bun.spawn(["claude", "-p", prompt, "--output-format", "text"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = await new Response(proc.stdout).text();
  await proc.exited;
  return output;
}

// ─── Style Extraction ─────────────────────────────────────────────────────────

export async function extractStyle(dir: string, config?: AIConfig): Promise<string> {
  // Find the style reference file
  let refFile: string | undefined;

  if (config?.style_reference) {
    const path = join(dir, config.style_reference);
    if (existsSync(path)) refFile = path;
  }

  if (!refFile) {
    // Use first .html file found
    const files = readdirSync(dir).filter((f) => f.endsWith(".html") && !f.startsWith("."));
    if (files.length > 0) {
      refFile = join(dir, files[0]);
    }
  }

  if (!refFile) {
    return getMinimalPromptMd();
  }

  const html = readFileSync(refFile, "utf-8");
  const client = getClient();

  const response = await client.messages.create({
    model: config?.model || DEFAULT_MODEL,
    max_tokens: 4096,
    system: "You are a design system analyst. Analyze HTML files and produce concise style guides.",
    messages: [
      {
        role: "user",
        content: `Analyze this HTML prototype and produce a concise style guide in markdown format. Extract:

1. CSS custom properties (from :root blocks)
2. Shared CSS classes with their purpose
3. Layout structure (navbar, sidebar, content area dimensions)
4. CDN dependencies (Tailwind, Alpine, fonts, etc.)
5. Alpine.js patterns (how x-data is structured)
6. Design conventions (spacing, border radius, color patterns)

Output a clean markdown document starting with "# Project Style Guide" suitable for inclusion in AI prompts.

HTML to analyze:
${html}`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";

  // Write to .scaffold/prompt.md
  const scaffoldDir = join(dir, ".scaffold");
  if (!existsSync(scaffoldDir)) {
    const { mkdirSync } = await import("fs");
    mkdirSync(scaffoldDir, { recursive: true });
  }

  // Back up existing prompt.md
  const promptMdPath = join(scaffoldDir, "prompt.md");
  if (existsSync(promptMdPath)) {
    await Bun.write(join(scaffoldDir, "prompt.md.bak"), Bun.file(promptMdPath));
  }

  await Bun.write(promptMdPath, text);
  return text;
}

export function getMinimalPromptMd(): string {
  return `# Project Style Guide

## Stack
- Tailwind CSS (via CDN)
- Alpine.js 3.x (via CDN, deferred)

## Conventions
- Self-contained single-file HTML pages
- All CSS in <style> tags, all state in inline x-data
- Realistic mock data in x-data objects

(Edit this file to describe your project's visual style.)
`;
}
