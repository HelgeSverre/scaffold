import { existsSync, readdirSync } from "fs";
import { join, resolve } from "path";
import type { ScaffoldContext } from "./types";

export async function loadFunctions(functionsDir: string, ctx: ScaffoldContext) {
  if (!existsSync(functionsDir)) return;

  const files = readdirSync(functionsDir).filter((f) => f.endsWith(".ts") || f.endsWith(".js"));

  for (const file of files) {
    const fullPath = resolve(join(functionsDir, file));
    try {
      const mod = await import(fullPath);
      if (typeof mod.default === "function") {
        mod.default(ctx);
      }
    } catch (err) {
      console.error(`Error loading function ${file}:`, err);
    }
  }
}
