"""
GPT5.2pro upload ZIP file creation script
Usage: python create-upload-zip.py
"""

import os
import zipfile
import shutil
from datetime import datetime
from pathlib import Path

# Settings
PROJECT_NAME = "rope-optimus-simulator"
UPLOAD_FOLDER = "upload"

# Exclusion patterns
EXCLUDE_DIRS = {
    "node_modules",
    ".git",
    "dist",
    "temp_for_zip",
    "upload",
    "__pycache__",
    ".venv",
    "venv",
}

EXCLUDE_FILES = {
    ".DS_Store",
    "Thumbs.db",
}

EXCLUDE_EXTENSIONS = {
    ".log",
    ".zip",
    ".tmp",
}


def should_exclude(path: Path) -> bool:
    """Return True if a file/folder should be excluded."""
    # Check directory names
    for part in path.parts:
        if part in EXCLUDE_DIRS:
            return True

    # Check file name
    if path.name in EXCLUDE_FILES:
        return True

    # Check extension
    if path.suffix.lower() in EXCLUDE_EXTENSIONS:
        return True

    return False


def create_zip():
    """Create ZIP file."""
    base_dir = Path(__file__).parent.resolve()
    upload_dir = base_dir / UPLOAD_FOLDER

    # Timestamped filename
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_filename = f"{PROJECT_NAME}_{timestamp}.zip"
    zip_path = upload_dir / zip_filename

    print("=" * 40)
    print("GPT5.2pro ZIP creation script")
    print("=" * 40)
    print()

    # Create upload folder
    if not upload_dir.exists():
        print("Creating upload folder...")
        upload_dir.mkdir(parents=True)

    print("Collecting files...")

    # Create ZIP file
    file_count = 0
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        # Scan all files in the project
        for file_path in base_dir.rglob("*"):
            if file_path.is_file():
                rel_path = file_path.relative_to(base_dir)

                # Exclusion check
                if should_exclude(rel_path):
                    continue

                # Add to ZIP
                zf.write(file_path, rel_path)
                file_count += 1

    # Summary
    size_mb = zip_path.stat().st_size / (1024 * 1024)

    print()
    print("=" * 40)
    print("Done!")
    print("=" * 40)
    print(f"Output file: {zip_path}")
    print(f"File count: {file_count}")
    print(f"Size: {size_mb:.2f} MB")
    print()
    print("Excluded items:")
    print(f"  - Directories: {', '.join(sorted(EXCLUDE_DIRS))}")
    print(f"  - Files: {', '.join(sorted(EXCLUDE_FILES))}")
    print(f"  - Extensions: {', '.join(sorted(EXCLUDE_EXTENSIONS))}")
    print()


if __name__ == "__main__":
    create_zip()
