#!/usr/bin/env bun

import { Command } from "commander";
import { init } from "./init";
import { resolve } from "path";
import { log } from "./log";

const program = new Command();

program
  .name("scaffold")
  .description("Bun-powered tool for running, persisting, and live-editing HTML prototypes")
  .version("0.1.1");

program
  .command("init [dir]")
  .description("Initialize a scaffold project")
  .action(async (dir: string = ".") => {
    await init(dir);
  });

program
  .command("dev [dir]")
  .description("Start development server")
  .option("-p, --port <number>", "Port to run on")
  .action(async (dir: string = ".", opts: { port?: string }) => {
    const indexPath = `${dir}/index.ts`;
    const env = { ...process.env };
    if (opts.port) {
      env.PORT = opts.port;
    }
    const proc = Bun.spawn(["bun", "run", indexPath], {
      cwd: process.cwd(),
      stdio: ["inherit", "inherit", "inherit"],
      env,
    });
    await proc.exited;
    process.exit(proc.exitCode ?? 0);
  });

program
  .command("extract-style [dir]")
  .description("Extract style guide from HTML files into .scaffold/prompt.md")
  .action(async (dir: string = ".") => {
    const { extractStyle } = await import("./ai");
    const { existsSync, readFileSync } = await import("fs");
    const { join } = await import("path");

    const targetDir = resolve(dir);
    const yamlPath = existsSync(join(targetDir, "scaffold.yaml"))
      ? join(targetDir, "scaffold.yaml")
      : join(targetDir, "scaffold.yml");

    let aiConfig;
    if (existsSync(yamlPath)) {
      const { parseSchema } = await import("./schema");
      const config = parseSchema(readFileSync(yamlPath, "utf-8"));
      aiConfig = config.ai;
    }

    try {
      log.step("Extracting style guide from HTML files\u2026");
      const result = await extractStyle(targetDir, aiConfig);
      log.step("Style guide written to .scaffold/prompt.md", `(${result.split("\n").length} lines)`);
    } catch (err: any) {
      log.error(err.message);
      process.exit(1);
    }
  });

program.parse();
