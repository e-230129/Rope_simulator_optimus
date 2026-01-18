# RoPE × Optimus Simulator

Tesla Patent US20260017019A1 (RoPE Mixed-Precision Hardware) の概念を
Optimus ロボットの関節制御に適用した場合の効果を可視化するシミュレータ。

## 🚀 Quick Start

```bash
# 依存関係インストール
npm install

# 開発サーバー起動
npm run dev
```

## 🧪 テスト実行

```bash
# 依存関係インストール
npm install

# Playwright ブラウザインストール（初回のみ）
npx playwright install chromium

# テスト実行
npm test

# テストレポート確認
npx playwright show-report
```

### テスト構成
- `tests/app.spec.js` - 基本動作テスト
- `tests/parameters.spec.js` - パラメータ操作テスト  
- `tests/view-modes.spec.js` - ビューモード切り替えテスト

**期待結果**: 19 tests passed

## 📁 プロジェクト構造（SSOT準拠）

```
rope-optimus-simulator/
├── CLAUDE.md              # AI運用憲法
├── SSOT.md                # 索引（地図）
├── plan.md                # 現在の計画へのポインタ
├── TASKS.md               # タスクボード
├── progress.md            # AI短期メモリ
├── .claude/
│   ├── commands/          # Claude Code コマンド
│   └── skills/            # スキル定義
├── docs/
│   ├── requirements/      # 要件定義
│   ├── adr/               # 設計判断記録
│   └── plans/             # 計画ドキュメント
├── scripts/
│   └── validate-ssot.py   # SSOT検証スクリプト
└── src/
    ├── App.jsx            # メインコンポーネント
    ├── App.stable.jsx     # 安定版（参照用）
    ├── main.jsx           # エントリポイント
    └── index.css          # Tailwind CSS
```

## 🔧 Claude Code での開発

```bash
# セッション開始
/kickoff

# 迷子になったら
/reset

# セッション終了
/update-progress
```

## 📊 機能

- **腕の制御可視化**: 肩・肘・手首の3関節アニメーション
- **手の精密制御**: 5本指の動きと卵を持つデモ
- **歩行制御**: 脚の動きと足位置誤差表示
- **量子化比較**: Mixed-Precision vs Naive の RMSE チャート

## 🎯 目的

RoPE (Rotary Position Embedding) の量子化誤差が
ロボットの関節制御にどう影響するかを直感的に理解できるようにする。

- 🔵 シアン = 理想位置 (float32)
- ⚪ 白 = 実際の位置 (量子化後)
- 🔴 赤 = 誤差 (Δ)

## 📝 License

MIT
