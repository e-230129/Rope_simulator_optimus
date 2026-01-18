# Task B: Codex - Calculation Logic/Algorithm Improvements

## Overview
Improve calculation logic and auditability based on GPT-5.2 Pro review feedback.

## Background Knowledge
- Tesla Patent US20260017019A1: RoPE Mixed-Precision Hardware
- Current implementation: `log(theta)` → quantization → `exp()` to recover theta

## Current Status (Already Implemented)
- Streaming calculation (`runSimulation` accumulates RMSE per pos)
- Direct histogram bin counting (no array accumulation)
- Skip naive calculation when `showNaive=false`

## Task Details

### B-1: quantMode UI Integration (Priority: High)

**Problem**: Function definition has `quantMode` argument, but no UI to switch it

**Current Code** (`src/App.jsx` Line 62-86):
```javascript
function computeLogThetaScalesAnalytic(seqLen, logInvFreq, bits, mode) {
  // mode = 'global' | 'per_dim' can be used
  if (mode === 'global') { ... }
  // per_dim case
  const scales = new Array(half);
  for (let i = 0; i < half; i++) { ... }
}
```

**Implementation to Add**:
```javascript
// Add State
const [quantMode, setQuantMode] = useState('per_dim'); // 'per_dim' | 'global'

// Add UI (in Parameters section)
<div>
  <label>Quantization Mode</label>
  <select value={quantMode} onChange={e => setQuantMode(e.target.value)}>
    <option value="per_dim">Per-Dimension Scale</option>
    <option value="global">Global Scale</option>
  </select>
</div>
```

**Verification Items**:
- Compare RMSE difference between `per_dim` and `global`
- Visualize patent claim (per_dim is more accurate than global)

### B-2: pack/unpack Verification Implementation (Priority: Medium)

**Problem**: UI shows "pack/unpack" but no verifiable metrics

**Current Code** (`src/App.jsx` Line 32-35):
```javascript
function int8ToUint8(x) { return x & 0xff; }
function uint8ToInt8(u) { const v = u & 0xff; return v >= 128 ? v - 256 : v; }
function pack2x8ToU16(lo, hi) { return (int8ToUint8(lo) | (int8ToUint8(hi) << 8)) & 0xffff; }
function unpackU16To2x8(p) { return [uint8ToInt8(p & 0xff), uint8ToInt8((p >> 8) & 0xff)]; }
```

**Implementation to Add**:
```javascript
// Calculate pack/unpack match rate inside runSimulation
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

// Display result
const packMatchRate = packTotal > 0 ? ((packTotal - packMismatch) / packTotal * 100) : 100;
```

**UI Display Addition**:
```jsx
<div className="text-xs">
  Pack/Unpack Match Rate: {packMatchRate.toFixed(2)}%
</div>
```

### B-3: Clarify Calculation Precision (Priority: Low)

**Problem**: JS uses `float64`, but UI displays "float32 reference"

**Option 1**: Add annotation
```jsx
<p className="text-xs text-gray-500">
  * Relative comparison within browser (baseline vs mixed). Not exact float32 precision.
</p>
```

**Option 2**: Emulate float32 with Math.fround (increases computation cost)
```javascript
const xEven = Math.fround(rand());
const xOdd = Math.fround(rand());
// But sin/cos/exp/log remain float64
```

→ Recommended: **Option 1** (add annotation)

### B-4: seqLen Upper Limit Guard Enhancement (Priority: Low)

**Problem**: Browser may slow down at seqLen=65536, dim=256

**Implementation to Add**:
```javascript
const MAX_SAFE_CELLS = 1_000_000; // seqLen × dim upper limit
const cellCount = seqLen * dim;

if (cellCount > MAX_SAFE_CELLS) {
  alert(`Computation too large (${cellCount.toLocaleString()} cells). Please reduce seqLen or dim.`);
  return;
}
```

## Reference Files
- `src/App.jsx` Line 2042-2166: `runSimulation` function
- GPT-5.2 Pro review (user provided)

## Completion Criteria
1. quantMode switchable from UI
2. pack/unpack match rate displayed
3. float64 calculation explicitly noted
4. Safety guard works for large seqLen

## Test Procedure
```bash
npm run dev
# 1. Switch quantMode and verify RMSE changes
# 2. Turn on usePackDemo and verify pack/unpack match rate = 100%
# 3. Verify guard triggers at seqLen=65536, dim=256
```
