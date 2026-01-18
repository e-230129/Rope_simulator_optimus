"""
GPT5.2pro アップロード用ZIPファイル作成スクリプト
使用方法: python create-upload-zip.py
"""

import os
import zipfile
import shutil
from datetime import datetime
from pathlib import Path

# 設定
PROJECT_NAME = "rope-optimus-simulator"
UPLOAD_FOLDER = "upload"

# 除外パターン
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
    """ファイル/フォルダを除外すべきか判定"""
    # ディレクトリ名チェック
    for part in path.parts:
        if part in EXCLUDE_DIRS:
            return True

    # ファイル名チェック
    if path.name in EXCLUDE_FILES:
        return True

    # 拡張子チェック
    if path.suffix.lower() in EXCLUDE_EXTENSIONS:
        return True

    return False


def create_zip():
    """ZIPファイルを作成"""
    base_dir = Path(__file__).parent.resolve()
    upload_dir = base_dir / UPLOAD_FOLDER

    # タイムスタンプ付きファイル名
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_filename = f"{PROJECT_NAME}_{timestamp}.zip"
    zip_path = upload_dir / zip_filename

    print("=" * 40)
    print("GPT5.2pro用 ZIPファイル作成スクリプト")
    print("=" * 40)
    print()

    # uploadフォルダ作成
    if not upload_dir.exists():
        print("uploadフォルダを作成中...")
        upload_dir.mkdir(parents=True)

    print("ファイルを収集中...")

    # ZIPファイル作成
    file_count = 0
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        # プロジェクト内の全ファイルを走査
        for file_path in base_dir.rglob("*"):
            if file_path.is_file():
                rel_path = file_path.relative_to(base_dir)

                # 除外判定
                if should_exclude(rel_path):
                    continue

                # ZIPに追加
                zf.write(file_path, rel_path)
                file_count += 1

    # 結果表示
    size_mb = zip_path.stat().st_size / (1024 * 1024)

    print()
    print("=" * 40)
    print("完了!")
    print("=" * 40)
    print(f"出力ファイル: {zip_path}")
    print(f"ファイル数: {file_count}")
    print(f"サイズ: {size_mb:.2f} MB")
    print()
    print("除外されたもの:")
    print(f"  - ディレクトリ: {', '.join(sorted(EXCLUDE_DIRS))}")
    print(f"  - ファイル: {', '.join(sorted(EXCLUDE_FILES))}")
    print(f"  - 拡張子: {', '.join(sorted(EXCLUDE_EXTENSIONS))}")
    print()


if __name__ == "__main__":
    create_zip()
