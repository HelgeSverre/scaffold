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
import { log } from "./log";
import { registerAIRoutes } from "./ai-routes";
import getPort from "get-port";
import type { ScaffoldContext, RouteEntry } from "./types";

export async function startServer(options?: { dir?: string; port?: number }) {
  const dir = resolve(options?.dir || ".");
  const port = options?.port || Number(process.env.PORT) || await getPort({ port: 5555 });

  // Parse schema (prefer .yaml, fall back to .yml)
  const yamlPath = existsSync(join(dir, "scaffold.yaml"))
    ? join(dir, "scaffold.yaml")
    : join(dir, "scaffold.yml");
  if (!existsSync(yamlPath)) {
    log.error("scaffold.yaml not found in " + dir);
    log.error("Run `scaffold init` first.");
    process.exit(1);
  }

  const yamlContent = readFileSync(yamlPath, "utf-8");
  const config = parseSchema(yamlContent);
  const entities = deriveEntityMeta(config);

  // Open/create database
  const dbPath = join(dir, "scaffold.db");
  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");

  // Migrate and seed
  const migration = migrate(db, entities);
  const seeding = seed(db, entities);

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

  // Register AI routes
  const aiEnabled = !!process.env.ANTHROPIC_API_KEY;
  if (aiEnabled) {
    registerAIRoutes({ router, dir, pages, config, yamlContent, wsManager, recentlySaved });
  }

  // Start file watcher
  startWatcher(dir, (page, msg) => wsManager.broadcast(page, msg), recentlySaved);

  // Page lookup (function to support dynamic page additions)
  const findPage = (name: string) => pages.find((p) => p.name === name);

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

      // AI routes
      if (pathname.startsWith("/_/ai/")) {
        if (req.method === "OPTIONS") {
          return new Response(null, {
            status: 204,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type",
            },
          });
        }

        const match = router.match(req.method, pathname.slice(1));
        if (match) {
          return match.handler(req, match.params);
        }

        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
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
        return generateIndexPage(pages, port, aiEnabled);
      }

      // HTML pages — redirect .html extension to clean URL
      let pageName = pathname.slice(1);
      if (pageName.endsWith(".html")) {
        const clean = pageName.slice(0, -5);
        if (findPage(clean)) {
          return Response.redirect(`/${clean}${url.search}`, 302);
        }
      }
      const page = findPage(pageName);
      if (page) {
        return serveHtml(page.file, pageName, port, aiEnabled, pages);
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
  const base = `http://localhost:${port}`;

  log.brand();
  for (const page of pages) {
    log.link(`${base}/${page.name}`);
  }
  log.blank();

  const allTables = [...migration.created, ...migration.altered];
  if (allTables.length > 0) {
    log.step(`Migrated ${allTables.length} ${allTables.length === 1 ? "entity" : "entities"}`);
    for (const t of allTables) {
      log.item(t);
    }
  }
  if (seeding.seeded > 0) {
    log.step(`Seeded ${seeding.seeded} ${seeding.seeded === 1 ? "record" : "records"}`);
  }

  const endpointCount = entities.length * 6;
  log.step(`${endpointCount} API endpoints ready`);
  log.step(`${pages.length} ${pages.length === 1 ? "page" : "pages"} with live editor`);
  log.step("Watching for changes\u2026");

  log.done("\u2318S Save  \u2318D Duplicate  Del Remove  \u2318\u2191\u2193 Reorder  Esc Deselect");
}
