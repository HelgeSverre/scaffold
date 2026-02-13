import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { scanHtmlFiles, serveHtml, generateIndexPage } from "../src/html";
import { stripCodeFences } from "../src/html-utils";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "scaffold-test-"));
  writeFileSync(join(tempDir, "01-home.html"), "<!DOCTYPE html><html><body><h1>Home</h1></body></html>");
  writeFileSync(join(tempDir, "02-about.html"), "<!DOCTYPE html><html><body><h1>About</h1></body></html>");
  writeFileSync(join(tempDir, ".hidden.html"), "<html></html>");
  writeFileSync(join(tempDir, "readme.md"), "# Not HTML");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("scanHtmlFiles", () => {
  test("finds .html files in directory", () => {
    const pages = scanHtmlFiles(tempDir);
    const names = pages.map((p) => p.name);
    expect(names).toContain("01-home");
    expect(names).toContain("02-about");
  });

  test("excludes hidden files", () => {
    const pages = scanHtmlFiles(tempDir);
    const names = pages.map((p) => p.name);
    expect(names).not.toContain(".hidden");
  });

  test("excludes non-html files", () => {
    const pages = scanHtmlFiles(tempDir);
    expect(pages.every((p) => p.file.endsWith(".html"))).toBe(true);
  });

  test("returns empty for non-existent directory", () => {
    const pages = scanHtmlFiles("/nonexistent");
    expect(pages).toEqual([]);
  });
});

describe("serveHtml", () => {
  test("injects editor script before </body>", async () => {
    const filePath = join(tempDir, "01-home.html");
    const response = await serveHtml(filePath, "01-home", 1234);
    const html = await response.text();

    expect(html).toContain("window.__SCAFFOLD__");
    expect(html).toContain('"page":"01-home"');
    expect(html).toContain("/_/assets/editor.js");
    expect(html).toContain("/_/assets/editor.css");
    // Injection should be before </body>
    const editorIdx = html.indexOf("editor.js");
    const bodyIdx = html.indexOf("</body>");
    expect(editorIdx).toBeLessThan(bodyIdx);
  });

  test("returns 404 for non-existent file", async () => {
    const response = await serveHtml(join(tempDir, "missing.html"), "missing", 1234);
    expect(response.status).toBe(404);
  });

  test("sets correct content type", async () => {
    const filePath = join(tempDir, "01-home.html");
    const response = await serveHtml(filePath, "01-home", 1234);
    expect(response.headers.get("Content-Type")).toContain("text/html");
  });
});

describe("stripCodeFences", () => {
  test("strips ```html fences", () => {
    const input = "```html\n<div>hello</div>\n```";
    expect(stripCodeFences(input)).toBe("<div>hello</div>");
  });

  test("strips ```yaml fences", () => {
    const input = "```yaml\n---\nname: test\n---\n<div>content</div>\n```";
    expect(stripCodeFences(input)).toBe("---\nname: test\n---\n<div>content</div>");
  });

  test("strips bare ``` fences", () => {
    const input = "```\n<div>hello</div>\n```";
    expect(stripCodeFences(input)).toBe("<div>hello</div>");
  });

  test("strips ```css fences", () => {
    const input = "```css\n.foo { color: red; }\n```";
    expect(stripCodeFences(input)).toBe(".foo { color: red; }");
  });

  test("returns unfenced text as-is", () => {
    const input = "<div>hello</div>";
    expect(stripCodeFences(input)).toBe("<div>hello</div>");
  });
});

describe("generateIndexPage", () => {
  test("generates index with page links", () => {
    const pages = [
      { name: "01-home", file: "/tmp/01-home.html" },
      { name: "02-about", file: "/tmp/02-about.html" },
    ];
    const response = generateIndexPage(pages, 1234);
    expect(response.headers.get("Content-Type")).toContain("text/html");
  });

  test("includes page names in links", async () => {
    const pages = [
      { name: "01-home", file: "/tmp/01-home.html" },
      { name: "02-about", file: "/tmp/02-about.html" },
    ];
    const response = generateIndexPage(pages, 1234);
    const html = await response.text();
    expect(html).toContain('href="/01-home"');
    expect(html).toContain('href="/02-about"');
  });
});
