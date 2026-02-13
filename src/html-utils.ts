// ─── HTML Utility Functions ───────────────────────────────────────────────────

export function extractTitle(html: string): string {
  const match = html.match(/<title>(.+?)<\/title>/i);
  return match ? match[1] : "";
}

export function validateHtmlStructure(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes("<!doctype") &&
    lower.includes("<html") &&
    lower.includes("</html>") &&
    lower.includes("<body") &&
    lower.includes("</body>")
  );
}

export function stripCodeFences(text: string): string {
  // Strip ```html ... ``` or ``` ... ```
  const fenced = text.match(/^```(?:html)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fenced) return fenced[1];
  // Also handle case where there's text before/after the fences
  const inner = text.match(/```(?:html)?\s*\n([\s\S]*?)\n```/);
  if (inner) return inner[1];
  return text;
}

// ─── XPath-based Element Replacement ──────────────────────────────────────────

interface XPathSegment {
  tag: string;
  nthChild?: number;
  classes?: string[];
  id?: string;
}

function parseXPath(xpath: string): XPathSegment[] {
  // Parse "body > main > div:nth-child(2) > div.grid.grid-cols-3" or "p#target"
  const parts = xpath.split(">").map((s) => s.trim()).filter(Boolean);
  return parts.map((part) => {
    const seg: XPathSegment = { tag: "" };

    // Extract nth-child
    const nthMatch = part.match(/:nth-child\((\d+)\)/);
    if (nthMatch) {
      seg.nthChild = parseInt(nthMatch[1]);
      part = part.replace(/:nth-child\(\d+\)/, "");
    }

    // Extract id (tag#some-id)
    const hashIdx = part.indexOf("#");
    if (hashIdx !== -1) {
      seg.tag = part.slice(0, hashIdx).toLowerCase();
      // id is everything after # up to first dot (if classes follow)
      const afterHash = part.slice(hashIdx + 1);
      const dotIdx = afterHash.indexOf(".");
      if (dotIdx !== -1) {
        seg.id = afterHash.slice(0, dotIdx);
        seg.classes = afterHash.slice(dotIdx + 1).split(".");
      } else {
        seg.id = afterHash;
      }
      return seg;
    }

    // Extract classes
    const dotParts = part.split(".");
    seg.tag = dotParts[0].toLowerCase();
    if (dotParts.length > 1) {
      seg.classes = dotParts.slice(1);
    }

    return seg;
  });
}

function matchesSegment(tag: string, classes: string[], segment: XPathSegment, id?: string): boolean {
  if (tag.toLowerCase() !== segment.tag) return false;
  if (segment.id) {
    return id === segment.id;
  }
  if (segment.classes) {
    for (const cls of segment.classes) {
      if (!classes.includes(cls)) return false;
    }
  }
  return true;
}

/**
 * Replace an element located by XPath selector in the HTML string.
 * Returns the modified HTML, or null if the element couldn't be found.
 */
export function replaceElementByXpath(html: string, xpath: string, newHtml: string): string | null {
  const segments = parseXPath(xpath);
  if (segments.length === 0) return null;

  // We need to find the target element by walking the HTML string
  let searchStart = 0;

  for (let si = 0; si < segments.length; si++) {
    const segment = segments[si];
    const isLast = si === segments.length - 1;

    // Find nth occurrence of this tag at the current nesting level
    const found = findElement(html, searchStart, segment);
    if (found === null) return null;

    if (isLast) {
      // Replace this element
      const endPos = findClosingTag(html, found.start, found.tag);
      if (endPos === null) return null;
      return html.slice(0, found.start) + newHtml + html.slice(endPos);
    } else {
      // Move search start inside this element's content
      searchStart = found.contentStart;
    }
  }

  return null;
}

interface FoundElement {
  start: number;
  contentStart: number;
  tag: string;
}

function findElement(html: string, from: number, segment: XPathSegment): FoundElement | null {
  // Find opening tags matching the segment
  const tagRegex = new RegExp(`<${segment.tag}(\\s[^>]*)?>`, "gi");
  tagRegex.lastIndex = from;

  let childCount = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(html)) !== null) {
    const fullMatch = match[0];
    const attrs = match[1] || "";

    // Extract classes from class attribute
    const classMatch = attrs.match(/class\s*=\s*["']([^"']+)["']/);
    const classes = classMatch ? classMatch[1].split(/\s+/) : [];

    // Extract id from id attribute
    const idMatch = attrs.match(/id\s*=\s*["']([^"']+)["']/);
    const id = idMatch ? idMatch[1] : undefined;

    if (matchesSegment(segment.tag, classes, segment, id)) {
      childCount++;

      if (!segment.nthChild || childCount === segment.nthChild) {
        return {
          start: match.index,
          contentStart: match.index + fullMatch.length,
          tag: segment.tag,
        };
      }
    }
  }

  return null;
}

// Void elements that don't have closing tags
const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

function findClosingTag(html: string, openStart: number, tag: string): number | null {
  if (VOID_ELEMENTS.has(tag.toLowerCase())) {
    // For void elements, find end of opening tag
    const end = html.indexOf(">", openStart);
    return end === -1 ? null : end + 1;
  }

  // Find the matching closing tag by counting depth
  const openRegex = new RegExp(`<${tag}(\\s[^>]*)?>`, "gi");
  const closeRegex = new RegExp(`</${tag}\\s*>`, "gi");

  // Start searching after the opening tag
  const openTagEnd = html.indexOf(">", openStart);
  if (openTagEnd === -1) return null;

  let depth = 1;
  let pos = openTagEnd + 1;

  while (depth > 0 && pos < html.length) {
    openRegex.lastIndex = pos;
    closeRegex.lastIndex = pos;

    const nextOpen = openRegex.exec(html);
    const nextClose = closeRegex.exec(html);

    if (!nextClose) return null; // Unbalanced tags

    if (nextOpen && nextOpen.index < nextClose.index) {
      // Check if it's a self-closing tag
      if (!nextOpen[0].endsWith("/>")) {
        depth++;
      }
      pos = nextOpen.index + nextOpen[0].length;
    } else {
      depth--;
      if (depth === 0) {
        return nextClose.index + nextClose[0].length;
      }
      pos = nextClose.index + nextClose[0].length;
    }
  }

  return null;
}
