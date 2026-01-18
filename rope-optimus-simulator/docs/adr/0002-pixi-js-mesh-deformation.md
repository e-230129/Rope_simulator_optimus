# ADR-0002: Pixi.js によるメッシュ変形導入

## Status
Accepted

## Context
Photo Modeで静止画のOptimus手の指を動かしたい。
WebGLベースのメッシュ変形技術が必要。

## Decision
Pixi.js (v8.x) を採用。
理由:
- React統合が容易
- SimplePlaneによる簡易メッシュ変形
- 軽量（three.jsより小さい）

## Consequences
- bundle sizeが約200KB増加
- WebGL非対応ブラウザでは fallback 必要
