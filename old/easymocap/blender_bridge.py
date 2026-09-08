from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Optional


def find_blender() -> Optional[Path]:
    """Find Blender without requiring the user to configure the app first."""
    found = shutil.which("blender")
    if found:
        return Path(found)

    root = Path(r"C:\Program Files\Blender Foundation")
    if root.exists():
        candidates = sorted(
            root.glob("Blender */blender.exe"),
            key=lambda p: p.parent.name,
            reverse=True,
        )
        if candidates:
            return candidates[0]
    return None


def export_fbx(
    blender: str | Path,
    source_fbx: str | Path,
    take_json: str | Path,
    output_fbx: str | Path,
) -> subprocess.CompletedProcess:
    script = Path(__file__).resolve().parent / "blender_export.py"
    cmd = [
        str(Path(blender)),
        "--background",
        "--factory-startup",
        "--python",
        str(script),
        "--",
        str(Path(source_fbx).resolve()),
        str(Path(take_json).resolve()),
        str(Path(output_fbx).resolve()),
    ]
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        check=False,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
