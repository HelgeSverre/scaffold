import { join } from "path";
import { existsSync, readdirSync, readFileSync, mkdirSync } from "fs";
import { parse as parseYaml } from "yaml";
import type { ComponentMeta, ComponentProp } from "./types";
import { scaffoldPath } from "./paths";

// ─── Component Discovery ─────────────────────────────────────────────────────

export function scanComponents(dir: string): ComponentMeta[] {
  const componentsDir = scaffoldPath(dir, "components");
  if (!existsSync(componentsDir)) return [];

  const components: ComponentMeta[] = [];

  // One level of subdirectories = categories
  const entries = readdirSync(componentsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const category = entry.name;
      const categoryDir = join(componentsDir, category);
      const files = readdirSync(categoryDir).filter((f) => f.endsWith(".html"));

      for (const file of files) {
        const filePath = join(categoryDir, file);
        try {
          const parsed = parseComponent(filePath);
          components.push({
            ...parsed.meta,
            path: `.scaffold/components/${category}/${file}`,
          });
        } catch {
          // Skip malformed components
        }
      }
    }
  }

  return components;
}

// ─── Component Parsing ────────────────────────────────────────────────────────

export function parseComponent(filePath: string): { meta: ComponentMeta; html: string } {
  const content = readFileSync(filePath, "utf-8");
  return parseComponentContent(content, filePath);
}

export function parseComponentContent(
  content: string,
  filePath: string = ""
): { meta: ComponentMeta; html: string } {
  // Split on frontmatter delimiters
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);

  if (!fmMatch) {
    // No frontmatter — derive basic meta from filename
    const name = filePath.split("/").pop()?.replace(/\.html$/, "") || "unknown";
    return {
      meta: {
        name,
        description: "",
        category: "uncategorized",
        path: filePath,
      },
      html: content,
    };
  }

  const yamlStr = fmMatch[1];
  const html = fmMatch[2].trim();

  const parsed = parseYaml(yamlStr) as any;

  const props: ComponentProp[] | undefined = parsed.props?.map((p: any) => ({
    name: p.name,
    description: p.description,
    default: p.default,
  }));

  const meta: ComponentMeta = {
    name: parsed.name || "unknown",
    description: parsed.description || "",
    category: parsed.category || "uncategorized",
    path: filePath,
    props,
    alpine: parsed.alpine,
  };

  return { meta, html };
}

// ─── Component Writing ────────────────────────────────────────────────────────

export async function writeComponent(
  dir: string,
  category: string,
  name: string,
  content: string
): Promise<string> {
  const categoryDir = scaffoldPath(dir, "components", category);
  if (!existsSync(categoryDir)) {
    mkdirSync(categoryDir, { recursive: true });
  }

  const filePath = join(categoryDir, `${name}.html`);
  await Bun.write(filePath, content);
  return filePath;
}
