#!/usr/bin/env python3
"""
SSOT.md と plan.md のリンク切れを検証する。

機能:
- SSOT.md 内のローカルMarkdownリンク存在検証
- plan.md のポインタ先存在検証
- 必須ファイルの存在検証

Exit code:
  0: OK
  1: 不整合あり
  2: SSOT.md が見つからない
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

RE_MD_LINK = re.compile(r"\[[^\]]+\]\(([^)]+)\)")

REQUIRED_FILES = [
    "CLAUDE.md",
    "SSOT.md",
    "TASKS.md",
    "progress.md",
    "plan.md",
]


def is_local_path(target: str) -> bool:
    """URLやアンカーを除外"""
    if target.startswith(("http://", "https://", "mailto:", "#")):
        return False
    return True


def check_links(md_path: Path, base_dir: Path, verbose: bool = False) -> list[str]:
    """Markdownファイル内のローカルリンクを検証"""
    errors = []
    if not md_path.exists():
        return [f"File not found: {md_path}"]
    
    content = md_path.read_text(encoding="utf-8")
    links = RE_MD_LINK.findall(content)
    
    for link in links:
        # アンカー部分を除去
        link_path = link.split("#")[0]
        if not link_path or not is_local_path(link_path):
            continue
        
        # 相対パスを解決
        target = (md_path.parent / link_path).resolve()
        
        if not target.exists():
            errors.append(f"Broken link in {md_path.name}: {link_path}")
        elif verbose:
            print(f"  ✓ {link_path}")
    
    return errors


def check_plan_pointer(plan_path: Path, base_dir: Path) -> list[str]:
    """plan.md の1行目がポインタとして有効か検証"""
    errors = []
    if not plan_path.exists():
        return [f"plan.md not found"]
    
    content = plan_path.read_text(encoding="utf-8")
    lines = content.strip().split("\n")
    
    if not lines:
        return ["plan.md is empty"]
    
    pointer = lines[0].strip()
    if pointer.startswith("#"):
        return ["plan.md first line should be a file path, not a comment"]
    
    target = (base_dir / pointer).resolve()
    if not target.exists():
        errors.append(f"plan.md points to non-existent file: {pointer}")
    
    return errors


def check_required_files(base_dir: Path) -> list[str]:
    """必須ファイルの存在を検証"""
    errors = []
    for fname in REQUIRED_FILES:
        if not (base_dir / fname).exists():
            errors.append(f"Required file missing: {fname}")
    return errors


def main():
    parser = argparse.ArgumentParser(description="Validate SSOT links")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    args = parser.parse_args()

    # プロジェクトルートを探す
    base_dir = Path.cwd()
    ssot_path = base_dir / "SSOT.md"
    
    if not ssot_path.exists():
        print("✗ SSOT.md not found in current directory", file=sys.stderr)
        sys.exit(2)
    
    all_errors = []
    
    # 必須ファイルチェック
    if args.verbose:
        print("Checking required files...")
    all_errors.extend(check_required_files(base_dir))
    
    # SSOT.md のリンクチェック
    if args.verbose:
        print("Checking SSOT.md links...")
    all_errors.extend(check_links(ssot_path, base_dir, args.verbose))
    
    # plan.md のポインタチェック
    if args.verbose:
        print("Checking plan.md pointer...")
    all_errors.extend(check_plan_pointer(base_dir / "plan.md", base_dir))
    
    if all_errors:
        print("\n✗ SSOT VALIDATION FAILED", file=sys.stderr)
        for err in all_errors:
            print(f"  - {err}", file=sys.stderr)
        sys.exit(1)
    else:
        print("✓ SSOT validation OK")
        sys.exit(0)


if __name__ == "__main__":
    main()
