# Scaffold AI Features — Continuation Spec

**Extends:** SPEC.md (Scaffold core)
**Dependency:** Anthropic Claude — both the TypeScript SDK (`@anthropic-ai/sdk`) for API calls and optionally Claude Code CLI for complex generation tasks.

---

## Overview

Three phases of AI capability, each building on the last:

1. **Edit Page with AI** — Select elements or describe changes in natural language, Claude modifies the current page HTML
2. **Create New Prototype** — Describe a new page, Claude generates a full prototype that matches the project's existing style and data model
3. **Component System** — Extract, generate, and reuse HTML snippets across pages with an AI-powered component palette

All AI features use Anthropic's Claude exclusively. No provider abstraction, no model selection UI. The tool assumes `ANTHROPIC_API_KEY` is set in the environment (or falls back to Claude Code CLI if installed).

---

## Shared: AI Execution Layer

### Two Backends, One Interface

The AI layer has two execution backends. The Scaffold server picks the right one automatically:

**1. Anthropic SDK (primary)**

Used for: single-shot edits, component generation, quick page modifications.

```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
```

Model: `claude-sonnet-4-20250514` (fast, cheap, good at code). Configurable via `scaffold.yml`:

```yaml
ai:
  model: claude-sonnet-4-20250514   # default
  max_tokens: 16000                  # default, enough for a full page
```

**2. Claude Code CLI (optional power mode)**

Used for: generating entire new pages when the result needs iteration, multi-file operations, or when the user explicitly requests it.

Detection: on startup, check if `claude` binary is in PATH. If found, enable Claude Code features. If not, all AI works through the SDK — Claude Code is never required.

```typescript
import { spawn } from "child_process";

// Invoke Claude Code with a prompt and working directory
function claudeCode(prompt: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("claude", ["-p", prompt, "--output-format", "text"], { cwd });
    // collect stdout...
  });
}
```

### Context Assembly

Every AI request needs context about the project. The server assembles this automatically:

```typescript
interface AIContext {
  // Always included
  scaffoldYml: string;           // Full scaffold.yml content (data model)
  projectPages: PageSummary[];   // List of {filename, title, lineCount}

  // Included for edit/component operations
  currentPageHtml?: string;      // The full HTML of the page being edited
  selectedHtml?: string;         // Just the selected element(s) if any

  // Included for new page / style matching
  styleReference?: string;       // Extracted design system (CSS vars, shared classes, layout pattern)

  // Included for component operations
  components?: ComponentMeta[];  // Available components with descriptions
}

interface PageSummary {
  filename: string;    // "02-participants.html"
  title: string;       // "Participants - Crescat Entitlement System"
  lineCount: number;   // 1085
}
```

### Style Reference Extraction

On startup (and on file change), the server extracts a **style reference** from existing prototype files. This is sent to Claude so generated content matches the project's visual language.

The extraction is simple and heuristic — scan the first `.html` file found (or a user-specified reference file) and extract:

1. **CSS custom properties** — everything in `:root { }` blocks
2. **Shared CSS classes** — `.btn-primary`, `.btn-ghost`, `.sidebar-link`, `.badge-*`, `.card`, `.data-table`, etc. (any class defined in `<style>` tags)
3. **Layout skeleton** — the navbar + sidebar HTML structure (detected by looking for `<nav>` and `<aside>` with `fixed` positioning)
4. **CDN dependencies** — script/link tags pointing to CDNs (Tailwind, Alpine, fonts)
5. **Alpine.js patterns** — how `x-data` is structured (inline on body vs extracted)

This gets compiled into a condensed reference document (~200-400 lines) that's included in every AI prompt. The user can also override this by creating a `scaffold-style.md` file in the project root with explicit style instructions.

```yaml
# scaffold.yml addition
ai:
  style_reference: "02-participants.html"   # which file to extract style from (default: first .html found)
```

### System Prompt (shared across all AI operations)

```
You are an expert frontend developer working on HTML prototypes.
These prototypes use:
- Tailwind CSS (via CDN: https://cdn.tailwindcss.com)
- Alpine.js 3.x (via CDN, deferred)
- Inter font from Google Fonts
- CSS custom properties for theming (dark theme)
- Self-contained single-file HTML (all CSS in <style>, all JS inline in x-data)

CRITICAL RULES:
- Output ONLY valid HTML. No markdown, no explanations, no code fences.
- Match the existing design system exactly — use the CSS variables and class names from the style reference.
- Use the same layout structure (fixed navbar 48px, fixed sidebar 232px, main content with pt-[48px] and margin-left: 232px).
- Use inline x-data on <body> for Alpine state. Keep state objects self-contained.
- Use hardcoded mock data in x-data that feels realistic (Norwegian names, festival context).
- Sidebar navigation should link to all existing pages using .html file references.
- Every page is self-contained: includes its own <style>, CDN links, and complete markup.

DATA MODEL (from scaffold.yml):
{scaffoldYml}

STYLE REFERENCE (extracted from existing prototypes):
{styleReference}

EXISTING PAGES IN THIS PROJECT:
{pageList}
```

---

## Phase 1: Edit Page with AI

### User Experience

The editor overlay (from SPEC.md section 6) gets an AI prompt bar. When edit mode is ON, a text input appears in the toolbar:

```
┌──────────────────────────────────────────────────────────┐
│ 🤖 Ask AI...                                        ⏎  │
└──────────────────────────────────────────────────────────┘
```

The user types a natural language instruction. Examples:

- "Add a filter dropdown for participant type above the table"
- "Make the sidebar collapsible with a toggle button"
- "Add a status column to this table"
- "Change the empty state to show an illustration and a CTA button"
- "Add pagination controls below the table"
- "Make the header sticky on scroll"

### Element-Scoped Edits

If the user has **selected an element** (via the element selection from the editor), the AI prompt is scoped to that element. The prompt bar changes to indicate context:

```
┌──────────────────────────────────────────────────────────┐
│ 🤖 Edit <div.grid.grid-cols-3>...                   ⏎  │
└──────────────────────────────────────────────────────────┘
```

When an element is selected, the AI receives:
- The selected element's outer HTML as `selectedHtml`
- An XPath-like selector to locate it in the full page: `body > main > div:nth-child(2) > div.grid`
- The full page HTML for context (so the AI understands what's around it)

The AI returns just the replacement HTML for that element. The server diffs and patches it into the full page.

### Unscoped Edits (Full Page)

When no element is selected, the AI receives the full page HTML and returns the full modified page.

### API Endpoint

```
POST /_/ai/edit
Content-Type: application/json

{
  "page": "02-participants",
  "prompt": "Add a bulk action toolbar that appears when rows are selected",
  "selection": {                              // optional, when element is selected
    "xpath": "body > main > div:nth-child(2)",
    "html": "<div class=\"grid grid-cols-3\">...</div>"
  }
}
```

**Response:** Server-Sent Events (SSE) stream for real-time feedback:

```
event: status
data: {"message": "Analyzing page structure..."}

event: status
data: {"message": "Generating edit..."}

event: chunk
data: {"html": "<!DOCTYPE html>..."}    // streamed in chunks as Claude generates

event: done
data: {"page": "02-participants", "linesChanged": 42}
```

### Edit Flow (Server-Side)

1. Receive edit request
2. Read current page HTML from disk
3. Extract style reference (cached)
4. Build prompt:
   - **Scoped edit:** "Here is a complete HTML page. The user has selected the element at {xpath}. Modify ONLY that element according to their instruction. Return the complete modified element HTML. Instruction: {prompt}"
   - **Full page edit:** "Here is a complete HTML page. Modify it according to the user's instruction. Return the complete modified HTML page. Instruction: {prompt}"
5. Call Anthropic SDK with streaming enabled
6. Stream chunks back to browser via SSE
7. When complete:
   - For scoped edits: locate the target element in the original HTML and replace it
   - For full page edits: use the returned HTML directly
8. Write modified HTML to disk
9. Broadcast `reload` to all viewers

### Scoped Edit: Element Replacement Strategy

For element-scoped edits, we need to surgically replace one element in the full HTML. Approach:

1. Parse original HTML loosely (regex-based, not full DOM parser — these are well-structured prototypes)
2. Use the XPath to locate the target element's start/end positions in the source
3. Replace that range with the AI's output
4. Write the result

This avoids sending the full 1000-line page through Claude when only a small section needs changing, saving tokens and latency.

If the replacement approach fails (can't locate element, malformed result), fall back to a full-page edit.

### Prompt History

The editor toolbar keeps a dropdown of the last 10 prompts for this page (stored in localStorage). Clicking a previous prompt re-runs it. This lets users iterate: "Add a filter dropdown" → "Move the filter to the right side" → "Add an 'All' option to the dropdown".

### Keyboard Shortcut

`Ctrl+K` / `Cmd+K` opens the AI prompt bar (when edit mode is on). Same pattern as VS Code command palette.

---

## Phase 2: Create New Prototype Page

### User Experience

Two entry points:

**1. From the index page (`/`)**

The auto-generated index page that lists all prototypes gets a "Create New Page" section:

```
┌─────────────────────────────────────────────────────────────────┐
│  + Create New Prototype                                         │
│                                                                 │
│  Page name: [accreditation-office      ]                        │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Describe the page...                                       │ │
│  │                                                            │ │
│  │ The accreditation office view. A full-screen scan input    │ │
│  │ at the top. When a credential is scanned, show the        │ │
│  │ participant's photo, name, affiliation, and all their      │ │
│  │ active entitlements as color-coded cards. Big green/red    │ │
│  │ banner for access granted/denied. Button to print badge.   │ │
│  │                                                            │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  [Use existing page as starting point: [ None ▾ ]]              │
│                                                                 │
│  [ Generate with AI ✨ ]                                        │
└─────────────────────────────────────────────────────────────────┘
```

**2. From the editor toolbar (on any page)**

A "New Page" button in the editor toolbar opens a modal with the same form. If triggered from an existing page, that page is pre-selected as the "starting point."

### "Starting Point" Option

The user can optionally select an existing page as a base. When set:
- The full HTML of that page is included in the AI context
- The prompt tells Claude: "Use this page as a structural reference — keep the same layout, navigation, and styling, but replace the main content area."
- This is extremely useful because the prototypes share so much boilerplate (navbar, sidebar, CSS vars, shared classes)

When no starting point is selected, the AI generates from scratch using the style reference.

### API Endpoint

```
POST /_/ai/create
Content-Type: application/json

{
  "filename": "12-accreditation-office",
  "prompt": "The accreditation office view. A full-screen scan input at the top...",
  "basePage": "07-checkpoints"     // optional starting point
}
```

**Response:** SSE stream, same as edit:

```
event: status
data: {"message": "Generating 12-accreditation-office.html..."}

event: progress
data: {"percent": 35, "message": "Building main content area..."}

event: chunk
data: {"html": "<!DOCTYPE html>..."}

event: done
data: {"filename": "12-accreditation-office.html", "url": "/12-accreditation-office", "lines": 847}
```

### Generation Flow (Server-Side)

1. Validate filename (no collisions, valid chars)
2. Build prompt with full context:
   - System prompt (with scaffold.yml, style reference, page list)
   - If basePage: include its full HTML with instruction to use it as structural reference
   - If no basePage: include style reference only
   - User's description
3. Call Anthropic SDK (streaming)
4. Stream chunks to browser
5. On completion: write `{filename}.html` to project directory
6. Update the internal page registry
7. Broadcast new page availability to all connected clients
8. Return the URL so the browser can navigate to it

### Generation Prompt Structure

```
{system prompt with scaffold.yml, style reference, page list}

USER:
Create a new prototype page called "{filename}".

{IF basePage}
Use the following page as your structural starting point — keep the same
layout (navbar, sidebar, styling, CSS variables), but replace the main
content area entirely:

<reference_page>
{basePageHtml}
</reference_page>
{END IF}

{IF components exist}
The following reusable components are available. Use them where appropriate
by copying their HTML directly (they are not web components, just HTML patterns):

<available_components>
{componentList with descriptions and HTML}
</available_components>
{END IF}

Description of the new page:
{userPrompt}

Requirements:
- The page must be a complete, self-contained HTML document
- Include all CSS custom properties, CDN links, and Alpine.js setup
- Sidebar navigation must include all existing pages AND this new page
- Use realistic Norwegian mock data in x-data
- All interactivity via Alpine.js (modals, tabs, filters, toggles)
- Make it feel like a real production admin interface, not a wireframe
```

### Claude Code Fallback

If the SDK generation produces an incomplete or broken page (detected by checking for `</html>` at the end and basic structure validation), and Claude Code CLI is available, the server can retry via Claude Code:

```typescript
const prompt = `Create a file called ${filename}.html in the current directory. ${userPrompt}

Style reference: look at the existing .html files in this directory and match their design system exactly.
Data model: read scaffold.yml for the data schema.`;

await claudeCode(prompt, projectDir);
```

Claude Code's advantage here is it can read the actual files in the directory, iterate if the result is wrong, and produce a more polished output. The tradeoff is speed (30-60s vs 5-15s for SDK).

The user can also explicitly request Claude Code mode via a toggle in the UI: "Use Claude Code (slower, higher quality)".

---

## Phase 3: Component System

### What Is a Component

A component in Scaffold is a **reusable HTML snippet** — a chunk of markup with optional Alpine.js state, stored as a file, that can be inserted into any prototype page. Components are NOT web components or custom elements. They're copy-paste patterns with documentation.

Think of them as a project-specific snippet library. Examples:

- `stat-card.html` — A dashboard metric card (icon, number, label, trend arrow)
- `data-table.html` — A sortable table with pagination
- `modal-form.html` — A modal dialog with a form inside
- `filter-bar.html` — A horizontal row of filter dropdowns
- `empty-state.html` — An empty state illustration with CTA
- `sidebar-nav.html` — The shared sidebar navigation

### Component File Format

Stored in `components/` directory as `.html` files with a YAML frontmatter block:

```html
---
name: Stat Card
description: Dashboard metric card with icon, value, label, and optional trend indicator
category: Data Display
props:
  - { name: icon, description: "Emoji or SVG icon", default: "📊" }
  - { name: value, description: "The metric number", default: "1,234" }
  - { name: label, description: "What the number represents", default: "Total Items" }
  - { name: trend, description: "Percentage change, positive or negative", default: "+12%" }
  - { name: trend_direction, description: "up or down", default: "up" }
alpine: |
  Properties to merge into the parent x-data:
    statValue: 1234
    statTrend: 12
---
<div class="rounded-md p-4" style="background: var(--bg-sidebar); border: 1px solid var(--border-default);">
  <div class="flex items-center justify-between mb-2">
    <span class="text-lg">{icon}</span>
    <span class="text-xs font-medium px-2 py-0.5 rounded-full"
      :class="{trend_direction} === 'up' ? 'text-green-400 bg-green-400/10' : 'text-red-400 bg-red-400/10'"
      x-text="{trend}">
    </span>
  </div>
  <div class="text-2xl font-bold text-white" x-text="{value}"></div>
  <div class="text-xs mt-1" style="color: var(--text-soft);" x-text="{label}"></div>
</div>
```

### Component Directory Structure

```
components/
├── data-display/
│   ├── stat-card.html
│   ├── data-table.html
│   └── key-value-list.html
├── forms/
│   ├── modal-form.html
│   ├── filter-bar.html
│   └── inline-edit.html
├── feedback/
│   ├── empty-state.html
│   ├── toast.html
│   └── confirm-dialog.html
├── layout/
│   ├── sidebar-nav.html
│   ├── page-header.html
│   └── two-panel.html
└── badges/
    ├── status-badge.html
    └── type-badge.html
```

Categories are just subdirectories. Flat structure (no nesting beyond one level).

### Component Palette (Editor UI)

When edit mode is ON, the editor toolbar gets a component palette button. Clicking it opens a panel (inside shadow DOM, slide-out from the right side):

```
┌─ Components ──────────────────────────────────┐
│ 🔍 [Search components...]                     │
│                                                │
│ ▾ Data Display                                 │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐     │
│   │ 📊       │ │ 📋       │ │ 📝       │     │
│   │ Stat     │ │ Data     │ │ Key-Value │     │
│   │ Card     │ │ Table    │ │ List      │     │
│   └──────────┘ └──────────┘ └──────────┘     │
│                                                │
│ ▾ Forms                                        │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐     │
│   │ 🪟       │ │ 🔽       │ │ ✏️        │     │
│   │ Modal    │ │ Filter   │ │ Inline   │     │
│   │ Form     │ │ Bar      │ │ Edit     │     │
│   └──────────┘ └──────────┘ └──────────┘     │
│                                                │
│ ── Generate ──────────────────────────────     │
│ ┌────────────────────────────────────────┐     │
│ │ Describe a component to generate...    │     │
│ └────────────────────────────────────────┘     │
│ [ Generate Component ✨ ]                      │
└────────────────────────────────────────────────┘
```

### Inserting a Component

**Drag-and-drop or click-to-insert:**

1. User selects a component from the palette
2. The component's HTML is shown in a preview tooltip
3. User clicks a location in the page (an insertion point appears between elements as a blue horizontal line when hovering in edit mode)
4. The component HTML is inserted at that position
5. If the component has `alpine:` metadata, a note appears: "This component uses Alpine state — you may need to add these properties to your x-data: `statValue: 1234, statTrend: 12`"

The insertion is a literal paste — the component HTML is injected into the DOM at the insertion point. It's now part of the page. There's no component instance tracking or live binding. Edit it freely after insertion.

### Extracting a Component from a Page

In edit mode, when an element is selected, the toolbar shows an "Extract Component" button:

1. User selects an element (e.g., a stat card they built manually)
2. Clicks "Extract Component"
3. A dialog appears:
   - **Name:** `stat-card`
   - **Description:** "Dashboard metric card with icon and trend"  (pre-filled by AI based on the HTML)
   - **Category:** `data-display`  (dropdown of existing categories + "New...")
   - **Preview:** the selected HTML rendered
4. User confirms → the HTML is saved to `components/{category}/{name}.html` with auto-generated frontmatter
5. The original HTML stays in the page (extraction is a copy, not a move)

The AI is involved in extraction to:
- Generate the `description` from the HTML structure
- Identify which hardcoded values should become `props` (e.g., the number "1,234" → `{value}`)
- Generate the frontmatter YAML

### API Endpoints

**List components:**
```
GET /_/ai/components

Response:
{
  "components": [
    {
      "name": "stat-card",
      "description": "Dashboard metric card with icon, value, label, and trend",
      "category": "data-display",
      "path": "components/data-display/stat-card.html",
      "props": [{ "name": "icon", "default": "📊" }, ...]
    },
    ...
  ]
}
```

**Get component HTML:**
```
GET /_/ai/components/data-display/stat-card

Response:
{
  "meta": { "name": "Stat Card", "description": "...", "props": [...] },
  "html": "<div class=\"rounded-md p-4\" ...>...</div>"
}
```

**Generate component with AI:**
```
POST /_/ai/components/generate
Content-Type: application/json

{
  "prompt": "A horizontal progress bar with a label, current/total count, and percentage. Uses the project's color variables.",
  "category": "data-display",
  "name": "progress-bar"
}
```

Response: SSE stream → on completion, file written to `components/{category}/{name}.html`

**Extract component from selection:**
```
POST /_/ai/components/extract
Content-Type: application/json

{
  "html": "<div class=\"rounded-md p-4\">...</div>",
  "suggestedName": "stat-card",
  "category": "data-display"
}
```

Response: AI-generated frontmatter + parameterized HTML.

**Modify existing component with AI:**
```
POST /_/ai/components/edit
Content-Type: application/json

{
  "component": "data-display/stat-card",
  "prompt": "Add a sparkline mini-chart below the value using inline SVG"
}
```

### Component Generation Prompt

```
{system prompt}

USER:
Generate a reusable HTML component for a Scaffold prototype project.

Component name: {name}
Description: {prompt}

Requirements:
- Output a single HTML snippet (NOT a full page — no <html>, <head>, <body>)
- Use the project's CSS custom properties (var(--bg-sidebar), var(--text-default), etc.)
- Use Tailwind utility classes for spacing, layout, flex/grid
- If interactivity is needed, use Alpine.js attributes (x-show, @click, x-text, etc.)
- Use placeholder values that make the purpose clear: realistic labels, realistic numbers
- Keep it self-contained: no external dependencies beyond Tailwind + Alpine + the CSS vars
- Include YAML frontmatter with: name, description, category, and props (parameterizable values)

Format:
---
name: {Name}
description: {one-line description}
category: {category}
props:
  - { name: propName, description: "what it is", default: "default value" }
---
<div ...>
  ... component HTML using {propName} for parameterized values ...
</div>
```

### Component in AI Context

When the AI generates or edits pages (Phase 1 and 2), available components are listed in the context so Claude can reference existing patterns:

```
AVAILABLE COMPONENTS:
- stat-card (data-display): Dashboard metric card with icon, value, label, and trend
- data-table (data-display): Sortable table with pagination and row selection
- modal-form (forms): Modal dialog with form fields and save/cancel buttons
- filter-bar (forms): Horizontal filter row with dropdowns and search
- empty-state (feedback): Illustrated empty state with description and CTA
```

Claude is instructed to use these patterns when building pages rather than inventing new markup for the same concept. This creates visual consistency across pages without any runtime component system.

### Bootstrap Components

When `scaffold init` runs, it can optionally generate a starter component set extracted from the project's existing HTML files:

```
scaffold init . --extract-components
```

This scans all `.html` files, uses the AI to identify recurring patterns (sidebar, navbar, table structures, badges, buttons, modals), and creates the initial `components/` directory. This is a one-time operation.

Alternatively, `scaffold init` can generate a small default set of generic components that work with any dark-themed admin prototype.

---

## Configuration

### scaffold.yml AI Section

```yaml
ai:
  # Model for all AI operations (default: claude-sonnet-4-20250514)
  model: claude-sonnet-4-20250514

  # Max tokens for generation (default: 16000)
  max_tokens: 16000

  # Which file to extract the style reference from (default: first .html file found)
  style_reference: "02-participants.html"

  # Whether to prefer Claude Code CLI for new page generation (default: false)
  # Only has effect if `claude` binary is in PATH
  prefer_claude_code: false

  # Custom instructions appended to every AI prompt
  # Use this for project-specific style rules, naming conventions, etc.
  instructions: |
    This project is a prototype for Crescat's festival management platform.
    Always use Norwegian names for mock data.
    The design language is dark, professional, information-dense.
    Avoid rounded corners larger than 6px.
    Never use emoji in the UI except in category icons.
```

### Environment Variables

```bash
ANTHROPIC_API_KEY=sk-ant-...    # Required for SDK mode
# Claude Code uses its own auth — no config needed if already logged in
```

---

## URL Routing (additions to SPEC.md)

| Pattern | Method | Handler |
|---------|--------|---------|
| `/_/ai/edit` | POST | Edit current page with AI (SSE response) |
| `/_/ai/create` | POST | Generate new prototype page (SSE response) |
| `/_/ai/components` | GET | List all components |
| `/_/ai/components/:category/:name` | GET | Get single component HTML + meta |
| `/_/ai/components/generate` | POST | Generate component with AI (SSE response) |
| `/_/ai/components/extract` | POST | Extract component from selected HTML |
| `/_/ai/components/edit` | POST | Modify existing component with AI (SSE response) |

---

## Editor UI Additions

### Phase 1: AI Prompt Bar

Added to the existing editor toolbar (shadow DOM):

- Text input with placeholder "Ask AI..." — appears when edit mode is ON
- `Ctrl+K` / `Cmd+K` to focus
- Submits on Enter (Shift+Enter for multiline)
- While AI is working: input disabled, spinner shown, streamed status messages below
- On completion: page reloads with changes applied
- Prompt history dropdown (last 10, localStorage)
- When element is selected: prompt bar shows context indicator ("Edit `div.grid.grid-cols-3`")

### Phase 2: New Page Button

- "+" button in the editor toolbar → opens creation modal (slide-up panel in shadow DOM)
- Also accessible from the index page (`/`)
- Fields: filename, description (textarea), base page (dropdown), Claude Code toggle
- Progress shown as SSE stream with status messages
- On completion: browser navigates to the new page

### Phase 3: Component Palette

- Palette button (puzzle piece icon) in editor toolbar → opens slide-out panel from right
- Panel is in shadow DOM, doesn't conflict with page styles
- Component grid with category headers, search, and thumbnails
- Click component → enters "insertion mode" where hovering over the page shows blue insertion indicators between elements
- Click to insert, ESC to cancel
- "Extract" button appears when element is selected in edit mode
- "Generate" section at bottom of palette with prompt input

---

## Dependencies (additions to SPEC.md)

| Package | Purpose |
|---------|---------|
| `@anthropic-ai/sdk` | Anthropic API client |
| `yaml` | Parse scaffold.yml AND component frontmatter |

Claude Code CLI is optional — detected at startup, not a declared dependency.

---

## Implementation Priority

### Phase 1: Edit Page with AI
1. Add `@anthropic-ai/sdk` dependency
2. Style reference extraction from existing HTML files
3. System prompt assembly (scaffold.yml + style ref + page list)
4. `/_/ai/edit` endpoint with SSE streaming
5. Scoped edit: XPath-based element location + replacement
6. Full page edit: direct HTML replacement
7. Editor UI: prompt bar in shadow DOM toolbar
8. Prompt history (localStorage)
9. `Ctrl+K` shortcut

### Phase 2: Create New Prototype
1. `/_/ai/create` endpoint with SSE streaming
2. "Base page" context assembly
3. Creation UI on index page + editor toolbar
4. File creation + page registry update + broadcast
5. Claude Code CLI fallback (if available)
6. Basic validation of generated output (complete HTML structure)

### Phase 3: Component System
1. `components/` directory convention + frontmatter parser
2. Component listing API
3. Component palette UI in editor (shadow DOM panel)
4. Click-to-insert with insertion point indicators
5. Component extraction (with AI-generated frontmatter)
6. Component generation endpoint
7. Component editing endpoint
8. Bootstrap component extraction (`scaffold init --extract-components`)
9. Component context in page edit/create prompts
