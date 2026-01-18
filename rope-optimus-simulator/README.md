# RoPE × Optimus Simulator

A simulator that visualizes the effects of applying Tesla Patent US20260017019A1 (RoPE Mixed-Precision Hardware) concepts to Optimus robot joint control.

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

## Running Tests

```bash
# Install dependencies
npm install

# Install Playwright browsers (first time only)
npx playwright install chromium

# Run tests
npm test

# View test report
npx playwright show-report
```

### Test Structure
- `tests/app.spec.js` - Basic functionality tests
- `tests/parameters.spec.js` - Parameter manipulation tests
- `tests/view-modes.spec.js` - View mode switching tests

**Expected result**: 19 tests passed

## Project Structure (SSOT Compliant)

```
rope-optimus-simulator/
├── CLAUDE.md              # AI Operating Constitution
├── SSOT.md                # Index (Map)
├── plan.md                # Current plan pointer
├── TASKS.md               # Task board
├── progress.md            # AI short-term memory
├── .claude/
│   ├── commands/          # Claude Code commands
│   └── skills/            # Skill definitions
├── docs/
│   ├── requirements/      # Requirements definitions
│   ├── adr/               # Architecture Decision Records
│   └── plans/             # Plan documents
├── scripts/
│   └── validate-ssot.py   # SSOT validation script
└── src/
    ├── App.jsx            # Main component
    ├── App.stable.jsx     # Stable version (reference)
    ├── main.jsx           # Entry point
    └── index.css          # Tailwind CSS
```

## Development with Claude Code

```bash
# Start session
/kickoff

# If lost
/reset

# End session
/update-progress
```

## Features

- **Arm Control Visualization**: 3-joint animation (shoulder, elbow, wrist)
- **Hand Precision Control**: 5-finger movement and egg-holding demo
- **Walking Control**: Leg movement and foot position error display
- **Quantization Comparison**: Mixed-Precision vs Naive RMSE chart

## Purpose

To intuitively understand how RoPE (Rotary Position Embedding) quantization errors affect robot joint control.

- Blue (Cyan) = Ideal position (float32)
- White = Actual position (after quantization)
- Red = Error (delta)

## License

MIT
