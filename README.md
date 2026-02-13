<p align="center">
  <img src="assets/logo.svg" alt="scaffold." width="400">
</p>

<p align="center">
  <em>Prototype-first development server — YAML schema, SQLite CRUD, AI-powered live HTML editing.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.1-14B8A6?style=flat&labelColor=0F172A" alt="Version">
  <img src="https://img.shields.io/badge/license-MIT-14B8A6?style=flat&labelColor=0F172A" alt="License">
  <img src="https://img.shields.io/badge/runtime-Bun-14B8A6?style=flat&labelColor=0F172A" alt="Runtime">
  <img src="https://img.shields.io/badge/tests-106%20unit%20·%2017%20e2e-14B8A6?style=flat&labelColor=0F172A" alt="Tests">
  <a href="https://scaffold.to"><img src="https://img.shields.io/badge/scaffold.to-14B8A6?style=flat&labelColor=0F172A" alt="Website"></a>
</p>

## Install

```bash
bun add --global github:HelgeSverre/scaffold
```

This registers the `scaffold` command globally.

**From source** (for contributors):

```bash
git clone https://github.com/HelgeSverre/scaffold.git
cd scaffold
bun install && bun link
```

## Quick Start

```bash
# 1. Create a folder with some .html prototypes
mkdir my-prototype && cd my-prototype

# 2. Initialize scaffold
scaffold init .

# 3. Edit .scaffold/scaffold.yaml to define your data entities

# 4. Start the dev server
scaffold dev
```

## CLI

```
scaffold init [dir]            Initialize a scaffold project (default: .)
scaffold dev [dir]             Start the development server
  -p, --port <number>          Port to run on
scaffold extract-style [dir]   Extract style guide from HTML files into .scaffold/prompt.md
scaffold --version             Show version
scaffold --help                Show help
```

### `scaffold init`

Creates the following structure in the target directory:

| File | Purpose |
|------|---------|
| `.scaffold/scaffold.yaml` | Data schema definition |
| `.scaffold/index.ts` | Server entrypoint |
| `.scaffold/functions/` | Custom route handlers |
| `.scaffold/prompt.md` | AI style guide (if extracted) |

Existing `.html` files are **never touched**.

### `scaffold extract-style`

Analyzes your HTML prototypes and generates a style guide at `.scaffold/prompt.md`. This guide is included in AI system prompts so generated content matches your existing design.

Extracts: CSS custom properties, shared classes, layout structure, CDN dependencies, Alpine.js patterns, and design conventions.

### Starting the Server

```bash
scaffold dev
# or directly
bun run .scaffold/index.ts
```

The server starts on port 5555 by default (auto-detects an available port if taken). Override with `--port` or the `PORT` env var.

## Schema Definition — scaffold.yaml

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

- `02-participants.html` -> `http://localhost:5555/02-participants`
- `/` shows an index page listing all pages

The editor overlay is injected at serve-time (files on disk are never modified by the server).

## Live Editor

The editor toolbar appears at the bottom-right of every served page.

### Toolbar

- **Edit** — toggle edit mode
- **Save** — save changes to disk (also Cmd+S)
- **Undo** — reload from last saved version
- **+ (New Page)** — create a new page with AI (requires AI)
- **Components** — browse and insert reusable components (requires AI)
- **Extract** — extract selected element as a reusable component (requires AI)
- **Viewers** — count of connected browsers

The toolbar is draggable (position saved in localStorage).

### Edit Mode

- Text elements become `contenteditable`
- Click any element to select it (blue dashed outline + tag tooltip)
- Hover over elements shows a subtle outline indicator
- Alpine.js is paused via `x-ignore` during editing
- Exiting edit mode reloads the page to re-init Alpine

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+K | Focus AI input |
| Cmd+S | Save |
| Escape | Deselect / Close modal / Exit edit mode |
| Delete / Backspace | Remove selected element |
| Ctrl+D | Duplicate selected element |
| Ctrl+Up/Down | Reorder among siblings |
| Shift+Up | Select parent element |
| Shift+Left/Right | Select previous/next sibling |

### Save Process

1. Clones the document DOM
2. Strips all scaffold artifacts (editor, scripts, data attributes)
3. POSTs clean HTML to `/_/save/{page}`
4. Other connected browsers auto-reload

## AI Features

AI features require an `ANTHROPIC_API_KEY` environment variable. When set, the editor gains AI-powered editing, page creation, and component management.

### AI Configuration

Add an `ai` section to `scaffold.yaml`:

```yaml
ai:
  model: claude-sonnet-4-20250514     # Claude model (default)
  max_tokens: 16000                    # Token limit
  instructions: "Use Tailwind CSS"     # Custom instructions for AI
  style_reference: "main-page.html"    # Reference file for style extraction
  prefer_claude_code: false            # Prefer Claude Code CLI over SDK
```

### AI Edit

Select an element and type a prompt in the AI bar (or press Cmd+K). The AI modifies the selected element or the full page. Changes stream via SSE and are saved to disk.

**Endpoint:** `POST /_/ai/edit`

### AI Create Page

Click the **+** button to create a new page from a description. Optionally use an existing page as a structural starting point. The AI generates a complete HTML page matching your style guide.

**Endpoint:** `POST /_/ai/create`

### Components

**Browse & insert:** Click the Components button to browse saved components. Click a component to enter insertion mode — click anywhere on the page to place it.

**Extract:** Select an element and click Extract to save it as a reusable component with AI-cleaned HTML.

**Generate:** Use the component palette to generate new components from a description.

Components are stored in `.scaffold/components/<category>/<name>.html` with YAML frontmatter containing metadata (name, description, category, props).

**Endpoints:**
- `GET /_/ai/components` — list all components
- `GET /_/ai/components/:category/:name` — get one component
- `POST /_/ai/components/generate` — generate a new component (SSE)
- `POST /_/ai/components/extract` — extract from existing HTML (JSON)

## WebSocket

Endpoint: `ws://localhost:5555/_/ws`

Used for hot-reload on file changes and viewer count sync. The file watcher detects external `.html` changes and broadcasts reload to all viewers of that page.

## Custom Functions

Add route handlers in `.scaffold/functions/*.ts`:

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
  config: ScaffoldConfig; // Parsed scaffold.yaml
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
├── playwright.config.ts
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
│   ├── html-utils.ts     # XPath replacement, title extraction
│   ├── websocket.ts      # WebSocket manager
│   ├── watcher.ts        # File watcher (100ms debounce)
│   ├── functions.ts      # Custom function loader
│   ├── components.ts     # Component discovery + frontmatter
│   ├── server.ts         # Composition layer (Bun.serve)
│   ├── ai.ts             # Anthropic SDK client + streaming
│   ├── ai-routes.ts      # AI HTTP endpoints (SSE)
│   ├── ai-prompts.ts     # Prompt templates
│   ├── log.ts            # Logging utilities
│   ├── paths.ts          # Path resolution helpers
│   └── assets/
│       ├── editor.js     # Live editor overlay (vanilla JS IIFE)
│       └── editor.css    # Editor styles (shadow DOM scoped)
├── tests/
│   ├── schema.test.ts
│   ├── migration.test.ts
│   ├── crud.test.ts
│   ├── router.test.ts
│   ├── html.test.ts
│   ├── ai.test.ts
│   └── e2e/
│       ├── editor-keyboard.e2e.ts
│       └── editor-ai.e2e.ts
└── example/prototypes/   # Example prototypes (not published)
```

### Running Tests

```bash
# Unit tests (106 tests across 6 files)
bun test

# E2E tests (Playwright, requires chromium)
bun run test:e2e

# E2E tests including AI features (requires real API key)
ANTHROPIC_API_KEY=sk-... bun run test:e2e

# Install Playwright browsers (first time only)
bunx playwright install chromium
```

Unit tests use in-memory SQLite (`:memory:`). E2E tests start a fixture server on port 5599. AI e2e tests are automatically skipped when `ANTHROPIC_API_KEY` is not set.

### Running on Example Prototypes

```bash
bun install && bun link
bun run example/prototypes/.scaffold/index.ts
open http://localhost:5555
```

### Testing the API

```bash
# List
curl http://localhost:5555/api/tasks

# Filter + sort + eager load
curl "http://localhost:5555/api/entitlementitems?with=category&sort=-name"

# Create
curl -X POST http://localhost:5555/api/zones \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test Zone"}'

# Update
curl -X PATCH http://localhost:5555/api/zones/1 \
  -H 'Content-Type: application/json' \
  -d '{"capacity": 500}'

# Delete
curl -X DELETE http://localhost:5555/api/zones/7
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `bun:sqlite` | Database (built into Bun) |
| `yaml` | Parse scaffold.yaml |
| `commander` | CLI argument parsing |
| `@anthropic-ai/sdk` | AI features (Anthropic API) |
| `get-port` | Auto-detect available port |

**Dev dependencies:** `@playwright/test`, `@types/bun`
