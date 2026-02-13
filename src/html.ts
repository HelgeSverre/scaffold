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

export async function serveHtml(
  filePath: string,
  page: string,
  port: number,
  aiEnabled?: boolean,
  pages?: PageInfo[]
): Promise<Response> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return new Response("Not found", { status: 404 });
  }

  let html = await file.text();

  // Build scaffold config object
  const scaffoldConfig: Record<string, any> = {
    page,
    ws: `ws://localhost:${port}/_/ws`,
  };
  if (aiEnabled) {
    scaffoldConfig.aiEnabled = true;
    scaffoldConfig.pages = (pages || []).map((p) => p.name);
  }

  // Inject editor script before </body>
  const injection = `
<!-- Scaffold -->
<link rel="stylesheet" href="/_/assets/editor.css">
<script>window.__SCAFFOLD__ = ${JSON.stringify(scaffoldConfig)};</script>
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

export function generateIndexPage(pages: PageInfo[], port: number, aiEnabled?: boolean): Response {
  const links = pages
    .map((p) => `      <li><a href="/${p.name}" class="link">${p.name}</a></li>`)
    .join("\n");

  const baseOptions = pages
    .map((p) => `<option value="${p.name}">${p.name}</option>`)
    .join("\n            ");

  const aiSection = aiEnabled
    ? `
  <div class="create-section">
    <h2>+ Create New Prototype</h2>
    <div class="form-group">
      <label>Page name</label>
      <input type="text" id="new-page-name" placeholder="my-new-page" class="input" />
    </div>
    <div class="form-group">
      <label>Description</label>
      <textarea id="new-page-desc" rows="4" placeholder="Describe the page..." class="input textarea"></textarea>
    </div>
    <div class="form-group">
      <label>Use existing page as starting point</label>
      <select id="new-page-base" class="input">
        <option value="">None</option>
        ${baseOptions}
      </select>
    </div>
    <button id="new-page-btn" class="generate-btn" onclick="generatePage()">Generate with AI</button>
    <div id="new-page-status" class="status"></div>
  </div>
  <script>
    async function generatePage() {
      const name = document.getElementById('new-page-name').value.trim();
      const desc = document.getElementById('new-page-desc').value.trim();
      const base = document.getElementById('new-page-base').value;
      const status = document.getElementById('new-page-status');
      const btn = document.getElementById('new-page-btn');
      if (!name || !desc) { status.textContent = 'Name and description required'; return; }
      btn.disabled = true;
      status.textContent = 'Generating...';
      try {
        const res = await fetch('/_/ai/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: name, prompt: desc, basePage: base || undefined })
        });
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('event: status')) continue;
            if (line.startsWith('event: done')) continue;
            if (line.startsWith('event: error')) continue;
            if (line.startsWith('data: ')) {
              try {
                const d = JSON.parse(line.slice(6));
                if (d.message) status.textContent = d.message;
                if (d.url) { window.location.href = d.url; return; }
                if (d.error) status.textContent = 'Error: ' + d.error;
              } catch {}
            }
          }
        }
      } catch (e) { status.textContent = 'Error: ' + e.message; }
      finally { btn.disabled = false; }
    }
  </script>`
    : "";

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Scaffold</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; padding: 2rem; max-width: 640px; }
    h1 { font-size: 1.5rem; margin-bottom: 1.5rem; color: #14B8A6; }
    h2 { font-size: 1.1rem; margin-bottom: 1rem; color: #14B8A6; }
    ul { list-style: none; }
    li { margin-bottom: 0.5rem; }
    .link { color: #94a3b8; text-decoration: none; font-size: 1.1rem; padding: 0.25rem 0; display: inline-block; }
    .link:hover { color: #14B8A6; }
    .meta { color: #475569; font-size: 0.875rem; margin-top: 2rem; }
    .create-section { margin-top: 2rem; padding: 1.5rem; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; }
    .form-group { margin-bottom: 1rem; }
    .form-group label { display: block; font-size: 0.8rem; color: #64748b; margin-bottom: 0.25rem; }
    .input { width: 100%; padding: 0.5rem 0.75rem; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 6px; color: #e2e8f0; font-size: 0.9rem; font-family: inherit; }
    .input:focus { outline: none; border-color: #14B8A6; }
    .textarea { resize: vertical; min-height: 80px; }
    .generate-btn { padding: 0.5rem 1.25rem; background: rgba(20,184,166,0.15); border: 1px solid rgba(20,184,166,0.3); border-radius: 6px; color: #14B8A6; font-size: 0.9rem; cursor: pointer; font-family: inherit; }
    .generate-btn:hover { background: rgba(20,184,166,0.25); }
    .generate-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .status { margin-top: 0.75rem; font-size: 0.8rem; color: #94a3b8; }
  </style>
</head>
<body>
  <h1>Scaffold</h1>
  <ul>
${links}
  </ul>
  <p class="meta">${pages.length} pages &middot; API at <a href="/api" class="link">/api</a></p>
${aiSection}
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
