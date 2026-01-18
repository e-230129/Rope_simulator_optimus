# Task A: Claude Code用 - UI/React/SVG修正

## 概要
`src/App.jsx`の実行時エラーを修正し、Optimus風デザイン（白シェル+黒関節+卵を持つ手）を維持したまま動作させる。

## 前提条件
```bash
cd rope-optimus-simulator
npm install
npm run dev
# ブラウザDevToolsでエラーを確認
```

## タスク詳細

### A-1: SVGグラデーションID重複の解消（優先度: 高）

**問題箇所**: 複数の`<defs>`ブロックで同名のグラデーションIDが定義されている

```
Line 346:  url(#eggGradientDetailed) ← 参照
Line 1176: <radialGradient id="eggGradientDetailed"> ← 定義1
Line 1348: <radialGradient id="eggGradient"> ← 別名だが混乱の元

Line 907:  <linearGradient id="photoFingerGradient"> ← PixiPhotoHand内
Line 1304: <linearGradient id="optimusShellGradient"> ← OptimusSVGDefs内
```

**修正方針**:
1. グラデーション定義を**1箇所に集約**（`OptimusSVGDefs`コンポーネントを最上位に移動）
2. または各コンポーネント内でユニークなプレフィックスを付与
   - 例: `photo-fingerGradient`, `optimus-shellGradient`, `egg-gradientDetailed`

**参考**: `App.stable.jsx` Line 128-136 のシンプルな`<defs>`構造

### A-2: 変数名`angle`のスコープ衝突解消（優先度: 高）

**問題箇所**:
```javascript
// Line 1387: 外側スコープ
const angle = Math.atan2(dy, dx) * (180 / Math.PI);

// Line 1595-1598: map内で同名使用（衝突の可能性）
{ offY: -7, angle: -18, len: 16 },
{ offY: -2, angle: 5, len: 18 },
```

**修正方針**:
```javascript
// 外側を明確な名前に変更
const segmentAngle = Math.atan2(dy, dx) * (180 / Math.PI);

// map内はそのまま（オブジェクトプロパティなので衝突しない可能性もあるが確認必要）
fingers.map(({ offY, angle: fingerAngle, len }) => ...)
```

### A-3: コンポーネント分割の整理（優先度: 中）

**現状**: 2,478行の巨大ファイル

**推奨分割**:
```
src/
├── App.jsx                    # メインコンポーネント（500行以下に）
├── components/
│   ├── EggObject.jsx          # 卵SVG
│   ├── OptimusHand.jsx        # SVGハンド
│   ├── PixiPhotoHand.jsx      # PixiJS写真ハンド
│   ├── EggGripGame.jsx        # ゲームUI
│   └── OptimusSVGDefs.jsx     # 共通グラデーション定義
├── hooks/
│   └── useEggPhysics.js       # 卵物理演算フック
└── utils/
    └── math.js                # clamp, seededRandom等
```

### A-4: 動作確認チェックリスト

- [ ] `npm run dev`でエラーなく起動
- [ ] SVGモードでOptimus手が表示される
- [ ] 卵が正しくレンダリングされる
- [ ] アニメーションが動作する
- [ ] ノイズスライダーが反応する
- [ ] `npm run test`でPlaywrightテストがパス

## 参照ファイル
- `src/App.stable.jsx` - 動作する簡易版（差分確認用）
- `docs/plans/2025-01-18-fix-optimus-errors.md` - 修正計画

## 完了条件
1. `npm run dev`でコンソールエラーなし
2. 全ビューモード（SVG/Photo/Pixi）が正常動作
3. 既存のPlaywrightテストがすべてパス
