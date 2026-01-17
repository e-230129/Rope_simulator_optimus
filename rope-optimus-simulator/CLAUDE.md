# Claude Code Operating Constitution

## 0) Read-first（SSOT索引）
- 索引: @SSOT.md
- 現在の計画: @plan.md（1行目がパス。必要なら参照先のPlan本体も読む）
- タスクボード: @TASKS.md
- セッション状態: @progress.md

## 1) 絶対ルール（安全・衛生）
- 秘密情報（.env, credentials）を読み取らない、外部に出さない
- 差分は最小に。明示的な指示なしに大規模リファクタしない
- セキュリティルールを回避して「動かす」ことはしない
- ファイル削除・上書きは明示的な承認を得てから

## 2) ワークフロー（Plan → Do → Verify → Record）
- 非自明な変更: `/plan` → 人間承認 → 実装
- コード編集後: `npm run dev` で動作確認
- テスト: `npm test` で検証
- セッション終了時: progress.md を更新

## 3) 書く場所（SSOT規律）
- 要件/振る舞い: docs/requirements/
- アーキテクチャ決定: docs/adr/
- 承認済み計画: docs/plans/
- タスクボード: TASKS.md

## 4) ADRの閾値
**ADR必須:**
- 外部ライブラリ導入・変更
- 大きなアーキテクチャ変更
- 2案以上を比較した決定

**ADR不要:**
- 明らかなバグ修正
- リファクタ（外部仕様不変）

## 5) コマンド
- 開発サーバ: `npm run dev`
- ビルド: `npm run build`
- SSOT検証: `python3 scripts/validate-ssot.py`

## 6) セッションライフサイクル
- 開始: `/kickoff`（SSOT検証→状態要約）
- 迷子: `/reset`（SSOTに再アンカー）
- 終了: `/update-progress`（progress.md更新）

## 7) プロジェクト固有ルール
- React + Recharts + TailwindCSSを使用
- SVGはインラインで記述（外部ファイル不可）
- アニメーションはrequestAnimationFrameベース
