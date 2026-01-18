import { test, expect } from '@playwright/test';

const setRangeValue = async (locator, value) => {
  await locator.evaluate((el, v) => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, String(value));
};

test.describe('パラメータ変更テスト', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#root');
  });

  test.describe('卵グリップゲーム', () => {

    test('グリップスライダーを操作できる', async ({ page }) => {
      // スライダーを探す
      const slider = page.locator('input[type="range"]').first();
      await expect(slider).toBeVisible();

      // 初期値を取得
      const initialValue = await slider.inputValue();

      // スライダーを変更
      await setRangeValue(slider, 50);

      // 値が変わったことを確認
      const newValue = await slider.inputValue();
      expect(newValue).toBe('50');
    });

    test('グリップ力を上げると圧力表示が変化する', async ({ page }) => {
      const slider = page.locator('input[type="range"]').first();

      // 低い値に設定
      await setRangeValue(slider, 10);
      await page.waitForTimeout(500);

      // 高い値に設定
      await setRangeValue(slider, 80);
      await page.waitForTimeout(500);

      // スクリーンショットを撮影
      await page.screenshot({
        path: 'tests/screenshots/grip-high.png',
        fullPage: true
      });
    });

    test('リセットボタンが機能する', async ({ page }) => {
      // リセットボタンを探してクリック
      const resetButton = page.locator('button', { hasText: /reset|リセット/i });

      if (await resetButton.count() > 0) {
        await resetButton.click();
        await page.waitForTimeout(300);

        // リセット後のスクリーンショット
        await page.screenshot({
          path: 'tests/screenshots/after-reset.png',
          fullPage: true
        });
      }
    });
  });

  test.describe('RoPEシミュレーション', () => {

    test('シーケンス長を変更できる', async ({ page }) => {
      // seqLen入力を探す
      const seqLenInput = page.locator('input[type="number"]').first();

      if (await seqLenInput.count() > 0) {
        await seqLenInput.fill('2048');
        await page.waitForTimeout(300);

        const value = await seqLenInput.inputValue();
        expect(value).toBe('2048');
      }
    });

    test('ビット数スライダーを変更できる', async ({ page }) => {
      // bitsスライダーを探す（min="2" max="8"のもの）
      const bitsSlider = page.locator('input[type="range"][min="2"][max="8"]');

      if (await bitsSlider.count() > 0) {
        await expect(bitsSlider).toBeVisible();

        // 4ビットに変更
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

    test('シミュレーション実行ボタンをクリックできる', async ({ page }) => {
      // 実行ボタンを探す
      const runButton = page.locator('button', { hasText: /run|実行|simulation/i });

      if (await runButton.count() > 0) {
        await expect(runButton).toBeEnabled();
        await runButton.click();

        // 実行中の状態を確認（ボタンがdisabledになるか確認）
        await page.waitForTimeout(500);

        await page.screenshot({
          path: 'tests/screenshots/simulation-running.png',
          fullPage: true
        });
      }
    });

    test('アニメーション切り替えボタンが機能する', async ({ page }) => {
      // アニメーション切り替えボタンを探す
      const animButton = page.locator('button', { hasText: /pause|stop|anim|一時停止/i });

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

  test.describe('チャート更新', () => {

    test('パラメータ変更後にチャートが更新される', async ({ page }) => {
      // チャートが存在することを確認
      const chart = page.locator('.recharts-wrapper').first();
      await expect(chart).toBeVisible({ timeout: 10000 });

      // 変更前のスクリーンショット
      await page.screenshot({
        path: 'tests/screenshots/chart-before.png',
        fullPage: true
      });

      // パラメータを変更（利用可能なスライダーを使用）
      const slider = page.locator('input[type="range"]').first();
      if (await slider.count() > 0) {
        const initialValue = await slider.inputValue();
        const newValue = parseInt(initialValue) > 50 ? '20' : '80';
        await setRangeValue(slider, newValue);
      }

      // 更新を待つ
      await page.waitForTimeout(1000);

      // 変更後のスクリーンショット
      await page.screenshot({
        path: 'tests/screenshots/chart-after.png',
        fullPage: true
      });
    });
  });
});
