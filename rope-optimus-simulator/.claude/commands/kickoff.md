!python3 scripts/validate-ssot.py

# /kickoff - セッション開始儀式

## やること

1. SSOT検証（上の ! コマンドで実行済み）
2. 以下を読んで5点要約を出力:
   - @SSOT.md
   - @plan.md（1行目のパスを参照し、そのファイルも読む）
   - @TASKS.md
   - @progress.md

## 出力フォーマット

```
## Session Summary

1. **Goal**: 現在の目標
2. **State**: 進捗状況
3. **Decision**: 直近の重要な決定
4. **Blocker**: ブロッカーがあれば
5. **Next**: 次のアクション（TASKS.mdから）

## Session Plan

今セッションでやることの提案
```
