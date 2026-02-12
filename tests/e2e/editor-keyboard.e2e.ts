import { test, expect } from "@playwright/test";

// Force closed shadow DOM to open so we can access editor elements
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const orig = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (opts: ShadowRootInit) {
      return orig.call(this, { ...opts, mode: "open" });
    };
  });
});

/** Click the Edit button inside the scaffold-editor shadow DOM */
async function enterEditMode(page: import("@playwright/test").Page) {
  await page.goto("/index");
  const editorHost = page.locator("scaffold-editor");
  await expect(editorHost).toBeAttached();

  // Access the shadow root (forced open by addInitScript)
  const editBtn = editorHost.locator('[data-action="edit"]');
  await editBtn.click();

  // Wait for edit mode to activate (AI bar becomes visible)
  const aiBar = editorHost.locator(".scaffold-ai-bar");
  await expect(aiBar).toBeVisible();
}

/** Click an element in the main document to select it in the editor */
async function selectElement(
  page: import("@playwright/test").Page,
  selector: string
) {
  const el = page.locator(selector);
  await el.click();
  await expect(el).toHaveAttribute("data-scaffold-selected", "");
}

test.describe("Editor keyboard handling", () => {
  test("Backspace in AI input does not delete selected element", async ({
    page,
  }) => {
    await enterEditMode(page);
    await selectElement(page, "#target");

    // Focus the AI input and type something so Backspace has text to delete
    const aiInput = page.locator("scaffold-editor .scaffold-ai-input");
    await aiInput.fill("hello");
    await aiInput.focus();
    await page.keyboard.press("Backspace");

    // The selected element must still exist
    await expect(page.locator("#target")).toBeAttached();
    // And the input should have had a character removed, not the element
    await expect(aiInput).toHaveValue("hell");
  });

  test("Delete key in AI input does not delete selected element", async ({
    page,
  }) => {
    await enterEditMode(page);
    await selectElement(page, "#target");

    const aiInput = page.locator("scaffold-editor .scaffold-ai-input");
    await aiInput.fill("hello");
    await aiInput.focus();
    // Move cursor to start so Delete removes forward
    await page.keyboard.press("Home");
    await page.keyboard.press("Delete");

    await expect(page.locator("#target")).toBeAttached();
    await expect(aiInput).toHaveValue("ello");
  });

  test("Backspace with no input focused deletes selected element", async ({
    page,
  }) => {
    await enterEditMode(page);
    await selectElement(page, "#target");

    // Make sure focus is on the body, not any input
    await page.locator("body").click({ position: { x: 0, y: 0 } });
    // Re-select since body click may have changed selection
    await selectElement(page, "#target");

    // Blur any focused element
    await page.evaluate(() => {
      (document.activeElement as HTMLElement)?.blur?.();
    });

    await page.keyboard.press("Backspace");

    // The element should be removed
    await expect(page.locator("#target")).not.toBeAttached();
  });

  test("Typing in AI input works normally", async ({ page }) => {
    await enterEditMode(page);
    await selectElement(page, "#target");

    const aiInput = page.locator("scaffold-editor .scaffold-ai-input");
    await aiInput.focus();
    await aiInput.fill("");
    await page.keyboard.type("test prompt");

    await expect(aiInput).toHaveValue("test prompt");
    // Element should still exist
    await expect(page.locator("#target")).toBeAttached();
  });
});
