import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Window } from "happy-dom";
import { readFileSync } from "fs";
import { join } from "path";

const editorJs = readFileSync(
  join(import.meta.dir, "../src/assets/editor.js"),
  "utf-8"
);

let win: InstanceType<typeof Window>;
let doc: Document;

// Stash originals so we can restore after each test
const origGlobals: Record<string, any> = {};

function setup(opts: { aiEnabled?: boolean } = {}) {
  win = new Window({ url: "http://localhost:3000/test" });
  doc = win.document as unknown as Document;

  // Minimal HTML structure
  doc.body.innerHTML = `
    <h1>Title</h1>
    <p id="target">Some text</p>
    <div id="other">Other content</div>
  `;

  // Configure scaffold globals
  (win as any).__SCAFFOLD__ = {
    page: "/test",
    ws: "ws://localhost:3000/_/ws",
    aiEnabled: opts.aiEnabled ?? true,
    pages: [{ name: "test", path: "/test" }],
  };

  // Stub fetch
  (win as any).fetch = () =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({}) });

  // Install ALL happy-dom window properties as globals so the IIFE works
  for (const k of Object.getOwnPropertyNames(win)) {
    if (k === "undefined" || k === "NaN" || k === "Infinity") continue;
    try {
      origGlobals[k] = (globalThis as any)[k];
      (globalThis as any)[k] = (win as any)[k];
    } catch {}
  }
  (globalThis as any).window = win;
  (globalThis as any).document = doc;

  // Patch attachShadow to force open mode (closed shadow roots aren't testable)
  const origAttachShadow = (win as any).HTMLElement.prototype.attachShadow;
  (win as any).HTMLElement.prototype.attachShadow = function (init: any) {
    return origAttachShadow.call(this, { ...init, mode: "open" });
  };

  // Evaluate the IIFE in the patched global context
  new Function(editorJs)();
}

function teardown() {
  // Restore original globals
  for (const [k, v] of Object.entries(origGlobals)) {
    if (v === undefined) {
      delete (globalThis as any)[k];
    } else {
      (globalThis as any)[k] = v;
    }
  }
  win.close();
}

/**
 * Helper: get the shadow root of <scaffold-editor>.
 * happy-dom exposes shadowRoot even for closed shadow roots.
 */
function getShadowRoot(): ShadowRoot {
  const host = doc.querySelector("scaffold-editor");
  if (!host) throw new Error("scaffold-editor not found");
  return (host as any).shadowRoot ?? (host as any).__shadowRoot;
}

function enterEditMode() {
  const sr = getShadowRoot();
  const editBtn = sr.querySelector('[data-action="edit"]') as HTMLElement;
  if (!editBtn) throw new Error("Edit button not found");
  // Use dispatchEvent instead of .click() for reliable bubbling in happy-dom
  const Ctor = (win as any).MouseEvent;
  editBtn.dispatchEvent(new Ctor("click", { bubbles: true, cancelable: true }));
}

function selectTarget(el: HTMLElement) {
  const Ctor = (win as any).MouseEvent;
  el.dispatchEvent(new Ctor("click", { bubbles: true, cancelable: true }));
}

function pressKey(
  target: EventTarget,
  key: string,
  opts: KeyboardEventInit = {}
) {
  const Ctor = (win as any).KeyboardEvent;
  const event = new Ctor("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...opts,
  });
  target.dispatchEvent(event);
}

describe("editor keyboard handling", () => {
  beforeEach(() => setup({ aiEnabled: true }));
  afterEach(() => teardown());

  test("Backspace in AI input does not delete selected element", () => {
    const target = doc.getElementById("target")!;

    // Verify edit mode activates (button gets "active" class)
    const sr = getShadowRoot();
    const editBtn = sr.querySelector('[data-action="edit"]') as HTMLElement;
    enterEditMode();
    expect(editBtn.classList.contains("active")).toBe(true);

    selectTarget(target);
    expect(target.hasAttribute("data-scaffold-selected")).toBe(true);

    // Focus the AI input in shadow DOM
    const aiInput = sr.querySelector(".scaffold-ai-input") as HTMLInputElement;
    expect(aiInput).toBeTruthy();
    aiInput.focus();

    // Press Backspace while focused in AI input
    pressKey(aiInput, "Backspace");

    // Element should NOT be removed
    expect(doc.getElementById("target")).not.toBeNull();
    expect(target.parentNode).not.toBeNull();
  });

  test("Delete key in AI input does not delete selected element", () => {
    const target = doc.getElementById("target")!;

    enterEditMode();
    selectTarget(target);

    const sr = getShadowRoot();
    const aiInput = sr.querySelector(".scaffold-ai-input") as HTMLInputElement;
    aiInput.focus();

    pressKey(aiInput, "Delete");

    expect(doc.getElementById("target")).not.toBeNull();
  });

  test("Backspace with no input focused DOES delete selected element", () => {
    const target = doc.getElementById("target")!;

    enterEditMode();
    selectTarget(target);
    expect(target.hasAttribute("data-scaffold-selected")).toBe(true);

    // Press Backspace on the document (no input focused)
    pressKey(doc as unknown as EventTarget, "Backspace");

    // Element SHOULD be removed
    expect(doc.getElementById("target")).toBeNull();
  });

  test("Escape in AI input does not deselect element", () => {
    const target = doc.getElementById("target")!;

    enterEditMode();
    selectTarget(target);

    const sr = getShadowRoot();
    const aiInput = sr.querySelector(".scaffold-ai-input") as HTMLInputElement;
    aiInput.focus();

    pressKey(aiInput, "Escape");

    // stopPropagation prevents global handler from deselecting
    expect(target.hasAttribute("data-scaffold-selected")).toBe(true);
  });
});

describe("editor keyboard handling without AI", () => {
  beforeEach(() => setup({ aiEnabled: false }));
  afterEach(() => teardown());

  test("Backspace deletes selected element when no inputs exist", () => {
    const target = doc.getElementById("target")!;

    enterEditMode();
    selectTarget(target);

    pressKey(doc as unknown as EventTarget, "Backspace");

    expect(doc.getElementById("target")).toBeNull();
  });
});
