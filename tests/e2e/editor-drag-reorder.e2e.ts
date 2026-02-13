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

  const editBtn = editorHost.locator('[data-testid="edit-btn"]');
  await editBtn.click();

  // Wait for edit mode to activate (save btn becomes visible)
  const saveBtn = editorHost.locator('[data-testid="save-btn"]');
  await expect(saveBtn).toBeVisible();
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

/** Get child IDs of #wrapper in order */
async function getChildOrder(page: import("@playwright/test").Page) {
  return page.evaluate(() =>
    Array.from(document.getElementById("wrapper")!.children).map(
      (el) => el.id
    )
  );
}

test.describe("Drag reorder", () => {
  test("Drag #target above #first-child reorders children", async ({
    page,
  }) => {
    await enterEditMode(page);
    await selectElement(page, "#target");

    const target = page.locator("#target");
    const firstChild = page.locator("#first-child");
    const targetBox = await target.boundingBox();
    const firstBox = await firstChild.boundingBox();
    if (!targetBox || !firstBox) throw new Error("Elements not visible");

    // Drag from center of #target to above #first-child
    const startX = targetBox.x + targetBox.width / 2;
    const startY = targetBox.y + targetBox.height / 2;
    const endX = firstBox.x + firstBox.width / 2;
    const endY = firstBox.y - 2; // above #first-child

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 5 });
    await page.mouse.up();

    const order = await getChildOrder(page);
    expect(order).toEqual(["target", "first-child", "last-child"]);
  });

  test("Drag #target below #last-child reorders children", async ({
    page,
  }) => {
    await enterEditMode(page);
    await selectElement(page, "#target");

    const target = page.locator("#target");
    const lastChild = page.locator("#last-child");
    const targetBox = await target.boundingBox();
    const lastBox = await lastChild.boundingBox();
    if (!targetBox || !lastBox) throw new Error("Elements not visible");

    const startX = targetBox.x + targetBox.width / 2;
    const startY = targetBox.y + targetBox.height / 2;
    const endX = lastBox.x + lastBox.width / 2;
    const endY = lastBox.y + lastBox.height + 2; // below #last-child

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 5 });
    await page.mouse.up();

    const order = await getChildOrder(page);
    expect(order).toEqual(["first-child", "last-child", "target"]);
  });

  test("Small movement (<5px) does not trigger drag", async ({ page }) => {
    await enterEditMode(page);
    await selectElement(page, "#target");

    const target = page.locator("#target");
    const box = await target.boundingBox();
    if (!box) throw new Error("Element not visible");

    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Move less than 5px
    await page.mouse.move(startX + 2, startY + 2);
    await page.mouse.up();

    // Order should be unchanged
    const order = await getChildOrder(page);
    expect(order).toEqual(["first-child", "target", "last-child"]);
    // No dragging attribute should appear
    await expect(target).not.toHaveAttribute("data-scaffold-dragging");
  });

  test("Element stays selected after drag (click suppression)", async ({
    page,
  }) => {
    await enterEditMode(page);
    await selectElement(page, "#target");

    const target = page.locator("#target");
    const firstChild = page.locator("#first-child");
    const targetBox = await target.boundingBox();
    const firstBox = await firstChild.boundingBox();
    if (!targetBox || !firstBox) throw new Error("Elements not visible");

    const startX = targetBox.x + targetBox.width / 2;
    const startY = targetBox.y + targetBox.height / 2;
    const endX = firstBox.x + firstBox.width / 2;
    const endY = firstBox.y - 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 5 });
    await page.mouse.up();

    // Element should still be selected
    await expect(target).toHaveAttribute("data-scaffold-selected", "");
  });

  test("Escape cancels in-progress drag, preserves original order", async ({
    page,
  }) => {
    await enterEditMode(page);
    await selectElement(page, "#target");

    const target = page.locator("#target");
    const firstChild = page.locator("#first-child");
    const targetBox = await target.boundingBox();
    const firstBox = await firstChild.boundingBox();
    if (!targetBox || !firstBox) throw new Error("Elements not visible");

    const startX = targetBox.x + targetBox.width / 2;
    const startY = targetBox.y + targetBox.height / 2;
    const endX = firstBox.x + firstBox.width / 2;
    const endY = firstBox.y - 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 5 });

    // Press Escape while dragging (before mouseup)
    await page.keyboard.press("Escape");
    await page.mouse.up();

    // Order should be unchanged
    const order = await getChildOrder(page);
    expect(order).toEqual(["first-child", "target", "last-child"]);
    // Dragging attribute should be removed
    await expect(target).not.toHaveAttribute("data-scaffold-dragging");
  });

  test("data-scaffold-dragging attribute appears during drag and removed after", async ({
    page,
  }) => {
    await enterEditMode(page);
    await selectElement(page, "#target");

    const target = page.locator("#target");
    const lastChild = page.locator("#last-child");
    const targetBox = await target.boundingBox();
    const lastBox = await lastChild.boundingBox();
    if (!targetBox || !lastBox) throw new Error("Elements not visible");

    const startX = targetBox.x + targetBox.width / 2;
    const startY = targetBox.y + targetBox.height / 2;
    const endX = lastBox.x + lastBox.width / 2;
    const endY = lastBox.y + lastBox.height + 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Move enough to cross threshold
    await page.mouse.move(startX, startY + 10, { steps: 3 });

    // During drag, attribute should be present
    await expect(target).toHaveAttribute("data-scaffold-dragging", "");

    // Complete the drag
    await page.mouse.move(endX, endY, { steps: 3 });
    await page.mouse.up();

    // After drag, attribute should be removed
    await expect(target).not.toHaveAttribute("data-scaffold-dragging");
  });
});
