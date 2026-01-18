import { test, expect } from '@playwright/test';

test.describe('RoPE Optimus Simulator', () => {
  test('ページが正しく読み込まれる', async ({ page }) => {
    await page.goto('/');

    // ページタイトルを確認
    await expect(page).toHaveTitle(/RoPE|Optimus|Simulator/i);
  });

  test('メインコンテンツが表示される', async ({ page }) => {
    await page.goto('/');

    // アプリのルート要素が存在することを確認
    const root = page.locator('#root');
    await expect(root).toBeVisible();
  });

  test('チャートが表示される', async ({ page }) => {
    await page.goto('/');

    // Rechartsのコンテナが存在することを確認
    const chart = page.locator('.recharts-wrapper').first();
    await expect(chart).toBeVisible({ timeout: 10000 });
  });

  test('スクリーンショットを撮影', async ({ page }) => {
    await page.goto('/');

    // ページが完全に読み込まれるのを待つ
    await page.waitForSelector('#root');

    // スクリーンショットを保存
    await page.screenshot({ path: 'tests/screenshots/app.png', fullPage: true });
  });
});
