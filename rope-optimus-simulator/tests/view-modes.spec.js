import { test, expect } from '@playwright/test';

// スクリーンショットの競合を避けるためシリアル実行
test.describe.configure({ mode: 'serial' });

test.describe('ビューモード切り替えテスト', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#root');
    // アプリが完全にロードされるまで待機
    await expect(page.locator('button', { hasText: 'SVG Mode' })).toBeVisible();
  });

  test('SVG Modeがデフォルトで表示される', async ({ page }, testInfo) => {
    // SVG Modeボタンが表示されていることを確認
    const svgButton = page.locator('button', { hasText: 'SVG Mode' });
    await expect(svgButton).toBeVisible();

    // SVG Mode特有のコンテンツが表示されていることを確認
    const svgContent = page.locator('text=Egg Grip Challenge');
    await expect(svgContent).toBeVisible();

    // スクリーンショット（testInfo.outputPath使用）
    await page.screenshot({
      path: testInfo.outputPath('svg-mode.png'),
      fullPage: true
    });
  });

  test('Photo Modeに切り替えできる', async ({ page }, testInfo) => {
    // Photo Modeボタンをクリック
    const photoButton = page.locator('button', { hasText: 'Photo Mode' });
    await expect(photoButton).toBeVisible();
    await photoButton.click();

    // Photo Mode特有の要素を確認
    const photoTitle = page.locator('text=Photo Mode - Egg Grip');
    await expect(photoTitle).toBeVisible({ timeout: 5000 });

    // 画像が読み込まれたことを確認
    const photoImage = page.locator('img[src*="tesla-optimus-hands"]');
    await expect(photoImage).toBeVisible({ timeout: 5000 });

    // スクリーンショット
    await page.screenshot({
      path: testInfo.outputPath('photo-mode.png'),
      fullPage: true
    });
  });

  test('Pixi Modeに切り替えできる', async ({ page }, testInfo) => {
    // Pixi Modeボタンをクリック
    const pixiButton = page.locator('button', { hasText: 'Pixi Mode' });
    await expect(pixiButton).toBeVisible();
    await pixiButton.click();

    // Pixi Mode特有の要素を確認
    const pixiTitle = page.locator('text=Pixi Mode - Mesh Deformation');
    await expect(pixiTitle).toBeVisible({ timeout: 5000 });

    // Canvasが存在することを確認
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible({ timeout: 5000 });

    // スクリーンショット
    await page.screenshot({
      path: testInfo.outputPath('pixi-mode.png'),
      fullPage: true
    });
  });

  test('モード間を連続で切り替えできる', async ({ page }, testInfo) => {
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

    // 最終的にSVG Modeに戻っていることを確認
    await page.screenshot({
      path: testInfo.outputPath('mode-cycle.png'),
      fullPage: true
    });
  });

  test('Noise Modeを切り替えできる', async ({ page }, testInfo) => {
    // Noise Modeのセレクトを探す（最初の一致を使用）
    const noiseSelect = page.locator('select').filter({ has: page.locator('option[value="mixed"]') }).first();

    await expect(noiseSelect).toBeVisible();

    // 現在の値を取得
    const initialValue = await noiseSelect.inputValue();
    expect(initialValue).toBeTruthy(); // 値が設定されていることを確認

    // 値を変更
    const newValue = initialValue === 'mixed' ? 'naive' : 'mixed';
    await noiseSelect.selectOption(newValue);

    // 値が変わったことを確認
    await expect(noiseSelect).toHaveValue(newValue);

    await page.screenshot({
      path: testInfo.outputPath('noise-mode-changed.png'),
      fullPage: true
    });
  });

  test('Photo Modeでグリップ操作ができる', async ({ page }, testInfo) => {
    // Photo Modeに切り替え
    const photoButton = page.locator('button', { hasText: 'Photo Mode' });
    await photoButton.click();
    await expect(page.locator('text=Photo Mode - Egg Grip')).toBeVisible();

    // Photo Modeのコンテナ内のスライダーを特定
    const photoContainer = page.locator('div', { has: page.locator('text=Photo Mode - Egg Grip') });
    const slider = photoContainer.locator('input[type="range"]').first();

    await expect(slider).toBeVisible();

    // スライダーを操作
    await slider.evaluate((el, v) => {
      const setter = Object.getOwnPropertyDescriptor(el.__proto__, 'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, '70');

    // 値が変更されたことを確認（スライダー値で検証）
    await expect(slider).toHaveValue('70');

    await page.screenshot({
      path: testInfo.outputPath('photo-mode-grip.png'),
      fullPage: true
    });
  });

  test('Pixi Modeでグリップ操作ができる', async ({ page }, testInfo) => {
    // Pixi Modeに切り替え
    const pixiButton = page.locator('button', { hasText: 'Pixi Mode' });
    await pixiButton.click();

    // Canvasがロードされるまで待機
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible({ timeout: 5000 });

    // Pixi Mode特有のタイトルが表示されるまで待機
    await expect(page.locator('text=Pixi Mode - Mesh Deformation')).toBeVisible();

    // Pixi Modeのコンテナ内のスライダーを特定
    const pixiContainer = page.locator('div', { has: page.locator('text=Pixi Mode - Mesh Deformation') });
    const slider = pixiContainer.locator('input[type="range"]').first();

    await expect(slider).toBeVisible();

    // スライダーを操作
    await slider.evaluate((el, v) => {
      const setter = Object.getOwnPropertyDescriptor(el.__proto__, 'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, '80');

    // 値が変更されたことを確認（スライダー値で検証）
    await expect(slider).toHaveValue('80');

    await page.screenshot({
      path: testInfo.outputPath('pixi-mode-grip.png'),
      fullPage: true
    });
  });
});
