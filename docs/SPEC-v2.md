# Scaffold — Prototype Backend & Live Editor

**A Bun-powered tool for running, persisting, and live-editing HTML prototypes.**

You have a folder of self-contained `.html` prototypes (Alpine.js + Tailwind). You run `scaffold init .` and `bun run dev`. You get: a SQLite-backed CRUD API defined by a YAML file, all your HTML files served with a live-editor overlay injected, WebSocket-powered hot reload across all connected browsers, and a `functions/` directory for custom routes.

---

## 1. Project Structure

After running `scaffold init .` in a folder containing prototype HTML files:

```
entitlement-prototype/
├── 02-participants.html           ← existing prototype (untouched on disk)
├── 03-participant-detail.html     ← existing prototype (untouched on disk)
├── 04-entitlement-items.html      ← existing prototype (untouched on disk)
├── 05-rules.html                  ← existing prototype (untouched on disk)
├── 06-zones.html                  ← existing prototype (untouched on disk)
├── 07-checkpoints.html            ← existing prototype (untouched on disk)
├── scaffold.yml                   ← generated: data schema (YAML)
├── index.ts                       ← generated: Bun entrypoint
├── functions/                     ← generated: custom route handlers
│   └── .gitkeep
├── scaffold.db                    ← created at runtime: SQLite database
└── .scaffold/                     ← generated: internal assets
    ├── editor.js                  ← injected editor overlay script
    └── editor.css                 ← editor overlay styles
```

**Key principle:** The original `.html` files are NEVER modified on disk by `scaffold init`. The editor script is injected at serve-time by the Bun server.

---

## 2. CLI & Startup

### `scaffold init [dir]`

Initializes a scaffold project in the target directory (default: `.`).

**Generates:**
- `scaffold.yml` — starter schema with commented-out example entities
- `index.ts` — the Bun server entrypoint (self-contained, ~50 lines, imports from `.scaffold/server`)
- `functions/` — empty directory with `.gitkeep`
- `.scaffold/` — server internals + editor assets

**Does NOT:**
- Touch or modify any existing `.html` files
- Create the SQLite database (that happens at `bun run dev`)

### `bun run dev`

Starts the development server (just runs `bun run index.ts`).

**Startup sequence:**
1. Parse `scaffold.yml`
2. Open/create `scaffold.db` (SQLite via `bun:sqlite`)
3. Auto-migrate: create/alter tables to match schema
4. Scan directory for `*.html` files (non-recursive, ignores `node_modules`, `.scaffold`)
5. Load any `functions/*.ts` files as custom routes
6. Start HTTP + WebSocket server on port 1234 (configurable via `PORT` env)

**Startup output:**

```
┌─────────────────────────────────────────────────┐
│  Scaffold v0.1.0                                │
│                                                 │
│  Pages:                                         │
│    http://localhost:1234/02-participants         │
│    http://localhost:1234/03-participant-detail   │
│    http://localhost:1234/04-entitlement-items    │
│    http://localhost:1234/05-rules                │
│    http://localhost:1234/06-zones                │
│    http://localhost:1234/07-checkpoints          │
│                                                 │
│  API:     http://localhost:1234/api              │
│  Admin:   http://localhost:1234/_/admin          │
│  WS:      ws://localhost:1234/_/ws               │
└─────────────────────────────────────────────────┘
```

---

## 3. Data Schema — scaffold.yml

### Supported Property Types

| Type | SQLite Type | Notes |
|------|------------|-------|
| `string` | TEXT | Default if no type specified. Shorthand: just use property name as a bare string. |
| `text` | TEXT | Semantic distinction for long-form content |
| `number` | REAL | Floating-point |
| `integer` | INTEGER | |
| `boolean` | INTEGER | 0/1. Default: false |
| `date` | TEXT | ISO date (YYYY-MM-DD) |
| `timestamp` | TEXT | ISO datetime |
| `email` | TEXT | Basic format validation on write |
| `uuid` | TEXT | Auto-generated UUID v4 if no value provided |
| `enum` | TEXT | Validated against `values` list on write |
| `json` | TEXT | Stored as JSON string. Returned as parsed object on read. |
| `relation` | INTEGER | FK to another entity's `id`. Specify `entity` for the target. |

### Schema Features

**Enums** — validated on write, stored as TEXT:
```yaml
- { name: item_type, type: enum, values: [access, consumable, returnable, one_time] }
```

**Relations** — foreign keys with optional eager loading:
```yaml
- { name: category_id, type: relation, entity: EntitlementCategory }
```

**Self-referential** — for hierarchies:
```yaml
- { name: parent_zone_id, type: relation, entity: Zone, nullable: true }
```

**JSON columns** — for flexible config:
```yaml
- { name: config, type: json, nullable: true }
- { name: valid_days, type: json, nullable: true }   # stored as [0,1,2,3,4,5,6]
```

**Defaults and nullability:**
```yaml
- { name: is_active, type: boolean, default: true }
- { name: capacity, type: integer, nullable: true }    # nullable means it can be null
- { name: notes, type: text, nullable: true }
```

### Pivot Tables

Pivot tables for many-to-many relationships use a simplified syntax:

```yaml
EntitlementItemZone:
  pivot: true     # tells Scaffold this is a join table — no auto id/timestamps
  properties:
    - { name: entitlement_item_id, type: relation, entity: EntitlementItem }
    - { name: zone_id, type: relation, entity: Zone }
```

Pivot tables get:
- `id` (auto-increment, always)
- The defined relation columns
- A unique index on the combination of relation columns
- No `created_at` / `updated_at` (unless explicitly added)

### Auto-Generated Columns

Every non-pivot entity automatically gets:
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `created_at` TEXT (ISO timestamp, set on insert)
- `updated_at` TEXT (ISO timestamp, set on insert and update)

### Seed Data

Optional inline seed data for populating the DB on first creation:

```yaml
EntitlementCategory:
  properties:
    - name
    - { name: description, type: text, nullable: true }
    - { name: icon, type: string, nullable: true }
    - { name: sort_order, type: integer, default: 0 }
  seed:
    - { name: "Accreditations", icon: "🎫", sort_order: 0 }
    - { name: "Meals", icon: "🍽️", sort_order: 1 }
    - { name: "Equipment", icon: "📻", sort_order: 2 }
    - { name: "Supplies", icon: "📦", sort_order: 3 }
    - { name: "Perks", icon: "🎁", sort_order: 4 }
```

Seed data is only inserted if the table is empty (i.e., on first `bun run dev` or after deleting `scaffold.db`).

### Full Example: Entitlement System

This is the scaffold.yml that would support the attached prototypes:

```yaml
name: Crescat Entitlement System Prototype

entities:
  # --- Core ---

  Participant:
    properties:
      - { name: uuid, type: uuid }
      - { name: festival_id, type: integer, default: 1 }
      - { name: participant_type, type: enum, values: [user, partner_contact, guest, responder] }
      - name
      - { name: email, type: email, nullable: true }
      - { name: affiliation, type: string, nullable: true }
      - { name: role, type: string, nullable: true }
      - { name: status, type: enum, values: [active, inactive, suspended], default: active }
    seed:
      - { name: "Astrid Henriksen", email: "astrid@crew.no", participant_type: user, affiliation: "Core Crew", role: "Production Manager", status: active }
      - { name: "Lars Eriksen", email: "lars@sound.no", participant_type: user, affiliation: "Sound Department", role: "Sound Engineer", status: active }
      - { name: "Emma Solberg", email: "emma@vol.no", participant_type: responder, affiliation: "Volunteers", role: "Team Lead", status: active }

  EntitlementCategory:
    properties:
      - name
      - { name: description, type: text, nullable: true }
      - { name: icon, type: string, nullable: true }
      - { name: sort_order, type: integer, default: 0 }
    seed:
      - { name: "Accreditations", icon: "🎫", sort_order: 0 }
      - { name: "Meals", icon: "🍽️", sort_order: 1 }
      - { name: "Equipment", icon: "📻", sort_order: 2 }
      - { name: "Supplies", icon: "📦", sort_order: 3 }
      - { name: "Perks", icon: "🎁", sort_order: 4 }

  EntitlementItem:
    properties:
      - { name: category_id, type: relation, entity: EntitlementCategory }
      - name
      - { name: item_type, type: enum, values: [access, consumable, returnable, one_time] }
      - { name: total_inventory, type: integer, nullable: true }
      - { name: per_day, type: boolean, default: false }
      - { name: description, type: text, nullable: true }
      - { name: uuid, type: uuid }
    seed:
      - { name: "AAA Access", item_type: access, category_id: 1 }
      - { name: "AA Access", item_type: access, category_id: 1 }
      - { name: "A Access", item_type: access, category_id: 1 }
      - { name: "Crew Access", item_type: access, category_id: 1 }
      - { name: "Lunch Voucher", item_type: consumable, per_day: true, category_id: 2 }
      - { name: "Dinner Voucher", item_type: consumable, per_day: true, category_id: 2 }
      - { name: "Two-Way Radio", item_type: returnable, total_inventory: 50, category_id: 3 }
      - { name: "Volunteer T-Shirt", item_type: one_time, category_id: 4 }

  Entitlement:
    properties:
      - { name: participant_id, type: relation, entity: Participant }
      - { name: entitlement_item_id, type: relation, entity: EntitlementItem }
      - { name: rule_id, type: relation, entity: EntitlementRule, nullable: true }
      - { name: quantity, type: integer, nullable: true }
      - { name: status, type: enum, values: [assigned, collected, active, depleted, expired, returned, revoked], default: assigned }
      - { name: schedule_id, type: relation, entity: EntitlementSchedule, nullable: true }
      - { name: valid_from, type: timestamp, nullable: true }
      - { name: valid_to, type: timestamp, nullable: true }
      - { name: rule_overridden, type: boolean, default: false }
      - { name: notes, type: text, nullable: true }

  EntitlementTransaction:
    properties:
      - { name: entitlement_id, type: relation, entity: Entitlement }
      - { name: checkpoint_id, type: relation, entity: Checkpoint, nullable: true }
      - { name: modifier, type: integer }
      - { name: scanned_by, type: string, nullable: true }
      - { name: timestamp, type: timestamp }
      - { name: notes, type: text, nullable: true }

  # --- Rules ---

  EntitlementRule:
    properties:
      - name
      - { name: entitlement_item_id, type: relation, entity: EntitlementItem }
      - { name: quantity, type: integer, nullable: true }
      - { name: priority, type: integer, default: 0 }
      - { name: is_active, type: boolean, default: true }
      - { name: per_day, type: boolean, default: false }
      - { name: stacking_behavior, type: enum, values: [stack, replace, highest], default: stack }
      - { name: schedule_id, type: relation, entity: EntitlementSchedule, nullable: true }
    seed:
      - { name: "All Crew — Basic Access", entitlement_item_id: 4, is_active: true, priority: 0 }
      - { name: "All Crew — Lunch", entitlement_item_id: 5, quantity: 1, per_day: true, is_active: true }
      - { name: "Sound Dept — AAA Access", entitlement_item_id: 1, is_active: true, priority: 10 }

  EntitlementRuleCriteria:
    properties:
      - { name: rule_id, type: relation, entity: EntitlementRule }
      - { name: criteria_type, type: enum, values: [all_crew, all_responders, all_festival_members, all_travel_party, all_guests, festival_section, role, public_form, shift_hours] }
      - { name: criteria_model_type, type: string, nullable: true }
      - { name: criteria_model_id, type: integer, nullable: true }
      - { name: min_shift_hours, type: number, nullable: true }
      - { name: max_shift_hours, type: number, nullable: true }

  EntitlementSchedule:
    properties:
      - name
      - { name: valid_from, type: date, nullable: true }
      - { name: valid_to, type: date, nullable: true }
      - { name: valid_days, type: json, nullable: true }
      - { name: valid_time_from, type: string, nullable: true }
      - { name: valid_time_to, type: string, nullable: true }

  # --- Zones & Access ---

  Zone:
    properties:
      - name
      - { name: description, type: text, nullable: true }
      - { name: parent_zone_id, type: relation, entity: Zone, nullable: true }
      - { name: capacity, type: integer, nullable: true }
    seed:
      - { name: "Front of House" }
      - { name: "Backstage" }
      - { name: "Green Room", parent_zone_id: 2 }
      - { name: "Production Office", parent_zone_id: 2 }
      - { name: "VIP Area" }
      - { name: "Artist Village", parent_zone_id: 2 }

  EntitlementItemZone:
    pivot: true
    properties:
      - { name: entitlement_item_id, type: relation, entity: EntitlementItem }
      - { name: zone_id, type: relation, entity: Zone }

  # --- Credentials & Scanning ---

  Credential:
    properties:
      - { name: participant_id, type: relation, entity: Participant }
      - { name: credential_type, type: enum, values: [qr, badge, wristband, nfc], default: qr }
      - { name: identifier, type: uuid }
      - { name: status, type: enum, values: [active, suspended, revoked, lost], default: active }
      - { name: issued_at, type: timestamp, nullable: true }
      - { name: expires_at, type: timestamp, nullable: true }

  Checkpoint:
    properties:
      - name
      - { name: checkpoint_type, type: enum, values: [gate, dispenser, scanner] }
      - { name: zone_id, type: relation, entity: Zone, nullable: true }
      - { name: is_public, type: boolean, default: false }
      - { name: config, type: json, nullable: true }
    seed:
      - { name: "Main Gate", checkpoint_type: gate, zone_id: 1, config: '{"direction":"both"}' }
      - { name: "Backstage Gate", checkpoint_type: gate, zone_id: 2, config: '{"direction":"in"}' }
      - { name: "Food Truck Alpha", checkpoint_type: dispenser, config: '{"auto_dispense":false}' }
      - { name: "Equipment Tent", checkpoint_type: dispenser }

  CheckpointEntitlementItem:
    pivot: true
    properties:
      - { name: checkpoint_id, type: relation, entity: Checkpoint }
      - { name: entitlement_item_id, type: relation, entity: EntitlementItem }

  CheckpointScan:
    properties:
      - { name: checkpoint_id, type: relation, entity: Checkpoint }
      - { name: credential_id, type: relation, entity: Credential, nullable: true }
      - { name: participant_id, type: relation, entity: Participant, nullable: true }
      - { name: scan_type, type: enum, values: [access_in, access_out, dispense, return, verify] }
      - { name: result, type: enum, values: [granted, denied, error] }
      - { name: denial_reason, type: string, nullable: true }
      - { name: timestamp, type: timestamp }
      - { name: scanned_by, type: string, nullable: true }

  EntitlementAllocation:
    properties:
      - { name: entitlement_item_id, type: relation, entity: EntitlementItem }
      - { name: group_type, type: string }
      - { name: group_id, type: integer }
      - { name: total_quantity, type: integer }
      - { name: distributed, type: integer, default: 0 }
      - { name: notes, type: text, nullable: true }
```

---

## 4. Auto-Generated CRUD API

### Routes

For each entity, routes are generated under `/api`:

```
GET    /api/{entities}           → List (paginated, filterable, sortable)
GET    /api/{entities}/:id       → Get one by ID
POST   /api/{entities}           → Create
PUT    /api/{entities}/:id       → Full update
PATCH  /api/{entities}/:id       → Partial update
DELETE /api/{entities}/:id       → Delete
```

**URL naming:** Entity names are converted to kebab-case:
- `Tasks` → `/api/tasks`
- `BlogPosts` → `/api/blog-posts`
- `ContactNotes` → `/api/contact-notes`

### Query Parameters (List Endpoint)

```
GET /api/products?page=1&per_page=25&sort=-created_at&status=active&with=category
```

| Param | Description | Example |
|-------|-------------|---------|
| `page` | Page number (default: 1) | `page=2` |
| `per_page` | Items per page (default: 25, max: 100) | `per_page=50` |
| `sort` | Sort field, prefix `-` for descending | `sort=-created_at` |
| `{field}` | Filter by exact value | `item_type=access` |
| `{field}_like` | Filter by LIKE pattern | `name_like=%radio%` |
| `{field}_gt` / `_lt` / `_gte` / `_lte` | Comparison filters | `capacity_gt=100` |
| `{field}_null` | Filter by null/not null | `parent_zone_id_null=true` |
| `with` | Eager-load relations (comma-separated) | `with=category,zone` |

### Response Format

**List:**
```json
{
  "data": [{ "id": 1, "name": "AAA Access", "item_type": "access", ... }],
  "meta": { "total": 18, "page": 1, "per_page": 25, "last_page": 1 }
}
```

**Single:**
```json
{ "data": { "id": 1, "name": "AAA Access", ... } }
```

**Error:**
```json
{ "error": { "message": "Validation failed: item_type must be one of: access, consumable, returnable, one_time", "status": 422 } }
```

### Validation

On create/update:
- **Required fields**: non-nullable properties without defaults must be present
- **Enum values**: must be in the `values` list
- **Relation existence**: FK targets must exist (basic SELECT check)
- **Email format**: basic regex for `email` type
- **JSON format**: `json` type values must be valid JSON

Validation errors return 422. Keep it simple — no field-level error arrays.

### Auto-Migration Strategy

On startup, compare YAML schema to existing SQLite tables:

| Scenario | Action |
|----------|--------|
| New entity | `CREATE TABLE` |
| New property on existing entity | `ALTER TABLE ADD COLUMN` with default |
| Removed property | Log warning, leave column |
| Type change | Log warning, no action |
| New seed data on empty table | Insert seed rows |

**Nuclear option:** delete `scaffold.db` and restart. Data is disposable.

---

## 5. HTML Serving & Editor Injection

### Serving Pages

Each `.html` file in the root directory is served at `/{filename-without-extension}`:

- `02-participants.html` → `http://localhost:1234/02-participants`
- `05-rules.html` → `http://localhost:1234/05-rules`
- `/` → auto-generated index page listing all available pages

**At serve time**, inject before `</body>`:

```html
<!-- Scaffold -->
<script>window.__SCAFFOLD__ = { page: "02-participants", ws: "ws://localhost:1234/_/ws" };</script>
<script src="/_/assets/editor.js"></script>
```

Original file on disk is never modified. Files are re-read on every request (dev mode simplicity).

### File Watching

Watch all `.html` files with Bun's built-in watcher. On change → broadcast `reload` to all connected browsers viewing that page.

---

## 6. Live Editor Overlay

### Architecture

`editor.js` is a single self-contained file. Vanilla JS, no build step. All editor UI rendered inside a **Shadow DOM** to prevent style conflicts:

```javascript
const host = document.createElement('scaffold-editor');
document.body.appendChild(host);
const shadow = host.attachShadow({ mode: 'closed' });
```

### Editor Toolbar

Fixed-position floating panel (bottom-right, draggable) in shadow DOM:

- **Edit toggle** — on/off switch
- **Save** — also `Ctrl+S` / `Cmd+S`
- **Undo** — reloads last saved version from disk
- **Viewers** — badge showing connected browser count

### Edit Mode ON

**1. Text Editing**

Walk the DOM, find elements with direct text content (not `<script>`, `<style>`, `<svg>`, `<template>`). Add `contenteditable="true"` + `data-scaffold-editable`. On `[x-data]` ancestors: add `x-ignore` + `data-scaffold-paused`.

**2. Element Selection**

Click any element → blue dashed outline + floating tooltip showing `tag.class1.class2`.

**3. Quick Class Editor**

Panel showing current classes as removable chips + input to add new ones. Basic autocomplete for common Tailwind utilities.

**4. Element Operations**

- `Delete` — remove element (confirm if has children)
- `Ctrl+D` — duplicate as next sibling
- `Ctrl+↑` / `Ctrl+↓` — reorder among siblings

**5. Boundaries**

Do NOT make editable: `x-for`, `x-if` template elements, `<template>`, `<script>`, `<style>`, `<svg>`.

### Edit Mode OFF

Remove all editing attributes, reload page to restore Alpine state.

### Save

1. Clone document DOM
2. Strip: `<scaffold-editor>`, injected scripts, `data-scaffold-*` attrs, added `contenteditable`, added `x-ignore`
3. Serialize: `'<!DOCTYPE html>\n' + clone.outerHTML`
4. POST `/_/save/{page}` with `Content-Type: text/html`
5. Server formats HTML, writes to disk
6. Broadcast `reload` to other viewers

### Alpine.js Notes

From the actual prototypes:
- `x-data` lives on `<body>` with large inline state objects
- `<template x-for>` generates dynamic rows in tables
- Static text (headings, labels, descriptions) is alongside dynamic `x-text` content
- CSS custom properties in `:root` define the design system
- Shared sidebar pattern with `<a href="other-file.html">` links

The editor pauses Alpine via `x-ignore` during editing. All `x-*` and `@*` attributes survive serialization naturally since they're just HTML attributes.

---

## 7. Custom Functions

### `functions/*.ts`

```typescript
import type { ScaffoldContext } from "../.scaffold/types";

export default function (ctx: ScaffoldContext) {
  ctx.route("POST", "/api/custom/seed-demo", async (req) => {
    for (let i = 0; i < 50; i++) {
      ctx.db.run(`INSERT INTO tasks (name, status, created_at, updated_at)
        VALUES (?, 'todo', datetime('now'), datetime('now'))`,
        [`Task ${i}`]);
    }
    return Response.json({ message: "Seeded 50 tasks" });
  });
}
```

### ScaffoldContext

```typescript
interface ScaffoldContext {
  db: import("bun:sqlite").Database;
  route: (method: string, path: string, handler: (req: Request) => Response | Promise<Response>) => void;
  broadcast: (page: string, message: object) => void;
  config: ParsedScaffoldYml;
}
```

Loaded once on startup. Restart after changes.

---

## 8. Admin Panel

Self-contained HTML at `/_/admin` (Alpine.js + Tailwind CDN). Uses the `/api/*` routes.

- Entity list sidebar
- Table view with all records
- Click-to-edit cells
- Add/delete records
- Import/export JSON per entity
- Show schema info

Functional, not pretty. Dark theme optional.

---

## 9. WebSocket

Endpoint: `ws://localhost:1234/_/ws`

**Client → Server:**
```json
{ "type": "join", "page": "02-participants" }
{ "type": "leave", "page": "02-participants" }
```

**Server → Client:**
```json
{ "type": "reload", "page": "02-participants" }
{ "type": "viewers", "page": "02-participants", "count": 3 }
```

---

## 10. URL Routing

| Pattern | Method | Handler |
|---------|--------|---------|
| `/` | GET | Index listing all pages |
| `/{page}` | GET | Serve HTML with editor injected |
| `/api/{entities}` | GET | List records |
| `/api/{entities}/:id` | GET | Get one |
| `/api/{entities}` | POST | Create |
| `/api/{entities}/:id` | PUT | Full update |
| `/api/{entities}/:id` | PATCH | Partial update |
| `/api/{entities}/:id` | DELETE | Delete |
| `/_/save/{page}` | POST | Save edited HTML to disk |
| `/_/admin` | GET | Admin panel |
| `/_/assets/*` | GET | Editor JS/CSS |
| `/_/ws` | WS | WebSocket |
| `/api/custom/*` | * | Custom function routes |

CORS: `Access-Control-Allow-Origin: *` on all `/api/*` routes.

---

## 11. Dependencies

| Package | Purpose |
|---------|---------|
| `bun:sqlite` | Database (built into Bun) |
| `yaml` | Parse scaffold.yml |

That's it. No Express, no ORM, no build tools.

---

## 12. Implementation Priority

**Phase 1 — Backend core (build first):**
1. `scaffold init` generating files
2. YAML parsing → SQLite tables + migration
3. CRUD API with filtering, pagination, sorting, relations
4. Enum/JSON validation
5. Seed data
6. HTML serving with injection
7. WebSocket hot-reload on file change

**Phase 2 — Editor overlay:**
1. Editor toolbar (toggle, save, undo)
2. Text editing via contenteditable
3. Save → POST → disk → broadcast
4. Alpine.js pause/resume
5. Element selection + info tooltip

**Phase 3 — Polish:**
1. Admin panel
2. Class editor
3. Element operations (delete, duplicate, move)
4. Custom functions loading
5. Startup banner

---

## 13. Future Ideas (out of scope)

- **AI endpoint**: `/_/ai/generate` — prompt → HTML/data
- **Git integration**: auto-commit on save for free undo history
- **Component palette**: pre-made Alpine+Tailwind snippets
- **Cross-page nav**: rewrite sidebar `<a href="file.html">` to `/{page}` routes
- **Schema inference**: analyze `x-data` in prototypes to suggest scaffold.yml
