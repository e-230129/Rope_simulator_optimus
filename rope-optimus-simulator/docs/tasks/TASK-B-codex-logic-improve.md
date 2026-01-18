# Task B: Codex用 - 計算ロジック/アルゴリズム改善

## 概要
GPT-5.2 Proのレビュー指摘に基づき、計算ロジックの改善と監査可能性の向上を行う。

## 前提知識
- Tesla特許 US20260017019A1: RoPE Mixed-Precision Hardware
- 現在の実装: `log(θ)` → 量子化 → `exp()` でθを復元

## 現状（既に実装済み）
✅ ストリーミング計算（`runSimulation`はposごとにRMSEを累積）
✅ ヒストグラムのbin直接カウント（配列に溜めない）
✅ `showNaive=false`時のnaive計算スキップ

## タスク詳細

### B-1: quantModeのUI連携（優先度: 高）

**問題**: 関数定義では`quantMode`引数があるが、UIから切り替えできない

**現状コード** (`src/App.jsx` Line 62-86):
```javascript
function computeLogThetaScalesAnalytic(seqLen, logInvFreq, bits, mode) {
  // mode = 'global' | 'per_dim' が使える
  if (mode === 'global') { ... }
  // per_dimの場合
  const scales = new Array(half);
  for (let i = 0; i < half; i++) { ... }
}
```

**追加実装**:
```javascript
// State追加
const [quantMode, setQuantMode] = useState('per_dim'); // 'per_dim' | 'global'

// UI追加（Parametersセクションに）
<div>
  <label>Quantization Mode</label>
  <select value={quantMode} onChange={e => setQuantMode(e.target.value)}>
    <option value="per_dim">Per-Dimension Scale</option>
    <option value="global">Global Scale</option>
  </select>
</div>
```

**検証項目**:
- `per_dim`と`global`でRMSEの差を比較表示
- 特許の主張（per_dimがglobalより精度が高い）を可視化

### B-2: pack/unpack検証の実装（優先度: 中）

**問題**: UIに"pack/unpack"と表示されているが、検証可能なメトリクスがない

**現状コード** (`src/App.jsx` Line 32-35):
```javascript
function int8ToUint8(x) { return x & 0xff; }
function uint8ToInt8(u) { const v = u & 0xff; return v >= 128 ? v - 256 : v; }
function pack2x8ToU16(lo, hi) { return (int8ToUint8(lo) | (int8ToUint8(hi) << 8)) & 0xffff; }
function unpackU16To2x8(p) { return [uint8ToInt8(p & 0xff), uint8ToInt8((p >> 8) & 0xff)]; }
```

**追加実装**:
```javascript
// runSimulation内で pack/unpack の一致率を計算
let packMismatch = 0;
let packTotal = 0;

for (let i = 0; i < halfEven; i += 2) {
  if (i + 1 < halfEven) {
    const q0 = qLogTmp[i];
    const q1 = qLogTmp[i + 1];
    const packed = pack2x8ToU16(q0, q1);
    const [u0, u1] = unpackU16To2x8(packed);
    if (u0 !== q0 || u1 !== q1) packMismatch++;
    packTotal++;
  }
}

// 結果表示
const packMatchRate = packTotal > 0 ? ((packTotal - packMismatch) / packTotal * 100) : 100;
```

**UI表示追加**:
```jsx
<div className="text-xs">
  Pack/Unpack Match Rate: {packMatchRate.toFixed(2)}%
</div>
```

### B-3: 計算精度の明示（優先度: 低）

**問題**: JSは`float64`だが、UIは"float32基準"と表示している

**対応案1**: 注釈を追加
```jsx
<p className="text-xs text-gray-500">
  ※ ブラウザ内の相対比較（baseline vs mixed）。厳密なfloat32精度ではありません。
</p>
```

**対応案2**: Math.froundでfloat32をエミュレート（計算コスト増）
```javascript
const xEven = Math.fround(rand());
const xOdd = Math.fround(rand());
// ただしsin/cos/exp/logはfloat64のまま
```

→ 推奨は**対応案1**（注釈追加）

### B-4: seqLen上限でのガード強化（優先度: 低）

**問題**: seqLen=65536, dim=256 でブラウザが重くなる可能性

**追加実装**:
```javascript
const MAX_SAFE_CELLS = 1_000_000; // seqLen × dim の上限
const cellCount = seqLen * dim;

if (cellCount > MAX_SAFE_CELLS) {
  alert(`計算量が大きすぎます (${cellCount.toLocaleString()} cells)。seqLen または dim を下げてください。`);
  return;
}
```

## 参照ファイル
- `src/App.jsx` Line 2042-2166: `runSimulation`関数
- GPT-5.2 Proレビュー（ユーザー提供）

## 完了条件
1. quantModeがUIから切り替え可能
2. pack/unpack一致率が表示される
3. float64での計算であることが明示される
4. 大きなseqLenでの安全ガードが機能する

## テスト手順
```bash
npm run dev
# 1. quantModeを切り替えてRMSEの変化を確認
# 2. usePackDemoをONにしてpack/unpack一致率=100%を確認
# 3. seqLen=65536, dim=256でガードが発動することを確認
```
