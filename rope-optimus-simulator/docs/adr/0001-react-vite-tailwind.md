# ADR 0001: React + Vite + Tailwind 採用

Date: 2025-01-18
Status: Accepted

## Context

RoPE量子化のシミュレーション結果をロボットの関節制御として可視化する
インタラクティブなWebアプリケーションが必要。

## Decision

以下の技術スタックを採用する：

- **React 18**: UIコンポーネント構築
- **Vite**: 高速な開発サーバーとビルド
- **TailwindCSS**: ユーティリティファーストのスタイリング
- **Recharts**: チャート描画ライブラリ

## Consequences

### Positive
- Reactのコンポーネントモデルで複雑なSVGアニメーションを管理しやすい
- Viteによる高速なHMRで開発体験が向上
- Tailwindで一貫したデザインシステムを維持
- Rechartsは既存コードとの互換性あり

### Negative
- Reactの学習コストが必要
- バンドルサイズがやや大きくなる

### Neutral
- TypeScriptは今回見送り（後から導入可能）

## Alternatives considered

| 選択肢 | Pros | Cons | 却下理由 |
|--------|------|------|----------|
| Vanilla JS | 依存なし、軽量 | 状態管理が複雑 | アニメーション管理が煩雑 |
| Vue | 学習コスト低 | Rechartsとの相性 | 既存コードがReact前提 |
| Svelte | 高速、軽量 | エコシステム小 | ライブラリ選択肢が限定的 |
