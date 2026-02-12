# Scaffold — Prototype Backend & Live Editor

**A Bun-powered tool for running, persisting, and live-editing HTML prototypes.**

You have a folder of self-contained `.html` prototypes (Alpine.js + Tailwind). You run `scaffold init .` and `bun run dev`. You get: a SQLite-backed CRUD API defined by a YAML file, all your HTML files served with a live-editor overlay injected, WebSocket-powered hot reload across all connected browsers, and a `functions/` directory for custom routes. That's it.

---

## 1. Project Structure

After running `scaffold init .` in a folder containing some `.html` prototype files, the directory looks like this:

```
my-prototypes/
├── dashboard.html          ← existing prototype (untouched)
├── attendee-list.html      ← existing prototype (untouched)
├── sponsor-packages.html   ← existing prototype (untouched)
├── scaffold.yml            ← generated: data schema (YAML)
├── index.ts                ← generated: Bun entrypoint
├── functions/              ← generated: custom route handlers (optional)
│   └── .gitkeep
├── scaffold.db             ← created at runtime: SQLite database
└── .scaffold/              ← generated: internal assets
    ├── editor.js            ← injected editor overlay script
    └── editor.css           ← editor overlay styles
```

**Key principle:** The original `.html` files are NEVER modified on disk by `scaffold init`. They remain exactly as they were. The editor script is injected at serve-time by the Bun server.

---

## 2. CLI Commands

### `scaffold init [dir]`

Initializes a scaffold project in the target directory (default: `.`).

**What it generates:**
- `scaffold.yml` — starter schema with a single example entity (commented out)
- `index.ts` — the Bun server entrypoint
- `functions/` — empty directory with `.gitkeep`
- `.scaffold/` — editor assets (JS + CSS)

**What it does NOT do:**
- Touch or modify any existing `.html` files
- Create the SQLite database (that happens at runtime)

**scaffold.yml starter content:**

```yaml
# Scaffold — prototype data schema
# Define your entities here. CRUD routes are auto-generated.
# Restart the dev server after changes.

name: My Prototype

entities:
  # Example:
  # Attendee:
  #   properties:
  #     - name
  #     - { name: email, type: email }
  #     - { name: ticket_type, type: string }
  #     - { name: checked_in, type: boolean, default: false }
  #     - { name: notes, type: text }
```

### `bun run dev`

Starts the development server. This is just `bun run index.ts`.

**Startup sequence:**
1. Parse `scaffold.yml`
2. Open/create `scaffold.db` (SQLite)
3. Auto-migrate: create/alter tables to match schema
4. Scan directory for `*.html` files (non-recursive, skip `node_modules`)
5. Load any `functions/*.ts` files as custom routes
6. Start HTTP + WebSocket server

**Startup output:**

```
 ╭──────────────────────────────────────────╮
 │  Scaffold v0.1.0                         │
 │                                          │
 │  Pages:                                  │
 │    http://localhost:1234/dashboard        │
 │    http://localhost:1234/attendee-list    │
 │    http://localhost:1234/sponsor-packages │
 │                                          │
 │  API:     http://localhost:1234/api       │
 │  Editor:  http://localhost:1234/_/editor  │
 │  Admin:   http://localhost:1234/_/admin   │
 ╰──────────────────────────────────────────╯
```

---

## 3. HTML Serving & Editor Injection

### Serving Pages

Each `.html` file in the root directory is served at `/{filename-without-extension}`.

- `dashboard.html` → `http://localhost:1234/dashboard`
- `attendee-list.html` → `http://localhost:1234/attendee-list`
- `/` (root) → serve an auto-generated index page listing all available prototypes

**At serve time**, the server reads the HTML file and injects the following just before `</body>`:

```html
<!-- Scaffold Editor -->
<script src="/_/assets/editor.js"></script>
<link rel="stylesheet" href="/_/assets/editor.css">
```

The original file on disk is not modified.

### File Watching

The server watches all `.html` files for changes using Bun's file watcher. When a file changes on disk (e.g., someone edits it in their code editor), all connected browsers get a WebSocket message to reload.

---

## 4. Live Editor Overlay

The injected `editor.js` adds a floating toolbar to every served page. The editor is toggled on/off — when off, the page behaves exactly as normal (Alpine.js interactivity works as expected).

### Editor Toolbar

A small fixed-position floating panel (bottom-right corner, draggable) with:

- **Toggle Edit Mode** (on/off switch) — primary control
- **Save** button (Ctrl+S / Cmd+S keyboard shortcut)
- **Undo** button (reverts to last saved version)
- **Connected viewers** indicator (shows how many browsers are viewing this page)

### Edit Mode Behavior

When edit mode is ON:

1. **Text editing**: All text nodes become editable in-place via `contenteditable`. Clicking on any text lets you type directly. Alpine.js `x-text` and `x-html` bindings are temporarily paused to prevent them from overwriting edits.

2. **Element selection**: Clicking any element shows a subtle outline and a small floating tooltip showing the element's tag and key classes (e.g., `div.grid.grid-cols-3`). This helps identify what you're editing.

3. **Class editor**: When an element is selected, a small panel shows its current Tailwind classes as removable chips, with an input field to add new classes. Changes are applied immediately and visually.

4. **Delete element**: Selected elements can be deleted with the Delete/Backspace key (with confirmation for larger elements containing children).

5. **Duplicate element**: Selected elements can be duplicated (Ctrl+D) — inserted as a sibling after the current element.

6. **Move element**: Selected elements can be moved up/down among siblings (Ctrl+↑ / Ctrl+↓).

When edit mode is OFF:
- All editing UI disappears
- Alpine.js resumes normal operation
- Page is fully interactive as normal

### Save Mechanism

When the user hits Save:

1. The editor serializes the current DOM state: `document.documentElement.outerHTML`
2. It strips out the injected editor script/CSS references
3. It strips any `contenteditable` attributes that were added
4. It sends the cleaned HTML via `POST /_/save/{page-name}`
5. The Bun server receives it, runs it through a basic HTML formatter/prettifier (indent properly — use a lightweight approach, not a full prettier dependency)
6. Writes it to the original `.html` file on disk
7. Broadcasts a reload to all OTHER connected browsers viewing this page (not the one that saved)

### Important: Alpine.js Compatibility

Since Alpine.js uses `x-data`, `x-show`, `x-bind`, `@click` etc. as HTML attributes, they survive DOM serialization perfectly. The key things to handle:

- When entering edit mode, add `x-ignore` to the `<body>` or use `Alpine.stopObservingMutations()` to prevent Alpine from fighting with contenteditable changes
- When exiting edit mode (without saving), reload the page to restore Alpine state
- `x-data` attributes contain the component state as JSON-like strings in the HTML — these are preserved through serialization

---

## 5. Data Schema & CRUD API

### scaffold.yml Schema

```yaml
name: Event Prototype

entities:
  Attendee:
    properties:
      - name                                    # shorthand: string, required
      - { name: email, type: email }
      - { name: ticket_type, type: string }
      - { name: checked_in, type: boolean, default: false }
      - { name: notes, type: text }
      - { name: event_id, type: relation, entity: Event }

  Event:
    properties:
      - { name: title, type: string }
      - { name: date, type: date }
      - { name: venue, type: string }
      - { name: capacity, type: number }

  SponsorPackage:
    properties:
      - { name: name, type: string }
      - { name: price, type: number }
      - { name: description, type: text }
      - { name: is_active, type: boolean, default: true }
```

### Supported Property Types

| Type | SQLite Column | Notes |
|------|--------------|-------|
| `string` | TEXT | Default type if none specified |
| `text` | TEXT | Same as string, semantic distinction |
| `number` | REAL | |
| `integer` | INTEGER | |
| `boolean` | INTEGER | 0/1, default false |
| `date` | TEXT | ISO date string |
| `timestamp` | TEXT | ISO datetime string |
| `email` | TEXT | Basic format validation |
| `json` | TEXT | Stored as JSON string |
| `relation` | INTEGER | Foreign key to another entity's `id` |

Every entity automatically gets:
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `created_at` TEXT (ISO timestamp, auto-set)
- `updated_at` TEXT (ISO timestamp, auto-set on create/update)

### Auto-Generated CRUD Routes

For each entity, the following routes are created under `/api`:

```
GET    /api/{entity}           → List all (with pagination, filtering, sorting)
GET    /api/{entity}/:id       → Get one by ID
POST   /api/{entity}           → Create new record
PUT    /api/{entity}/:id       → Update record
PATCH  /api/{entity}/:id       → Partial update record
DELETE /api/{entity}/:id       → Delete record
```

Entity names in URLs are lowercased and pluralized naively (just adds 's'):
- `Attendee` → `/api/attendees`
- `Event` → `/api/events`
- `SponsorPackage` → `/api/sponsorpackages`

### Query Parameters for List Endpoint

```
GET /api/attendees?page=1&per_page=25&sort=-created_at&ticket_type=vip&relations=event
```

| Param | Description | Example |
|-------|-------------|---------|
| `page` | Page number (default: 1) | `page=2` |
| `per_page` | Items per page (default: 25, max: 100) | `per_page=50` |
| `sort` | Sort field, prefix `-` for desc | `sort=-created_at` |
| `{field}` | Filter by exact value | `ticket_type=vip` |
| `{field}_like` | Filter by LIKE pattern | `name_like=%john%` |
| `{field}_gt` / `_lt` / `_gte` / `_lte` | Comparison filters | `capacity_gt=100` |
| `relations` | Eager-load relations (comma-separated) | `relations=event` |

### Response Format

**List response:**
```json
{
  "data": [{ "id": 1, "name": "John", ... }],
  "meta": {
    "total": 42,
    "page": 1,
    "per_page": 25,
    "last_page": 2
  }
}
```

**Single item response:**
```json
{
  "data": { "id": 1, "name": "John", ... }
}
```

**Error response:**
```json
{
  "error": { "message": "Not found", "status": 404 }
}
```

### Auto-Migration

On startup, the server compares the YAML schema to the existing SQLite tables:

- **New entity** → CREATE TABLE
- **New property** → ALTER TABLE ADD COLUMN (with default value)
- **Removed property** → Column is left in place (SQLite doesn't support DROP COLUMN cleanly). A warning is logged.
- **Type change** → Warning is logged, no action taken. For prototyping, user can just delete `scaffold.db` and restart.

This is intentionally simple. For prototyping, the nuclear option of deleting the `.db` file is always available.

---

## 6. Custom Functions

Place `.ts` files in the `functions/` directory to add custom routes.

### Convention

Each file exports a default function that receives the Bun server context and a helper for registering routes:

```typescript
// functions/import-csv.ts
import type { ScaffoldContext } from "../index";

export default function (ctx: ScaffoldContext) {
  ctx.route("POST", "/api/custom/import-csv", async (req) => {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const text = await file.text();

    // Parse CSV, insert into db
    const lines = text.split("\n").slice(1); // skip header
    for (const line of lines) {
      const [name, email, ticket] = line.split(",");
      ctx.db.run(
        "INSERT INTO attendees (name, email, ticket_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        [name, email, ticket, new Date().toISOString(), new Date().toISOString()]
      );
    }

    return Response.json({ message: `Imported ${lines.length} attendees` });
  });
}
```

### ScaffoldContext

```typescript
interface ScaffoldContext {
  db: Database;           // bun:sqlite Database instance
  route: (
    method: string,
    path: string,
    handler: (req: Request) => Response | Promise<Response>
  ) => void;
  broadcast: (page: string, message: any) => void;  // send WebSocket message to all viewers of a page
  config: ScaffoldConfig; // parsed scaffold.yml
}
```

Functions are loaded alphabetically on startup. Hot-reloading of functions is NOT supported — restart the server after changes (keep it simple).

---

## 7. Admin Panel

A minimal auto-generated admin panel at `/_/admin` for viewing and editing data directly.

This should be a simple, self-contained HTML page (served by Bun, not a file in the project directory) that provides:

- **Entity list** in the sidebar (from scaffold.yml)
- **Table view** for each entity showing all records
- **Inline editing** of records (click a cell to edit)
- **Add record** button
- **Delete record** button
- **Import JSON** / **Export JSON** per entity (for seeding data quickly)

The admin panel is built with Alpine.js + Tailwind (loaded from CDN) to keep it self-contained. It uses the same `/api` CRUD routes as everything else.

The admin panel should be minimal and functional — not pretty. It's a developer tool.

---

## 8. WebSocket Protocol

The server runs a WebSocket endpoint at `/_/ws`.

### Client → Server Messages

```json
{ "type": "join", "page": "dashboard" }
{ "type": "leave", "page": "dashboard" }
{ "type": "save", "page": "dashboard", "html": "<!DOCTYPE html>..." }
```

### Server → Client Messages

```json
{ "type": "reload", "page": "dashboard" }
{ "type": "viewers", "page": "dashboard", "count": 3 }
{ "type": "saved", "page": "dashboard", "by": "someone" }
```

---

## 9. URL Routing Summary

| Path | Method | Description |
|------|--------|-------------|
| `/` | GET | Index page listing all prototype pages |
| `/{page}` | GET | Serve HTML page with editor injected |
| `/api/{entities}` | GET | List records |
| `/api/{entities}/:id` | GET | Get single record |
| `/api/{entities}` | POST | Create record |
| `/api/{entities}/:id` | PUT/PATCH | Update record |
| `/api/{entities}/:id` | DELETE | Delete record |
| `/_/save/{page}` | POST | Save edited HTML back to disk |
| `/_/admin` | GET | Admin panel |
| `/_/assets/*` | GET | Editor JS/CSS assets |
| `/_/ws` | WS | WebSocket endpoint |
| `/api/custom/*` | * | Custom function routes |

---

## 10. Technical Decisions

### Dependencies (keep minimal)

- **bun:sqlite** — built into Bun, zero dependencies
- **yaml** — `npm:yaml` for parsing scaffold.yml
- **chokidar** or Bun's built-in file watcher — for watching .html file changes

That's it. No Express, no ORM, no build tools. The entire server should be implementable in index.ts + a few helper modules.

### CORS

All `/api` routes should include permissive CORS headers by default (it's a local dev tool):

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

### Error Handling

Keep it simple: try/catch around handlers, return JSON errors. Log to console with color coding. No error tracking, no monitoring — it's a prototype tool.

### No Authentication

This is a local dev tool. No auth, no users, no sessions. Everything is open. If someone needs auth in their prototype, they can fake it in a custom function.

---

## 11. Editor Script Implementation Notes

### Architecture

The editor script (`editor.js`) should be a single self-contained file — no build step, no imports. It should work in modern browsers (Chrome/Firefox/Safari latest). 

It uses vanilla JS (no framework) to avoid conflicts with Alpine.js on the page. All editor DOM elements are created in a Shadow DOM container to prevent style conflicts with the prototype's Tailwind classes.

### Key Implementation Details

**Shadow DOM isolation:**
```javascript
const host = document.createElement('div');
host.id = 'scaffold-editor';
document.body.appendChild(host);
const shadow = host.attachShadow({ mode: 'closed' });
// All editor UI lives inside shadow DOM
```

**Alpine.js pause/resume:**
```javascript
// On enter edit mode:
document.querySelectorAll('[x-data]').forEach(el => {
  el.setAttribute('x-ignore', '');
});

// On exit edit mode:
// Just reload the page to restore Alpine state
window.location.reload();
```

**Clean serialization for save:**
```javascript
function getCleanHTML() {
  // Clone the document
  const clone = document.documentElement.cloneNode(true);
  
  // Remove editor elements
  clone.querySelector('#scaffold-editor')?.remove();
  
  // Remove injected script/link tags
  clone.querySelectorAll('script[src*="/_/assets"], link[href*="/_/assets"]').forEach(el => el.remove());
  
  // Remove contenteditable attributes we added
  clone.querySelectorAll('[data-scaffold-editable]').forEach(el => {
    el.removeAttribute('contenteditable');
    el.removeAttribute('data-scaffold-editable');
  });
  
  // Remove x-ignore we added
  clone.querySelectorAll('[data-scaffold-ignored]').forEach(el => {
    el.removeAttribute('x-ignore');
    el.removeAttribute('data-scaffold-ignored');
  });
  
  return '<!DOCTYPE html>\n' + clone.outerHTML;
}
```

---

## 12. Open Questions / Future Ideas (out of scope for v0.1)

- **Seed data in YAML**: Define initial records in scaffold.yml (like Manifest's `seedCount`)
- **AI endpoint**: POST to `/_/ai/generate` with a prompt, returns generated HTML/data (for live AI-assisted editing during meetings)
- **Component snippets**: A palette of pre-made Alpine.js + Tailwind components that can be inserted during edit mode
- **Git integration**: Auto-commit on every save for free undo history
- **Screenshot/snapshot**: Save a PNG screenshot of the current state for documentation
- **Multi-file relations**: Link between pages (e.g., clicking an attendee in a list opens their detail page)
