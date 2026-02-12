# Scaffold

Bun-powered tool: YAML schema -> SQLite CRUD API + HTML prototype server with live-editor overlay.

## Commands

```bash
bun install                    # install deps
bun link                       # register `scaffold` CLI globally
bun test                       # run all tests (67 tests, 5 files)
bun run example/prototypes/index.ts  # start dev server on example prototypes
```

## Architecture

```
src/
├── cli.ts          # Commander.js CLI (scaffold init, scaffold dev)
├── index.ts        # Public API: export { startServer }
├── types.ts        # All shared types (ScaffoldConfig, EntityMeta, etc.)
├── schema.ts       # YAML parsing + entity metadata derivation
├── migration.ts    # SQLite CREATE/ALTER + seeding
├── router.ts       # Simple pattern-matching router (array-based)
├── crud.ts         # CRUD route generation (largest module ~500 lines)
├── html.ts         # HTML scanning, serving with injection, save endpoint
├── websocket.ts    # WebSocket manager (join/leave/broadcast per page)
├── watcher.ts      # fs.watch + 100ms debounce for hot-reload
├── functions.ts    # Custom function loader (functions/*.ts)
├── server.ts       # Composition: wires everything into Bun.serve()
└── assets/
    ├── editor.js   # Live editor overlay (vanilla JS, Shadow DOM, IIFE)
    └── editor.css  # Editor styles (scoped to shadow root)
```

## Key Conventions

- **Runtime:** Bun only. Use `bun:sqlite`, `Bun.serve()`, `Bun.write()`, `Bun.file()`
- **Dependencies:** Minimal — only `yaml`, `commander`. No Express, no ORM
- **Types:** All shared types in `src/types.ts`. Import from there, not inline
- **Entity naming:** PascalCase in YAML -> snake_case + `s` for table names, lowercase + `s` for route paths
- **Testing:** `bun:test` with in-memory SQLite (`:memory:`). Tests live in `tests/`
- **Assets:** `editor.js` is a single vanilla JS IIFE — no build step, no framework
- **Shadow DOM:** Editor UI lives inside closed shadow root. Selection styles inject into main document
- **CORS:** `Access-Control-Allow-Origin: *` on all `/api/*` responses

## Critical Rules

- IMPORTANT: Never modify files in `example/prototypes/*.html` — those are user prototypes
- IMPORTANT: `editor.js` must remain a single self-contained IIFE with no imports or build step
- IMPORTANT: Always run `bun test` after changes to `src/` to verify nothing breaks
- IMPORTANT: The save endpoint must strip ALL scaffold artifacts before writing HTML to disk
- When adding new entity features, update both `src/crud.ts` (API) and `tests/crud.test.ts`
- When changing schema parsing, update both `src/schema.ts` and `tests/schema.test.ts`
- SQLite queries use parameterized values (`?`) — never interpolate user input into SQL
- Column names are validated against an allowlist before use in SQL to prevent injection

## Self-Correction

After encountering an error or unexpected behavior:

1. **Read the actual error** — don't guess. Check the exact message and stack trace
2. **Trace to the root cause** — find which module/function produced the error
3. **Check the test suite** — run `bun test` to see if the issue is already covered
4. **Fix and verify** — make the minimal fix, re-run tests, confirm green
5. **Generalize** — if this class of bug could happen elsewhere, check related code

Common mistakes to watch for:
- Forgetting to handle `null`/`undefined` when deserializing SQLite rows
- SQL injection via string interpolation — always use `?` params + column allowlist
- Shadow DOM boundary: styles in shadow root don't affect main document and vice versa
- The `recently-saved` set in `watcher.ts` prevents reload loops on editor save
- `import.meta.dir` gives the source file's directory, not `process.cwd()`

## Self-Improvement

When you learn something new about this codebase during a session:
- If it's a pattern that would prevent future mistakes, note it in this file
- If it's a gotcha specific to a module, add a comment in the source code
- If a test is missing for an edge case you discovered, add the test
- Keep this file under 100 lines of actual content — consolidate, don't accumulate

## Verification Checklist

Before claiming work is complete:
- [ ] `bun test` passes (all 67+ tests green)
- [ ] No TypeScript errors from changed files
- [ ] If CRUD changes: tested via curl against running server
- [ ] If editor changes: tested in browser with an example prototype
- [ ] If schema changes: re-run server against example prototypes to verify migration
