import { Database } from "bun:sqlite";
import { join, resolve } from "path";
import { existsSync, readFileSync } from "fs";
import { parseSchema, deriveEntityMeta } from "./schema";
import { migrate, seed } from "./migration";
import { createRouter } from "./router";
import { registerCrudRoutes } from "./crud";
import { scanHtmlFiles, serveHtml, generateIndexPage, handleSave } from "./html";
import { createWSManager } from "./websocket";
import { startWatcher } from "./watcher";
import { loadFunctions } from "./functions";
import type { ScaffoldContext, RouteEntry } from "./types";

export async function startServer(options?: { dir?: string; port?: number }) {
  const dir = resolve(options?.dir || ".");
  const port = options?.port || Number(process.env.PORT) || 1234;

  // Parse schema
  const ymlPath = join(dir, "scaffold.yml");
  if (!existsSync(ymlPath)) {
    console.error("Error: scaffold.yml not found in " + dir);
    console.error("Run `scaffold init` first.");
    process.exit(1);
  }

  const yamlContent = readFileSync(ymlPath, "utf-8");
  const config = parseSchema(yamlContent);
  const entities = deriveEntityMeta(config);

  // Open/create database
  const dbPath = join(dir, "scaffold.db");
  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");

  // Migrate and seed
  migrate(db, entities);
  seed(db, entities);

  // Scan HTML files
  const pages = scanHtmlFiles(dir);

  // Set up router
  const router = createRouter();

  // Register CRUD routes
  registerCrudRoutes(router, db, entities);

  // WebSocket manager
  const wsManager = createWSManager();

  // Recently saved set (to suppress watcher on save)
  const recentlySaved = new Set<string>();

  // Load custom functions
  const ctx: ScaffoldContext = {
    db,
    route: (method, path, handler) => {
      router.add(method, path, (req) => handler(req));
    },
    broadcast: (page, message) => wsManager.broadcast(page, message),
    config,
  };
  await loadFunctions(join(dir, "functions"), ctx);

  // Start file watcher
  startWatcher(dir, (page, msg) => wsManager.broadcast(page, msg), recentlySaved);

  // Build page lookup
  const pageMap = new Map(pages.map((p) => [p.name, p.file]));

  const server = Bun.serve({
    port,
    async fetch(req, server) {
      const url = new URL(req.url);
      const pathname = url.pathname;

      // WebSocket upgrade
      if (pathname === "/_/ws") {
        const upgraded = server.upgrade(req, { data: { page: null } });
        if (upgraded) return undefined as any;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      // Internal save endpoint
      if (pathname.startsWith("/_/save/") && req.method === "POST") {
        const page = pathname.slice("/_/save/".length);
        return handleSave(req, page, dir, (p, m) => wsManager.broadcast(p, m), recentlySaved);
      }

      // Internal assets
      if (pathname.startsWith("/_/assets/")) {
        const assetName = pathname.slice("/_/assets/".length);
        // Serve from package's own assets
        const assetPath = join(import.meta.dir, "assets", assetName);
        const file = Bun.file(assetPath);
        if (await file.exists()) {
          const contentType = assetName.endsWith(".js")
            ? "application/javascript"
            : assetName.endsWith(".css")
            ? "text/css"
            : "application/octet-stream";
          return new Response(file, { headers: { "Content-Type": contentType } });
        }
        return new Response("Not found", { status: 404 });
      }

      // API routes
      if (pathname.startsWith("/api/") || pathname === "/api") {
        // CORS preflight for any /api path
        if (req.method === "OPTIONS") {
          return new Response(null, {
            status: 204,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type",
            },
          });
        }

        const match = router.match(req.method, pathname);
        if (match) {
          return match.handler(req, match.params);
        }

        return new Response(JSON.stringify({ error: { message: "Not found", status: 404 } }), {
          status: 404,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }

      // Index page
      if (pathname === "/") {
        return generateIndexPage(pages, port);
      }

      // HTML pages
      const pageName = pathname.slice(1); // strip leading /
      if (pageMap.has(pageName)) {
        return serveHtml(pageMap.get(pageName)!, pageName, port);
      }

      return new Response("Not found", { status: 404 });
    },

    websocket: {
      message(ws, message) {
        wsManager.handleMessage(ws as any, String(message));
      },
      close(ws) {
        wsManager.handleClose(ws as any);
      },
      open(_ws) {
        // No-op, client sends "join" message
      },
    },
  });

  // Startup banner
  const maxPageLen = Math.max(...pages.map((p) => p.name.length), 10);
  const urlBase = `http://localhost:${port}`;
  const innerWidth = Math.max(maxPageLen + urlBase.length + 2, 45);

  const pad = (s: string) => s + " ".repeat(Math.max(0, innerWidth - s.length));

  console.log(`\u250C${"─".repeat(innerWidth + 2)}\u2510`);
  console.log(`\u2502 ${pad(`Scaffold v0.1.0`)} \u2502`);
  console.log(`\u2502 ${pad("")} \u2502`);
  console.log(`\u2502 ${pad("Pages:")} \u2502`);
  for (const page of pages) {
    console.log(`\u2502 ${pad(`  ${urlBase}/${page.name}`)} \u2502`);
  }
  console.log(`\u2502 ${pad("")} \u2502`);
  console.log(`\u2502 ${pad(`API:     ${urlBase}/api`)} \u2502`);
  console.log(`\u2502 ${pad(`WS:      ws://localhost:${port}/_/ws`)} \u2502`);
  console.log(`\u2514${"─".repeat(innerWidth + 2)}\u2518`);
}
