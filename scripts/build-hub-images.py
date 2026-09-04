"""Build versioned responsive assets from the existing artwork (Pillow + WebP)."""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / "native-server/plugins/account-hub/static"
for name, sizes in [("campus-command", [(480, 60), (960, 72), (1536, 78)]),
                    ("field-table", [(256, 55), (512, 65), (960, 72)])]:
    with Image.open(ROOT / f"{name}.png") as original:
        original = original.convert("RGB")
        for width, quality in sizes:
            resized = original.resize((width, round(width * original.height / original.width)), Image.Resampling.LANCZOS)
            target = ROOT / f"{name}-v1-{width}.webp"
            resized.save(target, "WEBP", quality=quality, method=6)
            print(f"{target.name}: {target.stat().st_size:,} bytes")
