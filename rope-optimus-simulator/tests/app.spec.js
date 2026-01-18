import { test, expect } from '@playwright/test';

test.describe('RoPE Optimus Simulator', () => {
  test('Page loads correctly', async ({ page }) => {
    await page.goto('/');

    // Check page title
    await expect(page).toHaveTitle(/RoPE|Optimus|Simulator/i);
  });

  test('Main content is visible', async ({ page }) => {
    await page.goto('/');

    // Verify app root element exists
    const root = page.locator('#root');
    await expect(root).toBeVisible();
  });

  test('Chart is visible', async ({ page }) => {
    await page.goto('/');

    // Verify Recharts container exists
    const chart = page.locator('.recharts-wrapper').first();
    await expect(chart).toBeVisible({ timeout: 10000 });
  });

  test('Take screenshot', async ({ page }) => {
    await page.goto('/');

    // Wait for page to fully load
    await page.waitForSelector('#root');

    // Save screenshot
    await page.screenshot({ path: 'tests/screenshots/app.png', fullPage: true });
  });
});
