"""Bundle the local PDF worker for the current platform."""

import os
from pathlib import Path
import subprocess
import sys
import sysconfig


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    work = root / "src-tauri" / "target" / "stakeout-pyinstaller"
    python_license = Path(sysconfig.get_path("stdlib")) / "LICENSE.txt"
    if not python_license.is_file():
        python_license = Path(sys.base_prefix) / "LICENSE.txt"
    if not python_license.is_file():
        raise FileNotFoundError("CPython distribution does not include LICENSE.txt")
    subprocess.run(
        [
            sys.executable, "-m", "PyInstaller", "--noconfirm", "--onedir",
            "--name", "datamine-stakeout", "--distpath", str(root / "src-tauri" / "worker"),
            "--workpath", str(work), "--specpath", str(work),
            "--copy-metadata", "pypdf",
            "--add-data", f"{python_license}{os.pathsep}licenses",
            str(root / "worker" / "stakeout_pdf.py"),
        ],
        cwd=root,
        env={**os.environ, "PYINSTALLER_CONFIG_DIR": str(work / "cache")},
        check=True,
    )


if __name__ == "__main__":
    main()
