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

/** Get the toolbar element inside the scaffold-editor shadow DOM */
async function getToolbar(page: import("@playwright/test").Page) {
  await page.goto("/index");
  const editorHost = page.locator("scaffold-editor");
  await expect(editorHost).toBeAttached();
  const toolbar = editorHost.locator(".scaffold-toolbar");
  await expect(toolbar).toBeVisible();
  return toolbar;
}

/** Drag an element by offset using mouse events */
async function drag(
  page: import("@playwright/test").Page,
  startX: number,
  startY: number,
  endX: number,
  endY: number
) {
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 5 });
  await page.mouse.up();
}

test.describe("Toolbar drag clamping", () => {
  test("Toolbar stays within viewport when dragged to the left edge", async ({
    page,
  }) => {
    const toolbar = await getToolbar(page);
    const box = await toolbar.boundingBox();
    if (!box) throw new Error("Toolbar not visible");

    // Drag toolbar far to the left (toward increasing CSS `right` values)
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    await drag(page, centerX, centerY, -200, centerY);

    const rect = await toolbar.boundingBox();
    expect(rect!.x).toBeGreaterThanOrEqual(2);
  });

  test("Toolbar stays within viewport when dragged to the top edge", async ({
    page,
  }) => {
    const toolbar = await getToolbar(page);
    const box = await toolbar.boundingBox();
    if (!box) throw new Error("Toolbar not visible");

    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    await drag(page, centerX, centerY, centerX, -200);

    const rect = await toolbar.boundingBox();
    expect(rect!.y).toBeGreaterThanOrEqual(2);
  });

  test("Toolbar stays within viewport when dragged to the right edge", async ({
    page,
  }) => {
    const toolbar = await getToolbar(page);
    const box = await toolbar.boundingBox();
    if (!box) throw new Error("Toolbar not visible");

    const viewportSize = page.viewportSize()!;
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    await drag(page, centerX, centerY, viewportSize.width + 200, centerY);

    const rect = await toolbar.boundingBox();
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(viewportSize.width - 2);
  });

  test("Toolbar stays within viewport when dragged to the bottom edge", async ({
    page,
  }) => {
    const toolbar = await getToolbar(page);
    const box = await toolbar.boundingBox();
    if (!box) throw new Error("Toolbar not visible");

    const viewportSize = page.viewportSize()!;
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    await drag(page, centerX, centerY, centerX, viewportSize.height + 200);

    const rect = await toolbar.boundingBox();
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(viewportSize.height - 2);
  });
});
