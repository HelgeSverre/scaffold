// ─── Prompt Templates ─────────────────────────────────────────────────────────

export function editScopedPrompt(xpath: string, selectedHtml: string, instruction: string): string {
  return `The user has selected the element at XPath: ${xpath}

Selected element HTML:
<selected_element>
${selectedHtml}
</selected_element>

Modify ONLY this element according to the user's instruction. Return ONLY the complete modified element HTML. Do not return the full page — just the replacement for this element.

User instruction: ${instruction}`;
}

export function editFullPagePrompt(currentPageHtml: string, instruction: string): string {
  return `Here is the current complete HTML page:

<current_page>
${currentPageHtml}
</current_page>

Modify this page according to the user's instruction. Return the complete modified HTML page.

User instruction: ${instruction}`;
}

export function createPagePrompt(
  filename: string,
  description: string,
  basePage?: string,
  components?: { name: string; category: string; description: string }[]
): string {
  let prompt = `Create a new prototype page called "${filename}".

`;

  if (basePage) {
    prompt += `Use the following page as your structural starting point — keep the same layout (navbar, sidebar, styling, CSS variables), but replace the main content area entirely:

<reference_page>
${basePage}
</reference_page>

`;
  }

  if (components && components.length > 0) {
    const compList = components
      .map((c) => `- ${c.name} (${c.category}): ${c.description}`)
      .join("\n");
    prompt += `The following reusable components are available. Use them where appropriate by copying their HTML directly (they are not web components, just HTML patterns):

<available_components>
${compList}
</available_components>

`;
  }

  prompt += `Description of the new page:
${description}

Requirements:
- The page must be a complete, self-contained HTML document
- Include all CSS custom properties, CDN links, and Alpine.js setup
- Sidebar navigation must include all existing pages AND this new page
- Use realistic mock data in x-data
- All interactivity via Alpine.js (modals, tabs, filters, toggles)
- Make it feel like a real production admin interface, not a wireframe`;

  return prompt;
}

export function generateComponentPrompt(name: string, category: string, description: string): string {
  return `Generate a reusable HTML component for a Scaffold prototype project.

Component name: ${name}
Category: ${category}
Description: ${description}

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
name: ${name}
description: one-line description
category: ${category}
props:
  - { name: propName, description: "what it is", default: "default value" }
---
<div ...>
  ... component HTML ...
</div>`;
}

export function extractComponentPrompt(html: string): string {
  return `Analyze this HTML element and generate component metadata for it.

HTML:
<element>
${html}
</element>

Generate YAML frontmatter for this HTML as a reusable component. Include:
- name: a short kebab-case name
- description: one-line description of what this component does
- category: one of data-display, forms, feedback, layout, navigation, or badges
- props: array of parameterizable values found in the HTML (labels, numbers, icons, etc.)
- alpine: (only if Alpine.js attributes are present) description of required x-data properties

Return ONLY the YAML frontmatter block (between --- delimiters), no other text.`;
}

export function extractStylePrompt(): string {
  return `Analyze this HTML prototype and produce a concise style guide in markdown format. Extract:

1. CSS custom properties (from :root blocks)
2. Shared CSS classes with their purpose
3. Layout structure (navbar, sidebar, content area dimensions)
4. CDN dependencies (Tailwind, Alpine, fonts, etc.)
5. Alpine.js patterns (how x-data is structured)
6. Design conventions (spacing, border radius, color patterns)

Output a clean markdown document starting with "# Project Style Guide" suitable for inclusion in AI prompts.`;
}
