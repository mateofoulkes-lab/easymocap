from pathlib import Path

APP_ROOT = Path(__file__).resolve().parent.parent
FIXED_RIG = APP_ROOT / "esqueleto-fase2.fbx"

if not FIXED_RIG.exists():
    raise FileNotFoundError(
        f"EasyMocap fixed rig not found: {FIXED_RIG}. "
        "The app expects esqueleto-fase2.fbx to ship with the project."
    )
