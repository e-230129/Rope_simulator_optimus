# Requirements

RoPE Optimus Simulator の要件定義

## 概要

Tesla Patent US20260017019A1 (RoPE Mixed-Precision Hardware) の概念を
Optimus ロボットの関節制御に適用した場合の効果を可視化するシミュレータ

## 機能要件

### FR-1: ロボットビジュアライゼーション

- **FR-1.1**: 腕の関節（肩・肘・手首）を3関節で表示
- **FR-1.2**: 手の指（5本）の動きを表示
- **FR-1.3**: 脚の歩行動作を表示
- **FR-1.4**: 理想位置（シアン）と実際位置（白）の比較表示
- **FR-1.5**: 卵を持つ手のアニメーション

### FR-2: 量子化シミュレーション

- **FR-2.1**: Mixed-Precision (Log/Exp) 方式のRMSE計算
- **FR-2.2**: Naive (Linear) 方式との比較
- **FR-2.3**: パラメータ（SeqLen, Dim, Bits）の調整UI
- **FR-2.4**: 結果のチャート表示

### FR-3: アニメーション

- **FR-3.1**: requestAnimationFrameベースの滑らかな動き
- **FR-3.2**: 一時停止/再開機能
- **FR-3.3**: シミュレーション結果に連動した誤差表示

## 非機能要件

### NFR-1: パフォーマンス
- 60fps程度のアニメーション

### NFR-2: 互換性
- Chrome, Firefox, Safari の最新版で動作

### NFR-3: デザイン
- Tesla Optimus の実機に近い白黒配色
- ダークテーマUI

## 関連

- [SSOT Index](../../SSOT.md)
- [ADR](../adr/)
