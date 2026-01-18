# 🤖 RoPE × Optimus Simulator

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/tests-19%20passed-brightgreen.svg)]()

An interactive simulator demonstrating how **quantization errors** in RoPE (Rotary Position Embedding) affect **robot joint control precision**. Based on concepts from Tesla Patent US20260017019A1 (RoPE Mixed-Precision Hardware).

> **🥚 Try the Egg Grip Game!** - Can you hold an egg without breaking it at 2-bit quantization?

---

## 🎯 What This Demonstrates

### The Problem
When neural networks control robot joints (like Tesla Optimus), they use position encodings. **Quantizing** these encodings to fewer bits saves hardware resources but introduces **control errors**.

### The Solution (Tesla's Approach)
Instead of directly quantizing angles θ, quantize **log(θ)** and reconstruct via **exp()**. This preserves precision for low-frequency components while tolerating some error in high-frequency ones.

### This Simulator Shows
- **Visual comparison** of Mixed-Precision vs Naive quantization error accumulation
- **Hands-on demo** where quantization noise makes robot hands shake
- **Hardware approximation** effects (Taylor series exp, LUT-based sin/cos)

---

## 🚀 Quick Start

```bash
# Clone the repository
git clone https://github.com/e-230129/Rope_simulator_optimus.git
cd Rope_simulator_optimus/rope-optimus-simulator

# Install dependencies
npm install

# Start development server
npm run dev
```

Open http://localhost:5173 in your browser.

---

## 🎮 How to Use

### 1. Run a Simulation
Click **"Run Simulation"** to compute RMSE (Root Mean Square Error) across sequence positions.

### 2. Compare Methods
- **Cyan line (Mixed-Precision)**: Tesla's log/exp approach - error stays bounded
- **Orange line (Naive)**: Direct angle quantization - error accumulates over position

### 3. Try the Egg Grip Game
1. Enable **Noise Mode** (toggle button)
2. Adjust the **Grip** slider to hold the egg
3. Lower the **Bits** to 2-4 and watch the hand shake!
4. Too much noise = 🍳 broken egg

### 4. Experiment with Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| **Sequence Length** | 4096 | Number of positions (like transformer context length) |
| **Dimension** | 64 | Embedding dimension (analogous to joint DOFs) |
| **Quantization Bits** | 8 | Lower = more error, but less hardware cost |
| **Quant Mode** | per_dim | Scale computation: per-dimension or global |
| **Random Seed** | 42 | For reproducibility |

### 5. Hardware Approximation Mode
Toggle these to simulate actual hardware implementations:
- **exp() Taylor-5**: 5th-order Taylor series with range reduction
- **sin/cos LUT-256**: 256-entry lookup table with linear interpolation

The UI shows approximation error metrics when enabled.

---

## 📊 Understanding the Charts

### RMSE vs Position
```
Error (log scale)
    │
    │    ╱ Naive (orange) - error grows!
    │   ╱
    │  ╱  ── Mixed-Precision (cyan) - bounded
    │_╱___________________________________
                                    Position →
```

### Stats Cards
- **Mean RMSE**: Average error across all positions
- **Drift**: How much error grows from start to end (Naive >> Mixed-Precision)
- **Pack/Unpack Match Rate**: Verifies bit-packing integrity (should be 100%)

### Error Distribution Histogram
Shows the distribution of quantization errors - useful for understanding tail behavior.

---

## 🔧 View Modes

| Mode | Description |
|------|-------------|
| **SVG Mode** | Simple vector graphics - fast and clean |
| **Photo Mode** | Real Optimus hand image with egg |
| **Pixi Mode** | WebGL mesh deformation demo |
| **Noise Mode** | Applies quantization noise to hand movement |

---

## 📋 Config Fingerprint

At the bottom of the screen, you'll see a one-line configuration:
```
seqLen=4096 dim=64 base=10000 bits=8 quantMode=per_dim seed=42 expMode=native trigMode=native showNaive=true usePackDemo=true
```

Click **📋 Copy** to share exact reproduction conditions with others.

---

## 🧪 Running Tests

```bash
# Install Playwright browsers (first time only)
npx playwright install chromium

# Run tests
npm test

# View test report
npx playwright show-report
```

**Expected**: 19 tests passed

---

## 🏗️ Technical Background

### RoPE (Rotary Position Embedding)
A method to encode position information in transformer models using rotation matrices. Widely used in modern LLMs (LLaMA, etc.).

### Why This Matters for Robotics
- Tesla Optimus likely uses transformer-based control
- Joint angles could be encoded using RoPE-like mechanisms
- Quantization for edge deployment introduces control instability

### The Log/Exp Trick
```
Traditional: θ → quantize → θ̂ (error accumulates linearly)
Mixed-Precision: θ → log(θ) → quantize → exp() → θ̂ (error bounded)
```

### Hardware Considerations
- **Taylor-5 exp()**: Implemented with multiplies and adds (no FPU needed)
- **LUT sin/cos**: ROM lookup + linear interpolation
- Range reduction ensures numerical stability

---

## 📁 Project Structure

```
rope-optimus-simulator/
├── src/
│   ├── App.jsx          # Main React component (2700+ lines)
│   ├── App.stable.jsx   # Stable reference version
│   └── index.css        # Tailwind CSS
├── tests/               # Playwright E2E tests
├── public/
│   └── tesla-optimus-hands.jpg
└── docs/
    ├── adr/             # Architecture Decision Records
    └── tasks/           # Development task docs
```

---

## 🔬 Key Implementation Details

### Quantization Functions
```javascript
// Signed quantization with rounding
quantizeSigned(x, scale, qmax) → clamp(round(x / scale), -qmax, qmax)

// Pack two 8-bit values into 16-bit (simulates hardware)
pack2x8ToU16(a, b) → ((a & 0xFF) << 8) | (b & 0xFF)
```

### Range-Reduced exp() Approximation
```javascript
// exp(x) = 2^k * exp(r), where |r| ≤ ln(2)/2
expTaylor5Safe(x) {
  k = round(x / ln2)
  r = x - k * ln2  // Now |r| ≤ 0.347
  return 2^k * taylor5(r)  // Taylor accurate for small r
}
```

### Streaming Computation
Large simulations run in chunks with `setTimeout(0)` yields to keep UI responsive.

---

## 📖 References

- **Tesla Patent US20260017019A1**: RoPE Mixed-Precision Hardware
- **RoPE Paper**: [RoFormer: Enhanced Transformer with Rotary Position Embedding](https://arxiv.org/abs/2104.09864)
- **Optimus**: Tesla's humanoid robot using transformer-based control

---

## 🤝 Contributing

Issues and PRs welcome! This project uses:
- React 18 + Vite
- Tailwind CSS
- Recharts for visualization
- Playwright for testing

---

## 📄 License

MIT License - See [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

- Tesla for the innovative patent concepts
- The RoPE/RoFormer authors for the foundational research
- Claude (Anthropic) and GPT-5.2 Pro for development assistance and code review

---

*Built with ❤️ to make quantization effects tangible*
