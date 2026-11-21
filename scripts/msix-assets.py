#!/usr/bin/env python3
"""Start menu, taskbar and Store logos of the MSIX package.

Renders the app icons (apps/ondura/src-tauri/icons) in the sizes and
qualifiers Windows asks for (scale-*, targetsize-*, altform-unplated) into
`<layout>/Assets/<app>/`, plus an unqualified file per logo as a fallback.
Then checks that every logo `<layout>/AppxManifest.xml` names exists, since
Windows shows a blank placeholder icon for a missing one.
scripts/windows-msix.ps1 calls it with the package layout. Needs Pillow
(`pip install pillow`).

Usage: msix-assets.py <layout dir>
"""

import re
import sys
from pathlib import Path

from PIL import Image

ICONS = Path(__file__).resolve().parent.parent / "apps" / "ondura" / "src-tauri" / "icons"
APPS = ["ondura", "mail", "text", "sheets", "slides", "pdf", "notes", "planner", "diagram", "forms"]
SCALES = {100: 1.0, 125: 1.25, 150: 1.5, 200: 2.0, 400: 4.0}
TARGET_SIZES = [16, 24, 32, 48, 256]


def source(app: str) -> Image.Image:
    path = ICONS / "icon.png" if app == "ondura" else ICONS / "apps" / f"{app}.png"
    return Image.open(path).convert("RGBA")


def icon(img: Image.Image, size: int, fill: float = 1.0) -> Image.Image:
    """`img` scaled to `fill` of a transparent square of `size` pixels."""
    inner = max(1, round(size * fill))
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    scaled = img.resize((inner, inner), Image.LANCZOS)
    out.paste(scaled, ((size - inner) // 2, (size - inner) // 2), scaled)
    return out


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    assets = Path(sys.argv[1]) / "Assets"
    for app in APPS:
        img = source(app)
        folder = assets / app
        folder.mkdir(parents=True, exist_ok=True)
        for scale, f in SCALES.items():
            # App list and taskbar (no plate: the icons have their own shape).
            icon(img, round(44 * f)).save(folder / f"Square44x44Logo.scale-{scale}.png")
            # Medium Start tile: the icon in the middle with room around it.
            if scale in (100, 200):
                icon(img, round(150 * f), 0.6).save(folder / f"Square150x150Logo.scale-{scale}.png")
        for size in TARGET_SIZES:
            small = icon(img, size)
            small.save(folder / f"Square44x44Logo.targetsize-{size}.png")
            small.save(folder / f"Square44x44Logo.targetsize-{size}_altform-unplated.png")
        # Unqualified fallbacks (used when no qualified variant matches).
        icon(img, 44).save(folder / "Square44x44Logo.png")
        icon(img, 150, 0.6).save(folder / "Square150x150Logo.png")
    store = source("ondura")
    for scale, f in SCALES.items():
        icon(store, round(50 * f)).save(assets / f"StoreLogo.scale-{scale}.png")
    icon(store, 50).save(assets / "StoreLogo.png")


def check(layout: Path) -> None:
    """Every image the manifest names has its file and its scale variants."""
    manifest = layout / "AppxManifest.xml"
    if not manifest.exists():
        return
    names = sorted(set(re.findall(r"Assets\\[^\"<]+?\.png", manifest.read_text(encoding="utf-8"))))
    missing = []
    for name in names:
        path = layout / name.replace("\\", "/")
        if not path.exists():
            missing.append(str(path))
        for scale in (100, 200):
            variant = path.with_name(f"{path.stem}.scale-{scale}{path.suffix}")
            if not variant.exists():
                missing.append(str(variant))
    if missing:
        sys.exit("missing logos:\n  " + "\n  ".join(missing))
    print(f"{len(names)} logos of the manifest present")


if __name__ == "__main__":
    main()
    check(Path(sys.argv[1]))
