import { test, expect } from '@playwright/test';

// Run serially to avoid screenshot conflicts
test.describe.configure({ mode: 'serial' });

test.describe('View mode switch tests', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#root');
    // Wait for the app to fully load
    await expect(page.locator('button', { hasText: 'SVG Mode' })).toBeVisible();
  });

  test('SVG Mode is shown by default', async ({ page }, testInfo) => {
    // Ensure SVG Mode button is visible
    const svgButton = page.locator('button', { hasText: 'SVG Mode' });
    await expect(svgButton).toBeVisible();

    // Ensure SVG Mode content is visible
    const svgContent = page.locator('text=Egg Grip Challenge');
    await expect(svgContent).toBeVisible();

    // Screenshot (using testInfo.outputPath)
    await page.screenshot({
      path: testInfo.outputPath('svg-mode.png'),
      fullPage: true
    });
  });

  test('Can switch to Photo Mode', async ({ page }, testInfo) => {
    // Click Photo Mode button
    const photoButton = page.locator('button', { hasText: 'Photo Mode' });
    await expect(photoButton).toBeVisible();
    await photoButton.click();

    // Verify Photo Mode-specific elements
    const photoTitle = page.locator('text=Photo Mode - Egg Grip');
    await expect(photoTitle).toBeVisible({ timeout: 5000 });

    // Verify image is loaded
    const photoImage = page.locator('img[src*="tesla-optimus-hands"]');
    await expect(photoImage).toBeVisible({ timeout: 5000 });

    // Screenshot
    await page.screenshot({
      path: testInfo.outputPath('photo-mode.png'),
      fullPage: true
    });
  });

  test('Can switch to Pixi Mode', async ({ page }, testInfo) => {
    // Click Pixi Mode button
    const pixiButton = page.locator('button', { hasText: 'Pixi Mode' });
    await expect(pixiButton).toBeVisible();
    await pixiButton.click();

    // Verify Pixi Mode-specific elements
    const pixiTitle = page.locator('text=Pixi Mode - Mesh Deformation');
    await expect(pixiTitle).toBeVisible({ timeout: 5000 });

    // Verify canvas exists
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible({ timeout: 5000 });

    // Screenshot
    await page.screenshot({
      path: testInfo.outputPath('pixi-mode.png'),
      fullPage: true
    });
  });

  test('Can cycle between modes', async ({ page }, testInfo) => {
    const svgButton = page.locator('button', { hasText: 'SVG Mode' });
    const photoButton = page.locator('button', { hasText: 'Photo Mode' });
    const pixiButton = page.locator('button', { hasText: 'Pixi Mode' });

    // SVG -> Photo
    await photoButton.click();
    await expect(page.locator('text=Photo Mode - Egg Grip')).toBeVisible();

    // Photo -> Pixi
    await pixiButton.click();
    await expect(page.locator('text=Pixi Mode - Mesh Deformation')).toBeVisible();

    // Pixi -> SVG
    await svgButton.click();
    await expect(page.locator('text=Egg Grip Challenge')).toBeVisible();

    // Confirm it ends back on SVG Mode
    await page.screenshot({
      path: testInfo.outputPath('mode-cycle.png'),
      fullPage: true
    });
  });

  test('Can switch Noise Mode', async ({ page }, testInfo) => {
    // Find the Noise Mode select (use first match)
    const noiseSelect = page.locator('select').filter({ has: page.locator('option[value="mixed"]') }).first();

    await expect(noiseSelect).toBeVisible();

    // Read current value
    const initialValue = await noiseSelect.inputValue();
    expect(initialValue).toBeTruthy(); // Ensure a value is set

    // Change value
    const newValue = initialValue === 'mixed' ? 'naive' : 'mixed';
    await noiseSelect.selectOption(newValue);

    // Verify value changed
    await expect(noiseSelect).toHaveValue(newValue);

    await page.screenshot({
      path: testInfo.outputPath('noise-mode-changed.png'),
      fullPage: true
    });
  });

  test('Can adjust grip in Photo Mode', async ({ page }, testInfo) => {
    // Switch to Photo Mode
    const photoButton = page.locator('button', { hasText: 'Photo Mode' });
    await photoButton.click();
    await expect(page.locator('text=Photo Mode - Egg Grip')).toBeVisible();

    // Find slider inside Photo Mode container
    const photoContainer = page.locator('div', { has: page.locator('text=Photo Mode - Egg Grip') });
    const slider = photoContainer.locator('input[type="range"]').first();

    await expect(slider).toBeVisible();

    // Adjust slider
    await slider.evaluate((el, v) => {
      const setter = Object.getOwnPropertyDescriptor(el.__proto__, 'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, '70');

    // Verify value changed (by slider value)
    await expect(slider).toHaveValue('70');

    await page.screenshot({
      path: testInfo.outputPath('photo-mode-grip.png'),
      fullPage: true
    });
  });

  test('Can adjust grip in Pixi Mode', async ({ page }, testInfo) => {
    // Switch to Pixi Mode
    const pixiButton = page.locator('button', { hasText: 'Pixi Mode' });
    await pixiButton.click();

    // Wait for canvas to load
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible({ timeout: 5000 });

    // Wait for Pixi Mode title to appear
    await expect(page.locator('text=Pixi Mode - Mesh Deformation')).toBeVisible();

    // Find slider inside Pixi Mode container
    const pixiContainer = page.locator('div', { has: page.locator('text=Pixi Mode - Mesh Deformation') });
    const slider = pixiContainer.locator('input[type="range"]').first();

    await expect(slider).toBeVisible();

    // Adjust slider
    await slider.evaluate((el, v) => {
      const setter = Object.getOwnPropertyDescriptor(el.__proto__, 'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, '80');

    // Verify value changed (by slider value)
    await expect(slider).toHaveValue('80');

    await page.screenshot({
      path: testInfo.outputPath('pixi-mode-grip.png'),
      fullPage: true
    });
  });
});
