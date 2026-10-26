"""Derive small web textures from the project's original procedural panorama."""
import base64
import io
import re
from pathlib import Path
from PIL import Image

assets = Path(__file__).resolve().parent.parent / "assets"
source = (assets / "space-panorama-data.js").read_text(encoding="utf-8")
raw = base64.b64decode(re.search(r"base64,([^'\"]+)", source).group(1))
original = Image.open(io.BytesIO(raw)).convert("RGB")
for width in (1024, 2048):
    image = original.resize((width, width // 2), Image.Resampling.LANCZOS)
    target = assets / f"space-panorama-{width}.webp"
    image.save(target, "WEBP", quality=82, method=6)
    print(f"{target.name}: {target.stat().st_size} bytes, {width}x{width // 2}")
