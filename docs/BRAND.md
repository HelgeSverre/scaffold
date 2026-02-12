# scaffold. Brand Guide

## Colors

| Role | Hex | HSL | Tailwind |
|------|-----|-----|----------|
| Base (Dark Slate) | `#0F172A` | `222 47% 11%` | `slate-900` |
| Surface | `#1E293B` | `217 33% 17%` | `slate-800` |
| Primary (Teal) | `#14B8A6` | `173 80% 40%` | `teal-500` |
| Primary Light | `#2DD4BF` | `170 77% 50%` | `teal-400` |
| Primary Dark | `#0D9488` | `175 84% 32%` | `teal-600` |
| Text Light | `#E2E8F0` | `214 32% 91%` | `slate-200` |
| Text Muted | `#94A3B8` | `215 16% 65%` | `slate-400` |
| Text Dark | `#0F172A` | `222 47% 11%` | `slate-900` |
| Success | `#10B981` | `160 84% 39%` | `emerald-500` |
| Warning | `#F59E0B` | `38 92% 50%` | `amber-500` |
| Error | `#EF4444` | `0 84% 60%` | `red-500` |

### Usage

- **Base** — page backgrounds, badge/label backgrounds
- **Surface** — cards, panels, code blocks
- **Primary** — links, buttons, accents, interactive elements
- **Primary Light** — hover states, active indicators
- **Primary Dark** — pressed states, focus rings
- **Text Light** — headings, body text on dark backgrounds
- **Text Muted** — secondary text, captions, timestamps
- **Text Dark** — text on light/teal backgrounds

## Typography

| Role | Font | Weight | Fallback |
|------|------|--------|----------|
| Headings / Logo | Inter | 600–700 | `system-ui, -apple-system, sans-serif` |
| Body | Inter | 400 | `system-ui, -apple-system, sans-serif` |
| Code / CLI | JetBrains Mono | 400 | `ui-monospace, monospace` |

### Scale

Use a modular scale. Recommended sizes for web:

- Hero: 48px / 3rem
- H1: 36px / 2.25rem
- H2: 24px / 1.5rem
- H3: 20px / 1.25rem
- Body: 16px / 1rem
- Small: 14px / 0.875rem
- Caption: 12px / 0.75rem

## Logo

The logo is a lowercase wordmark: **scaffold.** — with the trailing period in teal.

### Variants

| File | Background | Use |
|------|-----------|-----|
| `assets/logo.svg` | Dark slate `#0F172A` rounded rect | Dark backgrounds, README, marketing |
| `assets/logo-dark.svg` | Transparent | Light backgrounds, print, favicons |

### Guidelines

- **Minimum width:** 160px
- **Clear space:** At least 1/4 of the logo height on all sides
- **Do not** stretch, rotate, add drop shadows, or change the colors
- **Do not** use the logo at sizes below 120px wide — use the text "scaffold." in Inter Bold instead
- **Do not** remove or recolor the teal period — it's a core brand element

## Badges

All badges use [shields.io](https://shields.io) with consistent styling:

```
style=flat
labelColor=0F172A
color=14B8A6
```

### Template

```
https://img.shields.io/badge/{label}-{value}-14B8A6?style=flat&labelColor=0F172A
```

### Standard badges

```markdown
![Version](https://img.shields.io/badge/version-0.1.0-14B8A6?style=flat&labelColor=0F172A)
![License](https://img.shields.io/badge/license-MIT-14B8A6?style=flat&labelColor=0F172A)
![Runtime](https://img.shields.io/badge/runtime-Bun-14B8A6?style=flat&labelColor=0F172A)
![Tests](https://img.shields.io/badge/tests-67%20passed-14B8A6?style=flat&labelColor=0F172A)
![Website](https://img.shields.io/badge/scaffold.to-14B8A6?style=flat&labelColor=0F172A)
```

## Voice

- **Direct.** No marketing fluff. Say what it does.
- **Technical.** The audience is developers. Don't dumb it down.
- **Concise.** Short sentences. Short paragraphs. Code over prose.
- **Confident.** No hedging ("might", "could possibly"). State facts.
- **Lowercase preference.** "scaffold" not "Scaffold" in running text (except at sentence start).

### Examples

Good: "YAML schema in, CRUD API out."
Bad: "Scaffold empowers developers to rapidly prototype their ideas with an innovative schema-driven approach."

Good: "Define entities. Get endpoints. Edit live."
Bad: "Our cutting-edge live editing technology enables real-time collaboration."
