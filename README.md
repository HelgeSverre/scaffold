<p align="center">
  <img src="assets/logo.svg" alt="scaffold." width="400">
</p>

<p align="center">
  <em>Prototype-first development server — YAML schema, SQLite CRUD, live HTML editing.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.0-14B8A6?style=flat&labelColor=0F172A" alt="Version">
  <img src="https://img.shields.io/badge/license-MIT-14B8A6?style=flat&labelColor=0F172A" alt="License">
  <img src="https://img.shields.io/badge/runtime-Bun-14B8A6?style=flat&labelColor=0F172A" alt="Runtime">
  <img src="https://img.shields.io/badge/tests-67%20passed-14B8A6?style=flat&labelColor=0F172A" alt="Tests">
  <a href="https://scaffold.to"><img src="https://img.shields.io/badge/scaffold.to-14B8A6?style=flat&labelColor=0F172A" alt="Website"></a>
</p>

## Install

```bash
bun install
bun link
```

This registers the `scaffold` command globally.

## Quick Start

```bash
# 1. Create a folder with some .html prototypes
mkdir my-prototype && cd my-prototype

# 2. Initialize scaffold
scaffold init .

# 3. Edit scaffold.yml to define your data entities

# 4. Start the dev server
bun run index.ts
```

## CLI

```
scaffold init [dir]    Initialize a scaffold project in the given directory (default: .)
scaffold dev [dir]     Start the development server (runs bun run index.ts)
scaffold --version     Show version
scaffold --help        Show help
```

### `scaffold init`

Creates the following files in the target directory:

| File | Purpose |
|------|---------|
| `scaffold.yml` | Data schema definition |
| `index.ts` | Server entrypoint |
| `functions/` | Custom route handlers |
| `.scaffold/` | Internal editor assets |

Existing `.html` files are **never touched**.

### Starting the Server

```bash
bun run index.ts
# or
scaffold dev
```

The server starts on port 1234 (override with `PORT` env var).

## Schema Definition — scaffold.yml

Define your data entities in YAML. Each entity becomes a SQLite table and a REST API.

### Basic Example

```yaml
name: My App

entities:
  Task:
    properties:
      - name                                           # shorthand for { name: name, type: string }
      - { name: description, type: text, nullable: true }
      - { name: status, type: enum, values: [todo, in_progress, done], default: todo }
      - { name: priority, type: integer, default: 0 }
    seed:
      - { name: "Example task", status: todo }
```

### Property Types

| Type | SQLite | Notes |
|------|--------|-------|
| `string` | TEXT | Default type. Shorthand: bare string `- name` |
| `text` | TEXT | Semantic distinction for long content |
| `number` | REAL | Floating-point |
| `integer` | INTEGER | |
| `boolean` | INTEGER | 0/1, default: false |
| `date` | TEXT | ISO date (YYYY-MM-DD) |
| `timestamp` | TEXT | ISO datetime |
| `email` | TEXT | Validated on write |
| `uuid` | TEXT | Auto-generated if not provided |
| `enum` | TEXT | Validated against `values` list |
| `json` | TEXT | Stored as string, returned parsed |
| `relation` | INTEGER | FK to another entity. Specify `entity` |

### Property Options

```yaml
- { name: field, type: string }                        # required, not null
- { name: field, type: string, nullable: true }        # can be null
- { name: field, type: string, default: "hello" }      # has default value
- { name: status, type: enum, values: [a, b, c] }     # enum with allowed values
- { name: user_id, type: relation, entity: User }      # foreign key to User
```

### Auto-Generated Columns

Every non-pivot entity gets:
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `created_at` TEXT (ISO timestamp)
- `updated_at` TEXT (ISO timestamp)

### Relations

```yaml
Item:
  properties:
    - { name: category_id, type: relation, entity: Category }
```

### Pivot Tables (Many-to-Many)

```yaml
ItemTag:
  pivot: true
  properties:
    - { name: item_id, type: relation, entity: Item }
    - { name: tag_id, type: relation, entity: Tag }
```

Pivot tables get `id` + a unique index on the relation columns, but no timestamps.

### Seed Data

```yaml
Category:
  properties:
    - name
  seed:
    - { name: "Electronics" }
    - { name: "Books" }
```

Seed data is inserted only if the table is empty.

## CRUD API

Every entity gets REST endpoints at `/api/{entitynames}`:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tasks` | List (paginated, filterable, sortable) |
| GET | `/api/tasks/:id` | Get one |
| POST | `/api/tasks` | Create |
| PUT | `/api/tasks/:id` | Full update |
| PATCH | `/api/tasks/:id` | Partial update |
| DELETE | `/api/tasks/:id` | Delete |

Route names are the entity name lowercased + `s` (e.g., `EntitlementItem` -> `/api/entitlementitems`).

### Query Parameters

```
GET /api/items?page=2&per_page=10&sort=-created_at&status=active&name_like=%radio%&with=category
```

| Param | Description |
|-------|-------------|
| `page` | Page number (default: 1) |
| `per_page` | Items per page (default: 25, max: 100) |
| `sort` | Sort field, prefix `-` for DESC |
| `{field}` | Exact match filter |
| `{field}_like` | LIKE filter |
| `{field}_gt` / `_lt` / `_gte` / `_lte` | Comparison filters |
| `{field}_null` | Filter by null/not null (`true`/`false`) |
| `with` | Eager-load relations (comma-separated) |

### Eager Loading

Use the `with` parameter to include related records. The relation name is the FK column without `_id`:

```
GET /api/items?with=category
GET /api/entitlements?with=participant,entitlement_item
```

### Response Format

**List:**
```json
{
  "data": [{ "id": 1, "name": "..." }],
  "meta": { "total": 42, "page": 1, "per_page": 25, "last_page": 2 }
}
```

**Single:** `{ "data": { "id": 1, "name": "..." } }`

**Error:** `{ "error": { "message": "...", "status": 422 } }`

### Validation

- Required fields (non-nullable without default)
- Enum values must be in the `values` list
- Relations must reference existing records
- Email format validation
- JSON must be valid

### CORS

All `/api/*` responses include `Access-Control-Allow-Origin: *`.

## HTML Serving

Every `.html` file in the root directory is served at `/{filename}`:

- `02-participants.html` -> `http://localhost:1234/02-participants`
- `/` shows an index page listing all pages

The editor overlay is injected at serve-time (files on disk are never modified by the server).

## Live Editor

The editor toolbar appears at the bottom-right of every served page.

### Toolbar

- **Edit** — toggle edit mode
- **Save** — save changes to disk (also Cmd+S)
- **Undo** — reload from last saved version
- **Viewers** — count of connected browsers

The toolbar is draggable (position saved in localStorage).

### Edit Mode

- Text elements become `contenteditable`
- Click any element to select it (blue dashed outline + tag tooltip)
- Alpine.js is paused via `x-ignore` during editing
- Exiting edit mode reloads the page to re-init Alpine

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+S | Save |
| Escape | Deselect / Exit edit mode |
| Delete | Remove selected element |
| Ctrl+D | Duplicate selected element |
| Ctrl+Up/Down | Reorder among siblings |

### Save Process

1. Clones the document DOM
2. Strips all scaffold artifacts (editor, scripts, data attributes)
3. POSTs clean HTML to `/_/save/{page}`
4. Other connected browsers auto-reload

## WebSocket

Endpoint: `ws://localhost:1234/_/ws`

Used for hot-reload on file changes and viewer count sync. The file watcher detects external `.html` changes and broadcasts reload to all viewers of that page.

## Custom Functions

Add route handlers in `functions/*.ts`:

```typescript
import type { ScaffoldContext } from "scaffold";

export default function (ctx: ScaffoldContext) {
  ctx.route("POST", "/api/custom/seed", async (req) => {
    ctx.db.run("INSERT INTO tasks (name, created_at, updated_at) VALUES (?, datetime('now'), datetime('now'))", ["New task"]);
    return Response.json({ ok: true });
  });
}
```

Functions are loaded once on startup. Restart after changes.

### ScaffoldContext

```typescript
interface ScaffoldContext {
  db: Database;           // bun:sqlite Database instance
  route: (method, path, handler) => void;  // Register a custom route
  broadcast: (page, message) => void;      // Send WS message to page viewers
  config: ScaffoldConfig; // Parsed scaffold.yml
}
```

## Auto-Migration

On startup, the schema is compared to existing SQLite tables:

| Change | Action |
|--------|--------|
| New entity | CREATE TABLE |
| New property | ALTER TABLE ADD COLUMN |
| Removed property | Warning logged, column kept |
| Type change | Warning logged, no action |

**Nuclear option:** Delete `scaffold.db` and restart.

---

## Development

### Project Structure

```
scaffold/
├── package.json
├── tsconfig.json
├── src/
│   ├── cli.ts            # CLI entry (Commander.js)
│   ├── index.ts          # Public API
│   ├── types.ts          # Type definitions
│   ├── init.ts           # scaffold init logic
│   ├── schema.ts         # YAML parsing + entity metadata
│   ├── migration.ts      # SQLite table creation/migration
│   ├── router.ts         # Pattern-matching router
│   ├── crud.ts           # CRUD route generation
│   ├── html.ts           # HTML scanning + serving + save
│   ├── websocket.ts      # WebSocket manager
│   ├── watcher.ts        # File watcher
│   ├── functions.ts      # Custom function loader
│   ├── server.ts         # Composition layer (Bun.serve)
│   └── assets/
│       ├── editor.js     # Live editor overlay
│       └── editor.css    # Editor styles
├── tests/
│   ├── schema.test.ts
│   ├── migration.test.ts
│   ├── crud.test.ts
│   ├── router.test.ts
│   └── html.test.ts
└── example/prototypes/   # Test prototypes (not published)
```

### Running on Example Prototypes

The `example/prototypes/` directory contains 19 Alpine.js + Tailwind HTML prototype files for testing.

```bash
# 1. Install and link the scaffold package
cd /path/to/scaffold
bun install
bun link

# 2. Initialize the example directory (only once)
scaffold init example/prototypes

# 3. Copy the full entitlement YAML from SPEC-v2.md into example/prototypes/scaffold.yml
#    (or use the one already there if set up)

# 4. Link scaffold in the example dir so imports resolve
cd example/prototypes
bun link scaffold

# 5. Start the server
bun run index.ts

# 6. Open in browser
open http://localhost:1234
```

This gives you 19 pages with a full CRUD API (16 entities including participants, entitlements, zones, checkpoints, credentials, etc.) and the live editor overlay on every page.

### Running Tests

```bash
cd /path/to/scaffold
bun test
```

67 tests across 5 files covering schema parsing, migration, CRUD operations, routing, and HTML serving.

### Testing the API

```bash
# List participants
curl http://localhost:1234/api/participants

# Filter + sort + eager load
curl "http://localhost:1234/api/entitlementitems?with=category&sort=-name"

# Create
curl -X POST http://localhost:1234/api/zones \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test Zone"}'

# Update
curl -X PATCH http://localhost:1234/api/zones/1 \
  -H 'Content-Type: application/json' \
  -d '{"capacity": 500}'

# Delete
curl -X DELETE http://localhost:1234/api/zones/7
```

### Cleaning Up Before Publishing

Before publishing, remove the development-only files:

```bash
rm -rf example/
rm -f docs/SPEC*.md
```

The published package only needs `src/`, `package.json`, `tsconfig.json`, and `README.md`.

## Dependencies

| Package | Purpose |
|---------|---------|
| `bun:sqlite` | Database (built into Bun) |
| `yaml` | Parse scaffold.yml |
| `commander` | CLI argument parsing |

That's it. No Express, no ORM, no build tools.
