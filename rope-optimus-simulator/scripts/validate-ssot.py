#!/usr/bin/env python3
"""
Validate broken links in SSOT.md and plan.md.

Features:
- Verify local Markdown links in SSOT.md exist
- Verify plan.md pointer target exists
- Verify required files exist

Exit code:
  0: OK
  1: Inconsistencies found
  2: SSOT.md not found
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
    """Exclude URLs and anchors."""
    if target.startswith(("http://", "https://", "mailto:", "#")):
        return False
    return True


def check_links(md_path: Path, base_dir: Path, verbose: bool = False) -> list[str]:
    """Validate local links inside a Markdown file."""
    errors = []
    if not md_path.exists():
        return [f"File not found: {md_path}"]
    
    content = md_path.read_text(encoding="utf-8")
    links = RE_MD_LINK.findall(content)
    
    for link in links:
        # Strip anchor portion
        link_path = link.split("#")[0]
        if not link_path or not is_local_path(link_path):
            continue
        
        # Resolve relative path
        target = (md_path.parent / link_path).resolve()
        
        if not target.exists():
            errors.append(f"Broken link in {md_path.name}: {link_path}")
        elif verbose:
            print(f"  ✓ {link_path}")
    
    return errors


def check_plan_pointer(plan_path: Path, base_dir: Path) -> list[str]:
    """Validate that plan.md line 1 is a valid pointer."""
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
    """Verify required files exist."""
    errors = []
    for fname in REQUIRED_FILES:
        if not (base_dir / fname).exists():
            errors.append(f"Required file missing: {fname}")
    return errors


def main():
    parser = argparse.ArgumentParser(description="Validate SSOT links")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    args = parser.parse_args()

    # Find project root
    base_dir = Path.cwd()
    ssot_path = base_dir / "SSOT.md"
    
    if not ssot_path.exists():
        print("✗ SSOT.md not found in current directory", file=sys.stderr)
        sys.exit(2)
    
    all_errors = []
    
    # Required file check
    if args.verbose:
        print("Checking required files...")
    all_errors.extend(check_required_files(base_dir))
    
    # SSOT.md link check
    if args.verbose:
        print("Checking SSOT.md links...")
    all_errors.extend(check_links(ssot_path, base_dir, args.verbose))
    
    # plan.md pointer check
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
