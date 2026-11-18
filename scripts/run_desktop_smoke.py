"""Drive the actual Datamine UI and worker in the platform's Tauri WebView."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", choices=("aarch64-apple-darwin", "x86_64-pc-windows-msvc"))
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    tauri = root / "src-tauri"
    env = os.environ.copy()
    env["TAURI_CONFIG"] = json.dumps({
        "identifier": "cz.datamine.stakeout-smoke",
        "app": {"windows": [{"label": "main", "title": "Datamine CI", "create": False}]},
    })
    subprocess.run(
        [
            "cargo", "build", "--manifest-path", str(tauri / "Cargo.toml"),
            "--locked", "--release", "--target", args.target,
            "--features", "tauri/custom-protocol,desktop-smoke",
        ],
        env=env,
        cwd=root,
        check=True,
    )
    target_dir = Path(env.get("CARGO_TARGET_DIR", tauri / "target"))
    suffix = ".exe" if sys.platform == "win32" else ""
    binary = target_dir / args.target / "release" / f"datamine{suffix}"
    completed = subprocess.run([binary], cwd=root, timeout=120, check=True, capture_output=True, encoding="utf-8")
    if "3 exact synthetic points" not in completed.stdout:
        raise RuntimeError("Smoke ended without a verified export.\n" + completed.stdout + completed.stderr)
    print(completed.stdout.strip())


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as exc:
        sys.stderr.write(exc.stderr or "")
        raise SystemExit(exc.returncode) from exc
