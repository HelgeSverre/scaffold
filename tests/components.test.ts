import { describe, test, expect } from "bun:test";
import { parseComponentContent } from "../src/components";

describe("parseComponentContent", () => {
  test("parses standard frontmatter + html", () => {
    const content = `---
name: my-card
description: A card component
category: data-display
---
<div class="card">Hello</div>`;

    const result = parseComponentContent(content);
    expect(result.meta.name).toBe("my-card");
    expect(result.meta.description).toBe("A card component");
    expect(result.meta.category).toBe("data-display");
    expect(result.html).toBe('<div class="card">Hello</div>');
  });

  test("parses content wrapped in ```yaml code fences", () => {
    const content = "```yaml\n---\nname: fenced-component\ndescription: Wrapped in yaml fences\ncategory: navigation\n---\n<div>fenced content</div>\n```";

    const result = parseComponentContent(content);
    expect(result.meta.name).toBe("fenced-component");
    expect(result.meta.description).toBe("Wrapped in yaml fences");
    expect(result.meta.category).toBe("navigation");
    expect(result.html).toBe("<div>fenced content</div>");
  });

  test("parses content wrapped in ```html code fences", () => {
    const content = "```html\n---\nname: html-fenced\ndescription: Wrapped in html fences\ncategory: layout\n---\n<section>content</section>\n```";

    const result = parseComponentContent(content);
    expect(result.meta.name).toBe("html-fenced");
    expect(result.meta.category).toBe("layout");
    expect(result.html).toBe("<section>content</section>");
  });

  test("falls back to filename when no frontmatter", () => {
    const content = "<div>just html</div>";
    const result = parseComponentContent(content, "/path/to/my-widget.html");
    expect(result.meta.name).toBe("my-widget");
    expect(result.html).toBe("<div>just html</div>");
  });

  test("parses props from frontmatter", () => {
    const content = `---
name: stat-card
description: A stat card
category: data-display
props:
  - { name: value, description: "The value", default: "42" }
  - { name: label, description: "The label", default: "Users" }
---
<div>content</div>`;

    const result = parseComponentContent(content);
    expect(result.meta.props).toHaveLength(2);
    expect(result.meta.props![0].name).toBe("value");
    expect(result.meta.props![0].default).toBe("42");
    expect(result.meta.props![1].name).toBe("label");
  });
});
