#!/usr/bin/env bun

import { Command } from "commander";
import { init } from "./init";

const program = new Command();

program
  .name("scaffold")
  .description("Bun-powered tool for running, persisting, and live-editing HTML prototypes")
  .version("0.1.0");

program
  .command("init [dir]")
  .description("Initialize a scaffold project")
  .action(async (dir: string = ".") => {
    await init(dir);
  });

program
  .command("dev [dir]")
  .description("Start development server")
  .action(async (dir: string = ".") => {
    const indexPath = `${dir}/index.ts`;
    const proc = Bun.spawn(["bun", "run", indexPath], {
      cwd: process.cwd(),
      stdio: ["inherit", "inherit", "inherit"],
    });
    await proc.exited;
    process.exit(proc.exitCode ?? 0);
  });

program.parse();
