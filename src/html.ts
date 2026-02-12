import { join } from "path";
import { readdirSync, existsSync } from "fs";

export interface PageInfo {
  name: string;
  file: string;
}

export function scanHtmlFiles(dir: string): PageInfo[] {
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter(
    (f) => f.endsWith(".html") && !f.startsWith(".")
  );

  return files.map((f) => ({
    name: f.replace(/\.html$/, ""),
    file: join(dir, f),
  }));
}

export async function serveHtml(filePath: string, page: string, port: number): Promise<Response> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return new Response("Not found", { status: 404 });
  }

  let html = await file.text();

  // Inject editor script before </body>
  const injection = `
<!-- Scaffold -->
<link rel="stylesheet" href="/_/assets/editor.css">
<script>window.__SCAFFOLD__ = { page: ${JSON.stringify(page)}, ws: "ws://localhost:${port}/_/ws" };</script>
<script src="/_/assets/editor.js"></script>`;

  const bodyCloseIdx = html.lastIndexOf("</body>");
  if (bodyCloseIdx !== -1) {
    html = html.slice(0, bodyCloseIdx) + injection + "\n" + html.slice(bodyCloseIdx);
  } else {
    html += injection;
  }

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export function generateIndexPage(pages: PageInfo[], port: number): Response {
  const links = pages
    .map((p) => `      <li><a href="/${p.name}" class="link">${p.name}</a></li>`)
    .join("\n");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Scaffold</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; padding: 2rem; }
    h1 { font-size: 1.5rem; margin-bottom: 1.5rem; color: #38bdf8; }
    ul { list-style: none; }
    li { margin-bottom: 0.5rem; }
    .link { color: #94a3b8; text-decoration: none; font-size: 1.1rem; padding: 0.25rem 0; display: inline-block; }
    .link:hover { color: #38bdf8; }
    .meta { color: #475569; font-size: 0.875rem; margin-top: 2rem; }
  </style>
</head>
<body>
  <h1>Scaffold</h1>
  <ul>
${links}
  </ul>
  <p class="meta">${pages.length} pages &middot; API at <a href="/api" class="link">/api</a></p>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function handleSave(
  req: Request,
  page: string,
  dir: string,
  broadcastFn: (page: string, msg: object) => void,
  recentlySaved: Set<string>
): Promise<Response> {
  const html = await req.text();
  const filePath = join(dir, `${page}.html`);

  if (!existsSync(filePath)) {
    return new Response(JSON.stringify({ error: { message: "Page not found", status: 404 } }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Mark as recently saved to suppress watcher reload
  recentlySaved.add(page);
  setTimeout(() => recentlySaved.delete(page), 500);

  await Bun.write(filePath, html);
  broadcastFn(page, { type: "reload", page });

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
}
