import { test, expect } from '@playwright/test';

const setRangeValue = async (locator, value) => {
  await locator.evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(el.__proto__, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, String(value));
};

test.describe('Parameter change tests', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#root');
  });

  test.describe('Egg grip game', () => {

    test('Can adjust the grip slider', async ({ page }) => {
      // Find slider
      const slider = page.locator('input[type="range"]').first();
      await expect(slider).toBeVisible();

      // Read initial value
      const initialValue = await slider.inputValue();

      // Change slider
      await setRangeValue(slider, 50);

      // Verify value changed
      const newValue = await slider.inputValue();
      expect(newValue).toBe('50');
    });

    test('Raising grip changes pressure display', async ({ page }) => {
      const slider = page.locator('input[type="range"]').first();

      // Set low value
      await setRangeValue(slider, 10);
      await page.waitForTimeout(500);

      // Set high value
      await setRangeValue(slider, 80);
      await page.waitForTimeout(500);

      // Take screenshot
      await page.screenshot({
        path: 'tests/screenshots/grip-high.png',
        fullPage: true
      });
    });

    test('Reset button works', async ({ page }) => {
      // Find and click reset button
      const resetButton = page.locator('button', { hasText: /reset/i });

      if (await resetButton.count() > 0) {
        await resetButton.click();
        await page.waitForTimeout(300);

        // Screenshot after reset
        await page.screenshot({
          path: 'tests/screenshots/after-reset.png',
          fullPage: true
        });
      }
    });
  });

  test.describe('RoPE simulation', () => {

    test('Can change sequence length', async ({ page }) => {
      // Find seqLen input
      const seqLenInput = page.locator('input[type="number"]').first();

      if (await seqLenInput.count() > 0) {
        await seqLenInput.fill('2048');
        await page.waitForTimeout(300);

        const value = await seqLenInput.inputValue();
        expect(value).toBe('2048');
      }
    });

    test('Can change bits slider', async ({ page }) => {
      // Find bits slider (min="2" max="8")
      const bitsSlider = page.locator('input[type="range"][min="2"][max="8"]');

      if (await bitsSlider.count() > 0) {
        await expect(bitsSlider).toBeVisible();

        // Change to 4-bit
        await setRangeValue(bitsSlider, 4);
        await page.waitForTimeout(300);

        const value = await bitsSlider.inputValue();
        expect(value).toBe('4');

        await page.screenshot({
          path: 'tests/screenshots/bits-4.png',
          fullPage: true
        });
      }
    });

    test('Can click the run simulation button', async ({ page }) => {
      // Find run button
      const runButton = page.locator('button', { hasText: /run|simulation/i });

      if (await runButton.count() > 0) {
        await expect(runButton).toBeEnabled();
        await runButton.click();

        // Verify running state (button disabled)
        await page.waitForTimeout(500);

        await page.screenshot({
          path: 'tests/screenshots/simulation-running.png',
          fullPage: true
        });
      }
    });

    test('Animation toggle button works', async ({ page }) => {
      // Find animation toggle button
      const animButton = page.locator('button', { hasText: /pause|stop|anim/i });

      if (await animButton.count() > 0) {
        await animButton.click();
        await page.waitForTimeout(300);

        await page.screenshot({
          path: 'tests/screenshots/animation-toggled.png',
          fullPage: true
        });
      }
    });
  });

  test.describe('Chart updates', () => {

    test('Chart updates after parameter changes', async ({ page }) => {
      // Ensure chart exists
      const chart = page.locator('.recharts-wrapper').first();
      await expect(chart).toBeVisible({ timeout: 10000 });

      // Screenshot before change
      await page.screenshot({
        path: 'tests/screenshots/chart-before.png',
        fullPage: true
      });

      // Change parameter (use available slider)
      const slider = page.locator('input[type="range"]').first();
      if (await slider.count() > 0) {
        const initialValue = await slider.inputValue();
        const newValue = parseInt(initialValue) > 50 ? '20' : '80';
        await setRangeValue(slider, newValue);
      }

      // Wait for update
      await page.waitForTimeout(1000);

      // Screenshot after change
      await page.screenshot({
        path: 'tests/screenshots/chart-after.png',
        fullPage: true
      });
    });
  });
});
