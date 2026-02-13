import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { AIConfig, ComponentMeta } from "./types";
import type { PageInfo } from "./html";
import { buildAIContext, buildSystemPrompt, streamAI, claudeCode, isClaudeCodeAvailable } from "./ai";
import { editScopedPrompt, editFullPagePrompt, createPagePrompt, generateComponentPrompt, extractComponentPrompt } from "./ai-prompts";
import { stripCodeFences, validateHtmlStructure } from "./html-utils";
import { scanComponents, parseComponent, writeComponent, sanitizeComponentName } from "./components";
import { scaffoldPath } from "./paths";
import { log } from "./log";

// ─── SSE Helper ───────────────────────────────────────────────────────────────

function createSSEStream(
  work: (emit: (event: string, data: any) => void) => Promise<void>
): Response {
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (event: string, data: any) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        await work(emit);
      } catch (err: any) {
        const msg = String(err?.message || err);
        log.error(`AI: ${msg}`);
        emit("error", { message: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// ─── Route Registration ───────────────────────────────────────────────────────

interface AIRoutesContext {
  router: { add: (method: string, pattern: string, handler: any) => void };
  dir: string;
  pages: PageInfo[];
  config: { ai?: AIConfig };
  yamlContent: string;
  wsManager: { broadcast: (page: string, msg: object) => void };
  recentlySaved: Set<string>;
}

export function registerAIRoutes(ctx: AIRoutesContext) {
  const { router, dir, pages, config, yamlContent, wsManager, recentlySaved } = ctx;

  // ─── POST /_/ai/edit ──────────────────────────────────────────────────────

  router.add("POST", "_/ai/edit", async (req: Request) => {
    const body = await req.json();
    const { page, prompt, selection } = body as {
      page: string;
      prompt: string;
      selection?: { xpath: string; html: string };
    };

    const filePath = join(dir, `${page}.html`);
    if (!existsSync(filePath)) {
      return new Response(JSON.stringify({ error: "Page not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const currentPageHtml = readFileSync(filePath, "utf-8");

    return createSSEStream(async (emit) => {
      log.ai("Edit", page);
      emit("status", { message: "Analyzing page structure..." });

      // Build context
      const components = loadComponentsQuiet(dir);
      const aiCtx = buildAIContext(dir, yamlContent, {
        currentPageHtml,
        selectedHtml: selection?.html,
        components,
      });
      const systemPrompt = buildSystemPrompt(aiCtx, config.ai);

      // Build user prompt
      let userPrompt: string;
      if (selection) {
        userPrompt = editScopedPrompt(selection.xpath, selection.html, prompt);
      } else {
        userPrompt = editFullPagePrompt(currentPageHtml, prompt);
      }

      emit("status", { message: "Generating edit..." });

      // Stream AI response
      let result = "";
      for await (const chunk of streamAI(systemPrompt, userPrompt, config.ai)) {
        result += chunk;
        emit("chunk", { html: chunk });
      }

      result = stripCodeFences(result).trim();

      if (selection) {
        // Scoped edit: return HTML to client for DOM swap + client-side save
        log.ai("Edit done", `${page} — scoped edit, ${result.split("\n").length} lines`);
        emit("done", { html: result });
      } else {
        // Full-page edit: write to disk and broadcast reload
        recentlySaved.add(page);
        setTimeout(() => recentlySaved.delete(page), 500);
        await Bun.write(filePath, result);
        wsManager.broadcast(page, { type: "reload", page });

        const linesChanged = result.split("\n").length;
        log.ai("Edit done", `${page} — ${linesChanged} lines`);
        emit("done", { page, linesChanged });
      }
    });
  });

  // ─── POST /_/ai/create ─────────────────────────────────────────────────────

  router.add("POST", "_/ai/create", async (req: Request) => {
    const body = await req.json();
    const { filename, prompt, basePage } = body as {
      filename: string;
      prompt: string;
      basePage?: string;
    };

    // Sanitize filename
    const safeName = filename.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase();
    if (!safeName) {
      return new Response(JSON.stringify({ error: "Invalid filename" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const targetPath = join(dir, `${safeName}.html`);
    if (existsSync(targetPath)) {
      return new Response(JSON.stringify({ error: "File already exists" }), {
        status: 409,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    return createSSEStream(async (emit) => {
      log.ai("Create", safeName + ".html");
      emit("status", { message: `Generating ${safeName}.html...` });

      // Load base page HTML if specified
      let basePageHtml: string | undefined;
      if (basePage) {
        const basePath = join(dir, `${basePage}.html`);
        if (existsSync(basePath)) {
          basePageHtml = readFileSync(basePath, "utf-8");
        }
      }

      const components = loadComponentsQuiet(dir);
      const aiCtx = buildAIContext(dir, yamlContent, { basePageHtml, components });
      const systemPrompt = buildSystemPrompt(aiCtx, config.ai);

      const componentList = components?.map((c) => ({
        name: c.name,
        category: c.category,
        description: c.description,
      }));

      const userPrompt = createPagePrompt(safeName, prompt, basePageHtml, componentList);

      emit("status", { message: "Building page content..." });

      let result = "";
      for await (const chunk of streamAI(systemPrompt, userPrompt, config.ai)) {
        result += chunk;
        emit("chunk", { html: chunk });
      }

      result = stripCodeFences(result).trim();

      // Validate and write
      if (!validateHtmlStructure(result)) {
        // Try Claude Code fallback if available
        if (config.ai?.prefer_claude_code && isClaudeCodeAvailable()) {
          emit("status", { message: "Retrying with Claude Code CLI..." });
          const ccPrompt = `Create a file called ${safeName}.html in the current directory. ${prompt}\n\nStyle reference: look at the existing .html files in this directory and match their design system exactly.\nData model: read .scaffold/scaffold.yaml for the data schema.`;
          result = await claudeCode(ccPrompt, dir);
          result = stripCodeFences(result).trim();
        }
      }

      await Bun.write(targetPath, result);

      // Update pages list
      pages.push({ name: safeName, file: targetPath });

      // Broadcast
      wsManager.broadcast("__index__", { type: "reload", page: "__index__" });

      const lines = result.split("\n").length;
      log.ai("Create done", `${safeName}.html — ${lines} lines`);
      emit("done", { filename: `${safeName}.html`, url: `/${safeName}`, lines });
    });
  });

  // ─── GET /_/ai/components ───────────────────────────────────────────────────

  router.add("GET", "_/ai/components", async () => {
    const components = loadComponentsQuiet(dir);
    return new Response(JSON.stringify({ components: components || [] }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  });

  // ─── GET /_/ai/components/:category/:name ───────────────────────────────────

  router.add("GET", "_/ai/components/:category/:name", async (_req: Request, params: Record<string, string>) => {
    const safeName = sanitizeComponentName(params.name);
    const compPath = scaffoldPath(dir, "components", params.category, `${safeName}.html`);
    if (!existsSync(compPath)) {
      return new Response(JSON.stringify({ error: "Component not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const parsed = parseComponent(compPath);
    return new Response(JSON.stringify({ meta: parsed.meta, html: parsed.html }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  });

  // ─── POST /_/ai/components/generate ─────────────────────────────────────────

  router.add("POST", "_/ai/components/generate", async (req: Request) => {
    const body = await req.json();
    const { prompt: desc, category, name } = body as {
      prompt: string;
      category: string;
      name: string;
    };

    return createSSEStream(async (emit) => {
      log.ai("Generate component", `${category}/${name}`);
      emit("status", { message: `Generating ${name} component...` });

      const aiCtx = buildAIContext(dir, yamlContent);
      const systemPrompt = buildSystemPrompt(aiCtx, config.ai);
      const userPrompt = generateComponentPrompt(name, category, desc);

      let result = "";
      for await (const chunk of streamAI(systemPrompt, userPrompt, config.ai)) {
        result += chunk;
        emit("chunk", { html: chunk });
      }

      result = stripCodeFences(result).trim();

      // Write component file
      await writeComponent(dir, category, name, result);

      log.ai("Generate done", `${category}/${name}`);
      emit("done", { name, category, path: `.scaffold/components/${category}/${name}.html` });
    });
  });

  // ─── POST /_/ai/components/extract ──────────────────────────────────────────

  router.add("POST", "_/ai/components/extract", async (req: Request) => {
    const body = await req.json();
    const { html, suggestedName, category } = body as {
      html: string;
      suggestedName: string;
      category: string;
    };

    log.ai("Extract component", suggestedName);

    const aiCtx = buildAIContext(dir, yamlContent);
    const systemPrompt = buildSystemPrompt(aiCtx, config.ai);
    const userPrompt = extractComponentPrompt(html);

    let frontmatter = "";
    for await (const chunk of streamAI(systemPrompt, userPrompt, config.ai)) {
      frontmatter += chunk;
    }

    frontmatter = frontmatter.trim();

    // Combine frontmatter with original HTML
    const content = frontmatter.includes("---")
      ? `${frontmatter}\n${html}`
      : `---\nname: ${suggestedName}\ndescription: Extracted component\ncategory: ${category}\n---\n${html}`;

    const name = sanitizeComponentName(suggestedName);
    await writeComponent(dir, category, name, content);

    log.ai("Extract done", `${category}/${name}`);
    return new Response(JSON.stringify({ name, category, path: `.scaffold/components/${category}/${name}.html` }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  });

  // ─── POST /_/ai/components/edit ─────────────────────────────────────────────

  router.add("POST", "_/ai/components/edit", async (req: Request) => {
    const body = await req.json();
    const { component, prompt: instruction } = body as {
      component: string; // "category/name"
      prompt: string;
    };

    const [cat, name] = component.split("/");
    const compPath = scaffoldPath(dir, "components", cat, `${name}.html`);

    if (!existsSync(compPath)) {
      return new Response(JSON.stringify({ error: "Component not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const parsed = parseComponent(compPath);

    return createSSEStream(async (emit) => {
      log.ai("Edit component", component);
      emit("status", { message: `Editing ${name} component...` });

      const aiCtx = buildAIContext(dir, yamlContent);
      const systemPrompt = buildSystemPrompt(aiCtx, config.ai);

      const userPrompt = `Here is an existing component:

<component>
${readFileSync(compPath, "utf-8")}
</component>

Modify this component according to the instruction. Return the complete component file including YAML frontmatter.

Instruction: ${instruction}`;

      let result = "";
      for await (const chunk of streamAI(systemPrompt, userPrompt, config.ai)) {
        result += chunk;
        emit("chunk", { html: chunk });
      }

      result = stripCodeFences(result).trim();
      await Bun.write(compPath, result);

      log.ai("Edit component done", component);
      emit("done", { name, category: cat, path: `.scaffold/components/${cat}/${name}.html` });
    });
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadComponentsQuiet(dir: string): ComponentMeta[] | undefined {
  try {
    const components = scanComponents(dir);
    return components.length > 0 ? components : undefined;
  } catch {
    return undefined;
  }
}
