# TASKS

「次やること」の唯一の置き場。progress.mdには書かない。

## Now（作業中）

- なし

## Next（次にやる・P2）

- なし

## Blocked（ブロック中）

- なし

## Done（最近完了）

- [x] Task F: exp近似切替機能
  - Math.exp → Taylor-5次近似（Horner形式）のON/OFF
  - Math.sin/cos → LUT-256（線形補間付き）のON/OFF
  - Hardware Approximationセレクタ追加
  - 精度メトリクス表示（HW Approx有効時）
  - チャートの視覚的インジケータ（紫色破線）
- [x] Task A: ヒストグラム修正（Codex担当）
- [x] Task B: 状態整理（Claude Code担当）
- [x] Task C: SVG id一意化・useId適用（Claude Code担当）
- [x] Task D: README更新
- [x] Task E: 監査報告書修正
- [x] Playwrightテスト修正（view-modes.spec.js）
- [x] Pixi Mode実装（DisplacementFilter方式）
- [x] Photo Mode実装
- [x] ドロップ検知・卵破損表現
- [x] SSOT構造のセットアップ
- [x] 初期ファイル配置

---

**運用ルール:**
- タスク追加時は Plan または ADR へのリンクを添える
- 完了時は Done に移動し、PR/コミットリンクを追記
- Blocked は理由を必ず書く
