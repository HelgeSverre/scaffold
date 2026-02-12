import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ─── HTML Utils Tests ─────────────────────────────────────────────────────────

import {
  extractTitle,
  validateHtmlStructure,
  stripCodeFences,
  replaceElementByXpath,
} from "../src/html-utils";

describe("extractTitle", () => {
  test("extracts title from HTML", () => {
    expect(extractTitle("<html><head><title>My Page</title></head></html>")).toBe("My Page");
  });

  test("returns empty string when no title", () => {
    expect(extractTitle("<html><body></body></html>")).toBe("");
  });

  test("handles case insensitive", () => {
    expect(extractTitle("<TITLE>Hello</TITLE>")).toBe("Hello");
  });
});

describe("validateHtmlStructure", () => {
  test("validates complete HTML", () => {
    expect(
      validateHtmlStructure("<!DOCTYPE html><html><head></head><body></body></html>")
    ).toBe(true);
  });

  test("rejects missing doctype", () => {
    expect(validateHtmlStructure("<html><body></body></html>")).toBe(false);
  });

  test("rejects missing body", () => {
    expect(validateHtmlStructure("<!DOCTYPE html><html></html>")).toBe(false);
  });

  test("rejects missing closing html", () => {
    expect(validateHtmlStructure("<!DOCTYPE html><html><body></body>")).toBe(false);
  });
});

describe("stripCodeFences", () => {
  test("strips html code fences", () => {
    const input = "```html\n<div>hello</div>\n```";
    expect(stripCodeFences(input)).toBe("<div>hello</div>");
  });

  test("strips plain code fences", () => {
    const input = "```\n<div>hello</div>\n```";
    expect(stripCodeFences(input)).toBe("<div>hello</div>");
  });

  test("returns text as-is when no fences", () => {
    const input = "<div>hello</div>";
    expect(stripCodeFences(input)).toBe("<div>hello</div>");
  });

  test("handles code fences with surrounding text", () => {
    const input = "Here is the HTML:\n```html\n<div>hello</div>\n```\nDone.";
    expect(stripCodeFences(input)).toBe("<div>hello</div>");
  });
});

describe("replaceElementByXpath", () => {
  const html = `<!DOCTYPE html>
<html>
<body>
  <div class="container">
    <h1>Title</h1>
    <div class="grid">
      <div class="card">Card 1</div>
      <div class="card">Card 2</div>
    </div>
    <footer>Footer</footer>
  </div>
</body>
</html>`;

  test("replaces element by simple xpath", () => {
    const result = replaceElementByXpath(html, "body > div.container > h1", "<h1>New Title</h1>");
    expect(result).not.toBeNull();
    expect(result).toContain("<h1>New Title</h1>");
    expect(result).not.toContain("<h1>Title</h1>");
  });

  test("replaces nested element", () => {
    const result = replaceElementByXpath(
      html,
      "body > div.container > div.grid",
      '<div class="grid"><div>Replaced</div></div>'
    );
    expect(result).not.toBeNull();
    expect(result).toContain("Replaced");
    expect(result).not.toContain("Card 1");
  });

  test("returns null for non-matching xpath", () => {
    const result = replaceElementByXpath(html, "body > div.nonexistent", "<div>New</div>");
    expect(result).toBeNull();
  });

  test("preserves surrounding content", () => {
    const result = replaceElementByXpath(html, "body > div.container > footer", "<footer>New Footer</footer>");
    expect(result).not.toBeNull();
    expect(result).toContain("Card 1");
    expect(result).toContain("Card 2");
    expect(result).toContain("<footer>New Footer</footer>");
  });

  test("handles nth-child selector", () => {
    const result = replaceElementByXpath(
      html,
      "body > div.container > div.grid > div.card:nth-child(2)",
      '<div class="card">Updated Card 2</div>'
    );
    expect(result).not.toBeNull();
    expect(result).toContain("Card 1");
    expect(result).toContain("Updated Card 2");
    expect(result).not.toContain(">Card 2<");
  });
});

// ─── Component Tests ──────────────────────────────────────────────────────────

import { scanComponents, parseComponentContent, writeComponent } from "../src/components";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "scaffold-ai-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("parseComponentContent", () => {
  test("parses component with frontmatter", () => {
    const content = `---
name: Stat Card
description: A metric card
category: data-display
props:
  - { name: value, description: "The number", default: "1234" }
---
<div class="card">Content</div>`;

    const result = parseComponentContent(content);
    expect(result.meta.name).toBe("Stat Card");
    expect(result.meta.description).toBe("A metric card");
    expect(result.meta.category).toBe("data-display");
    expect(result.meta.props).toHaveLength(1);
    expect(result.meta.props![0].name).toBe("value");
    expect(result.html).toBe('<div class="card">Content</div>');
  });

  test("handles component without frontmatter", () => {
    const content = '<div class="card">No frontmatter</div>';
    const result = parseComponentContent(content, "/tmp/my-card.html");
    expect(result.meta.name).toBe("my-card");
    expect(result.html).toBe(content);
  });

  test("handles empty props", () => {
    const content = `---
name: Simple
description: A simple component
category: layout
---
<div>Hello</div>`;

    const result = parseComponentContent(content);
    expect(result.meta.name).toBe("Simple");
    expect(result.meta.props).toBeUndefined();
  });
});

describe("scanComponents", () => {
  test("returns empty array when no components dir", () => {
    expect(scanComponents(tempDir)).toEqual([]);
  });

  test("scans components from directory structure", () => {
    const compDir = join(tempDir, ".scaffold", "components", "data-display");
    mkdirSync(compDir, { recursive: true });

    writeFileSync(
      join(compDir, "stat-card.html"),
      `---
name: Stat Card
description: A metric card
category: data-display
---
<div class="card">Card</div>`
    );

    const components = scanComponents(tempDir);
    expect(components).toHaveLength(1);
    expect(components[0].name).toBe("Stat Card");
    expect(components[0].category).toBe("data-display");
    expect(components[0].path).toBe(".scaffold/components/data-display/stat-card.html");
  });

  test("scans multiple categories", () => {
    const dataDir = join(tempDir, ".scaffold", "components", "data-display");
    const formsDir = join(tempDir, ".scaffold", "components", "forms");
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(formsDir, { recursive: true });

    writeFileSync(
      join(dataDir, "card.html"),
      `---\nname: Card\ndescription: A card\ncategory: data-display\n---\n<div>Card</div>`
    );
    writeFileSync(
      join(formsDir, "input.html"),
      `---\nname: Input\ndescription: An input\ncategory: forms\n---\n<input />`
    );

    const components = scanComponents(tempDir);
    expect(components).toHaveLength(2);
    const names = components.map((c) => c.name);
    expect(names).toContain("Card");
    expect(names).toContain("Input");
  });
});

describe("writeComponent", () => {
  test("writes component file", async () => {
    await writeComponent(tempDir, "layout", "header", "---\nname: Header\n---\n<header>Hi</header>");

    const content = readFileSync(join(tempDir, ".scaffold", "components", "layout", "header.html"), "utf-8");
    expect(content).toContain("<header>Hi</header>");
  });

  test("creates category directory if needed", async () => {
    await writeComponent(tempDir, "new-category", "widget", "<div>Widget</div>");

    const content = readFileSync(join(tempDir, ".scaffold", "components", "new-category", "widget.html"), "utf-8");
    expect(content).toBe("<div>Widget</div>");
  });
});

// ─── AI Context Tests ─────────────────────────────────────────────────────────

import { buildAIContext, buildSystemPrompt } from "../src/ai";

describe("buildAIContext", () => {
  test("assembles context from project directory", () => {
    writeFileSync(join(tempDir, "test.html"), "<!DOCTYPE html><html><head><title>Test</title></head><body></body></html>");
    const scaffoldDir = join(tempDir, ".scaffold");
    mkdirSync(scaffoldDir, { recursive: true });
    writeFileSync(join(scaffoldDir, "prompt.md"), "# Style Guide\nDark theme");

    const ctx = buildAIContext(tempDir, "name: Test\nentities: {}");

    expect(ctx.scaffoldYml).toBe("name: Test\nentities: {}");
    expect(ctx.promptMd).toContain("# Style Guide");
    expect(ctx.projectPages).toHaveLength(1);
    expect(ctx.projectPages[0].filename).toBe("test.html");
    expect(ctx.projectPages[0].title).toBe("Test");
  });

  test("handles missing prompt.md", () => {
    const ctx = buildAIContext(tempDir, "entities: {}");
    expect(ctx.promptMd).toBe("");
  });

  test("includes optional fields when provided", () => {
    const ctx = buildAIContext(tempDir, "entities: {}", {
      currentPageHtml: "<div>current</div>",
      selectedHtml: "<span>selected</span>",
    });
    expect(ctx.currentPageHtml).toBe("<div>current</div>");
    expect(ctx.selectedHtml).toBe("<span>selected</span>");
  });
});

describe("buildSystemPrompt", () => {
  test("includes core prompt and project data", () => {
    const ctx = buildAIContext(tempDir, "name: Test\nentities: {}");
    const prompt = buildSystemPrompt(ctx);

    expect(prompt).toContain("expert frontend developer");
    expect(prompt).toContain("DATA MODEL:");
    expect(prompt).toContain("name: Test");
  });

  test("includes prompt.md content", () => {
    const scaffoldDir = join(tempDir, ".scaffold");
    mkdirSync(scaffoldDir, { recursive: true });
    writeFileSync(join(scaffoldDir, "prompt.md"), "# Custom Style Guide\nUse dark theme.");

    const ctx = buildAIContext(tempDir, "entities: {}");
    const prompt = buildSystemPrompt(ctx);

    expect(prompt).toContain("# Custom Style Guide");
    expect(prompt).toContain("Use dark theme.");
  });

  test("includes page list", () => {
    writeFileSync(
      join(tempDir, "page1.html"),
      "<!DOCTYPE html><html><head><title>Page One</title></head><body></body></html>"
    );

    const ctx = buildAIContext(tempDir, "entities: {}");
    const prompt = buildSystemPrompt(ctx);

    expect(prompt).toContain("EXISTING PAGES:");
    expect(prompt).toContain("page1.html");
    expect(prompt).toContain("Page One");
  });

  test("includes custom instructions from config", () => {
    const ctx = buildAIContext(tempDir, "entities: {}");
    const prompt = buildSystemPrompt(ctx, { instructions: "Always use Norwegian names." });

    expect(prompt).toContain("Always use Norwegian names.");
  });

  test("includes component list when provided", () => {
    const ctx = buildAIContext(tempDir, "entities: {}", {
      components: [
        { name: "stat-card", description: "Metric card", category: "data-display", path: "" },
      ],
    });
    const prompt = buildSystemPrompt(ctx);

    expect(prompt).toContain("AVAILABLE COMPONENTS:");
    expect(prompt).toContain("stat-card");
    expect(prompt).toContain("Metric card");
  });
});

// ─── Prompt Template Tests ────────────────────────────────────────────────────

import {
  editScopedPrompt,
  editFullPagePrompt,
  createPagePrompt,
  generateComponentPrompt,
  extractComponentPrompt,
} from "../src/ai-prompts";

describe("editScopedPrompt", () => {
  test("includes xpath, selected HTML, and instruction", () => {
    const prompt = editScopedPrompt("body > div.grid", "<div class='grid'>content</div>", "Make it 4 columns");
    expect(prompt).toContain("body > div.grid");
    expect(prompt).toContain("<div class='grid'>content</div>");
    expect(prompt).toContain("Make it 4 columns");
  });
});

describe("editFullPagePrompt", () => {
  test("includes current page and instruction", () => {
    const prompt = editFullPagePrompt("<html>page</html>", "Add a footer");
    expect(prompt).toContain("<html>page</html>");
    expect(prompt).toContain("Add a footer");
  });
});

describe("createPagePrompt", () => {
  test("generates basic creation prompt", () => {
    const prompt = createPagePrompt("new-page", "A dashboard page");
    expect(prompt).toContain("new-page");
    expect(prompt).toContain("A dashboard page");
    expect(prompt).toContain("self-contained HTML document");
  });

  test("includes base page when provided", () => {
    const prompt = createPagePrompt("new-page", "Dashboard", "<html>base page</html>");
    expect(prompt).toContain("<reference_page>");
    expect(prompt).toContain("<html>base page</html>");
  });

  test("includes components when provided", () => {
    const prompt = createPagePrompt("new-page", "Dashboard", undefined, [
      { name: "stat-card", category: "data-display", description: "Metric card" },
    ]);
    expect(prompt).toContain("<available_components>");
    expect(prompt).toContain("stat-card");
  });
});

describe("generateComponentPrompt", () => {
  test("includes component details", () => {
    const prompt = generateComponentPrompt("progress-bar", "data-display", "A horizontal progress bar");
    expect(prompt).toContain("progress-bar");
    expect(prompt).toContain("data-display");
    expect(prompt).toContain("A horizontal progress bar");
    expect(prompt).toContain("YAML frontmatter");
  });
});

describe("extractComponentPrompt", () => {
  test("includes element HTML", () => {
    const prompt = extractComponentPrompt('<div class="card">Card content</div>');
    expect(prompt).toContain('<div class="card">Card content</div>');
    expect(prompt).toContain("YAML frontmatter");
  });
});
