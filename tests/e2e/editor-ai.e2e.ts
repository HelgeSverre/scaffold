import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync, existsSync, rmSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fixtureDir = resolve(__dirname, "../fixtures/basic");
const indexPath = resolve(fixtureDir, "index.html");
const helloWorldPath = resolve(fixtureDir, "hello-world.html");
const componentsDir = resolve(fixtureDir, ".scaffold/components");

const hasRealKey =
  !!process.env.ANTHROPIC_API_KEY &&
  process.env.ANTHROPIC_API_KEY !== "test-key-for-e2e";

// Force closed shadow DOM to open so we can access editor elements
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const orig = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (opts: ShadowRootInit) {
      return orig.call(this, { ...opts, mode: "open" });
    };
  });
});

/** Helper to get a locator inside the shadow root */
function shadow(page: import("@playwright/test").Page, selector: string) {
  return page.locator(`scaffold-editor ${selector}`);
}

/** Click the Edit button to enter edit mode */
async function enterEditMode(page: import("@playwright/test").Page) {
  const editorHost = page.locator("scaffold-editor");
  await expect(editorHost).toBeAttached();

  const editBtn = shadow(page, '[data-testid="edit-btn"]');
  await editBtn.click();

  // Wait for edit mode to activate (AI bar becomes visible)
  const aiBar = shadow(page, ".scaffold-ai-bar");
  await expect(aiBar).toBeVisible();
}

/** Click an element in the main document to select it */
async function selectElement(
  page: import("@playwright/test").Page,
  selector: string
) {
  const el = page.locator(selector);
  await el.click();
  await expect(el).toHaveAttribute("data-scaffold-selected", "");
}

test.describe("AI Edit", () => {
  test.skip(!hasRealKey, "Skipped: ANTHROPIC_API_KEY not set");

  let originalIndex: string;

  test.beforeAll(() => {
    originalIndex = readFileSync(indexPath, "utf-8");
  });

  test.afterEach(() => {
    writeFileSync(indexPath, originalIndex);
  });

  test("make element green via AI edit", async ({ page }) => {
    await page.goto("/index");
    await enterEditMode(page);
    await selectElement(page, "#target");

    const aiInput = shadow(page, '[data-testid="ai-input"]');
    await aiInput.fill("make the text color green using a style attribute");

    const aiSubmit = shadow(page, '[data-testid="ai-submit"]');
    await aiSubmit.click();

    // Wait for AI to finish (up to 45s)
    const aiStatus = shadow(page, '[data-testid="ai-status"]');
    await expect(aiStatus).toContainText("Done! Reloading...", {
      timeout: 45_000,
    });

    // Page does NOT auto-reload in edit mode, navigate explicitly
    await page.goto("/index");

    // Assert target has green style
    const style = await page.locator("#target").getAttribute("style");
    expect(style).toMatch(/green|#0+8000|rgb\(0,\s*128,\s*0\)/i);
  });
});

test.describe("AI Create Page", () => {
  test.skip(!hasRealKey, "Skipped: ANTHROPIC_API_KEY not set");

  test.beforeAll(() => {
    if (existsSync(helloWorldPath)) rmSync(helloWorldPath);
  });

  test.afterAll(() => {
    if (existsSync(helloWorldPath)) rmSync(helloWorldPath);
  });

  test("create a hello-world page via AI", async ({ page }) => {
    await page.goto("/index");
    await enterEditMode(page);

    const newPageBtn = shadow(page, '[data-testid="new-page-btn"]');
    await newPageBtn.click();

    const nameInput = shadow(page, '[data-testid="new-page-name"]');
    await nameInput.fill("hello-world");

    const descInput = shadow(page, '[data-testid="new-page-desc"]');
    await descInput.fill(
      "A hello world page with lorem ipsum text. Make the footer blue."
    );

    // Base page defaults to current page (index), already selected

    const goBtn = shadow(page, '[data-testid="new-page-go"]');
    await goBtn.click();

    // Wait for navigation to hello-world (SSE done triggers redirect after 500ms)
    await page.waitForURL("**/hello-world", { timeout: 45_000 });

    // Assert body has content
    const bodyText = await page.locator("body").innerText();
    expect(bodyText.length).toBeGreaterThan(10);
  });
});

test.describe("AI Extract Component", () => {
  test.skip(!hasRealKey, "Skipped: ANTHROPIC_API_KEY not set");

  test.afterAll(() => {
    if (existsSync(componentsDir)) rmSync(componentsDir, { recursive: true });
  });

  test("extract status badge as component", async ({ page }) => {
    await page.goto("/components");
    await enterEditMode(page);
    await selectElement(page, "#extract-target");

    const extractBtn = shadow(page, '[data-testid="extract-btn"]');
    await extractBtn.click();

    // Verify name is pre-filled with "status-badge"
    const nameInput = shadow(page, '[data-testid="extract-name"]');
    await expect(nameInput).toHaveValue("status-badge");

    const catInput = shadow(page, '[data-testid="extract-cat"]');
    await catInput.fill("badges");

    const goBtn = shadow(page, '[data-testid="extract-go"]');
    await goBtn.click();

    // Extract endpoint returns JSON (not SSE), wait for status update
    const extractStatus = shadow(page, '[data-testid="extract-status"]');
    await expect(extractStatus).toContainText("Component saved to", {
      timeout: 45_000,
    });

    // Assert file exists
    const componentPath = resolve(
      componentsDir,
      "badges/status-badge.html"
    );
    expect(existsSync(componentPath)).toBe(true);
  });
});
