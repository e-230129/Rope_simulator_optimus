# SSOT (Single Source of Truth) Index

RoPE Optimus Simulator - Tesla Patent US20260017019A1 可視化プロジェクト

## Requirements（何を満たす）

- [Requirements](docs/requirements/README.md)

## Decisions（なぜそうした：ADR）

- [ADR Index](docs/adr/README.md)

## Plan（どう作る：承認済み）

- [Plans folder](docs/plans/)
- [Current plan pointer](plan.md)

## Work State（いま何してる）

- [Task board](TASKS.md)
- [AI session state](progress.md)

## Source Code

- [Main App](src/App.jsx) - メインのReactコンポーネント
- [Entry Point](src/main.jsx) - Reactエントリポイント

## Commands（実行方法のSSOT）

- [SSOT validation](scripts/validate-ssot.py)
- Dev server: `npm run dev`
- Build: `npm run build`

---

**検証方法:**
```bash
python3 scripts/validate-ssot.py
```
