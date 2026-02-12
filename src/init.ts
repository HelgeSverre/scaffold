import { resolve, join } from "path";
import { existsSync, mkdirSync, readdirSync } from "fs";
import { extractStyle, getMinimalPromptMd } from "./ai";

const STARTER_YAML = `# Scaffold Schema
# Define your data entities here.
# See SPEC-v2.md for full documentation.

name: My Prototype

entities:
  # Example entity — uncomment and customize:
  #
  # Task:
  #   properties:
  #     - name
  #     - { name: description, type: text, nullable: true }
  #     - { name: status, type: enum, values: [todo, in_progress, done], default: todo }
  #     - { name: priority, type: integer, default: 0 }
  #   seed:
  #     - { name: "Example task", status: todo }
`;

const STARTER_INDEX = `import { startServer } from "scaffold";

startServer({
  dir: import.meta.dir,
  port: Number(process.env.PORT) || 5555,
});
`;

export async function init(dir: string) {
  const targetDir = resolve(dir);

  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  // Guard: don't overwrite existing scaffold.yaml/.yml
  const yamlPath = join(targetDir, "scaffold.yaml");
  const ymlPath = join(targetDir, "scaffold.yml");
  if (existsSync(yamlPath) || existsSync(ymlPath)) {
    console.warn("scaffold.yaml already exists — skipping init (delete it to re-initialize)");
    return;
  }

  // Write scaffold.yaml
  await Bun.write(yamlPath, STARTER_YAML);
  console.log("  Created scaffold.yaml");

  // Write index.ts
  const indexPath = join(targetDir, "index.ts");
  if (!existsSync(indexPath)) {
    await Bun.write(indexPath, STARTER_INDEX);
    console.log("  Created index.ts");
  }

  // Create functions directory
  const functionsDir = join(targetDir, "functions");
  if (!existsSync(functionsDir)) {
    mkdirSync(functionsDir, { recursive: true });
    await Bun.write(join(functionsDir, ".gitkeep"), "");
    console.log("  Created functions/");
  }

  // Create .scaffold directory with editor assets
  const scaffoldDir = join(targetDir, ".scaffold");
  if (!existsSync(scaffoldDir)) {
    mkdirSync(scaffoldDir, { recursive: true });
  }

  // Copy editor assets from package's src/assets/
  const assetsSource = join(import.meta.dir, "assets");
  const editorJsSrc = join(assetsSource, "editor.js");
  const editorCssSrc = join(assetsSource, "editor.css");

  if (existsSync(editorJsSrc)) {
    await Bun.write(join(scaffoldDir, "editor.js"), Bun.file(editorJsSrc));
  }
  if (existsSync(editorCssSrc)) {
    await Bun.write(join(scaffoldDir, "editor.css"), Bun.file(editorCssSrc));
  }
  console.log("  Created .scaffold/");

  // Generate .scaffold/prompt.md
  const promptMdPath = join(scaffoldDir, "prompt.md");
  if (!existsSync(promptMdPath)) {
    const htmlFiles = readdirSync(targetDir).filter((f) => f.endsWith(".html") && !f.startsWith("."));
    const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

    if (htmlFiles.length > 0 && hasApiKey) {
      try {
        console.log("  Analyzing HTML files for style guide...");
        await extractStyle(targetDir);
        console.log("  Created .scaffold/prompt.md (AI-generated style guide)");
      } catch (err: any) {
        // Fall back to minimal if extraction fails
        await Bun.write(promptMdPath, getMinimalPromptMd());
        console.log("  Created .scaffold/prompt.md (minimal template)");
      }
    } else {
      await Bun.write(promptMdPath, getMinimalPromptMd());
      console.log("  Created .scaffold/prompt.md (minimal template)");
    }
  }

  console.log(`\nScaffold initialized in ${targetDir}`);
  console.log("Next steps:");
  console.log("  1. Edit scaffold.yaml to define your data entities");
  console.log("  2. Run: bun run index.ts");
}
