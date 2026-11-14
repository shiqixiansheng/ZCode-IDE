#!/usr/bin/env python3
"""Regenerate packages/desktop/build icon assets as a BakedWhiteSquircleMaster.

Data shape: BakedWhiteSquircleMaster. Bake an opaque white squircle card into
the 1024 PNG with transparent corners; composite the robot mark inside the card.
Do not rely on a full-bleed opaque white square for Dock masking.
"""

from __future__ import annotations

import argparse
import io
import struct
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter

ICONSET_ENTRIES = [
    ("icon_16x16.png", 16),
    ("icon_16x16" + "@" + "2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32" + "@" + "2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128" + "@" + "2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256" + "@" + "2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512" + "@" + "2x.png", 1024),
]

PNG_SIZES = (16, 24, 32, 48, 64, 128, 256, 512, 1024)
ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)

# Mark width relative to card (~16% side inset inside the white face).
MARK_SCALE = 0.68
CANVAS = 1024
SHADOW_ALPHA_SCALE = 0.16
SHADOW_BLUR = 18
SHADOW_Y_OFFSET = 10

# Squircle card geometry (non-obvious why — Dock peer size vs WPS/Edge/Typora):
# CARD_INSET_FRAC=0.08 → card ~84% of canvas. System-masked neighbor tiles keep a
# larger effective margin; a ~97% fill (1.5% inset) reads one Dock size larger.
# The transparent fringe also keeps LANCZOS mipmaps from smearing opaque white
# into the four canvas corners.
# SQUIRCLE_N=5 is a Lamé superellipse (n=2 ellipse, n→∞ square); n≈5 matches
# macOS continuous-corner Dock cards better than a plain rounded-rect.
# MASK_SUPERSAMPLE=2 hard-rasters then downscales for soft AA on the rim.
CARD_INSET_FRAC = 0.08
SQUIRCLE_N = 5.0
MASK_SUPERSAMPLE = 2


def load_rgba(source: Path) -> Image.Image:
    img = Image.open(source).convert("RGBA")
    if img.size != (CANVAS, CANVAS):
        img = img.resize((CANVAS, CANVAS), Image.Resampling.LANCZOS)
    return img


def _is_near_white(pixel: tuple[int, int, int, int], threshold: int) -> bool:
    r, g, b, _a = pixel
    if r >= threshold and g >= threshold and b >= threshold:
        return True
    value = max(r, g, b)
    chroma = value - min(r, g, b)
    return value >= threshold - 20 and chroma <= 24


def knockout_near_white(img: Image.Image, threshold: int = 235) -> Image.Image:
    """Isolate a mark from accidental opaque white JPEG/card inputs only.

    Never run this on the final BakedWhiteSquircleMaster. Edge flood-fill keeps
    interior whites (robot face plate) while clearing border-connected white.
    """
    pixels = img.load()
    width, height = img.size
    visited = [[False] * width for _ in range(height)]
    stack: list[tuple[int, int]] = []
    for x in range(width):
        stack.append((x, 0))
        stack.append((x, height - 1))
    for y in range(height):
        stack.append((0, y))
        stack.append((width - 1, y))

    while stack:
        x, y = stack.pop()
        if x < 0 or y < 0 or x >= width or y >= height or visited[y][x]:
            continue
        visited[y][x] = True
        pixel = pixels[x, y]
        if not _is_near_white(pixel, threshold):
            continue
        pixels[x, y] = (pixel[0], pixel[1], pixel[2], 0)
        stack.extend(((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)))
    return img


def _edge_needs_white_knockout(img: Image.Image) -> bool:
    """True when corners look like an opaque white card (JPEG / unmasked source)."""
    w, h = img.size
    for x, y in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        r, g, b, a = img.getpixel((x, y))
        if a < 250:
            return False
        if not _is_near_white((r, g, b, a), 235):
            return False
    return True


def prepare_mark(img: Image.Image) -> Image.Image:
    """Return a tight RGBA mark cropped to its alpha bbox."""
    mark = img.copy()
    if _edge_needs_white_knockout(mark):
        mark = knockout_near_white(mark)
    bbox = mark.getbbox()
    if bbox is None:
        raise SystemExit("source has no opaque pixels after mark isolation")
    return mark.crop(bbox)


def soft_contact_shadow(mark: Image.Image) -> Image.Image:
    """Very soft silhouette shadow under the mark; clipped to the white card later."""
    alpha = mark.getchannel("A")
    soft = alpha.point(lambda a: int(a * SHADOW_ALPHA_SCALE) if a else 0)
    shadow = Image.merge(
        "RGBA",
        (
            Image.new("L", mark.size, 0),
            Image.new("L", mark.size, 0),
            Image.new("L", mark.size, 0),
            soft,
        ),
    )
    return shadow.filter(ImageFilter.GaussianBlur(radius=SHADOW_BLUR))


def squircle_mask(size: int) -> Image.Image:
    """Luminance mask: 255 inside the card, 0 outside (transparent canvas corners)."""
    ss = MASK_SUPERSAMPLE
    hi = size * ss
    inset = hi * CARD_INSET_FRAC
    half = (hi - 2 * inset) / 2.0
    cx = cy = hi / 2.0
    n = SQUIRCLE_N
    hard = Image.new("L", (hi, hi), 0)
    px = hard.load()
    for y in range(hi):
        ny = abs((y + 0.5 - cy) / half)
        if ny > 1.0:
            continue
        ny_n = ny**n
        for x in range(hi):
            nx = abs((x + 0.5 - cx) / half)
            if nx > 1.0:
                continue
            if nx**n + ny_n <= 1.0:
                px[x, y] = 255
    if ss == 1:
        return hard
    return hard.resize((size, size), Image.Resampling.LANCZOS)


def clip_rgba_to_mask(img: Image.Image, mask: Image.Image) -> Image.Image:
    r, g, b, a = img.split()
    return Image.merge("RGBA", (r, g, b, ImageChops.multiply(a, mask)))


def compose_baked_white_squircle(mark: Image.Image) -> Image.Image:
    """BakedWhiteSquircleMaster: white squircle + centered mark (~68% of card)."""
    card_w = CANVAS * (1.0 - 2.0 * CARD_INSET_FRAC)
    target_w = max(1, int(round(card_w * MARK_SCALE)))
    scale = target_w / mark.size[0]
    target_h = max(1, int(round(mark.size[1] * scale)))
    sized = mark.resize((target_w, target_h), Image.Resampling.LANCZOS)

    mask = squircle_mask(CANVAS)
    card = Image.new("RGBA", (CANVAS, CANVAS), (255, 255, 255, 255))
    card.putalpha(mask)

    x = (CANVAS - target_w) // 2
    y = (CANVAS - target_h) // 2

    content = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    shadow = soft_contact_shadow(sized)
    pad = SHADOW_BLUR * 2 + abs(SHADOW_Y_OFFSET)
    shadow_layer = Image.new("RGBA", (CANVAS + pad * 2, CANVAS + pad * 2), (0, 0, 0, 0))
    shadow_layer.paste(shadow, (pad + x, pad + y + SHADOW_Y_OFFSET), shadow)
    shadow_cropped = shadow_layer.crop((pad, pad, pad + CANVAS, pad + CANVAS))
    content = Image.alpha_composite(content, shadow_cropped)
    content.paste(sized, (x, y), sized)
    content = clip_rgba_to_mask(content, mask)

    return Image.alpha_composite(card, content)


def write_png(img: Image.Image, path: Path, size: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.resize((size, size), Image.Resampling.LANCZOS).save(path, "PNG")


def png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def write_ico(master: Image.Image, path: Path, sizes: tuple[int, ...]) -> None:
    images = [
        (size, png_bytes(master.resize((size, size), Image.Resampling.LANCZOS)))
        for size in sizes
    ]
    count = len(images)
    header = struct.pack("<HHH", 0, 1, count)
    offset = 6 + 16 * count
    entries = b""
    blobs = b""
    for size, data in images:
        width = 0 if size >= 256 else size
        height = 0 if size >= 256 else size
        entries += struct.pack("<BBBBHHII", width, height, 0, 0, 1, 32, len(data), offset)
        blobs += data
        offset += len(data)
    path.write_bytes(header + entries + blobs)


def write_icns(master: Image.Image, path: Path) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        iconset = Path(tmp) / "AppIcon.iconset"
        iconset.mkdir()
        for name, size in ICONSET_ENTRIES:
            write_png(master, iconset / name, size)
        names = sorted(p.name for p in iconset.iterdir())
        if len(names) != len(ICONSET_ENTRIES):
            raise SystemExit(f"iconset incomplete: {names}")
        icns_path = Path(tmp) / "icon.icns"
        subprocess.run(
            ["iconutil", "-c", "icns", str(iconset), "-o", str(icns_path)],
            check=True,
        )
        path.write_bytes(icns_path.read_bytes())


def resolve_source(cli_source: Path | None, build: Path) -> Path:
    if cli_source is not None:
        return cli_source
    mark = build / "icon-mark.png"
    if mark.is_file():
        return mark
    raise SystemExit(
        "pass a source image, or place packages/desktop/build/icon-mark.png"
    )


def main() -> None:
    build_default = Path(__file__).resolve().parents[1] / "build"
    parser = argparse.ArgumentParser(
        description=(
            "Build BakedWhiteSquircleMaster icons for Dock "
            "(white squircle baked into PNG; transparent corners)."
        )
    )
    parser.add_argument(
        "source",
        type=Path,
        nargs="?",
        default=None,
        help="RGBA mark or white-card JPEG; default: build/icon-mark.png if present",
    )
    parser.add_argument(
        "--build-dir",
        type=Path,
        default=build_default,
    )
    args = parser.parse_args()

    build = args.build_dir
    source = resolve_source(args.source, build)
    mark = prepare_mark(load_rgba(source))
    master = compose_baked_white_squircle(mark)
    icons = build / "icons"

    write_png(master, build / "icon-source.png", CANVAS)
    write_png(master, build / "icon.png", CANVAS)
    write_png(master, build / "icon_windows.png", CANVAS)
    write_png(master, build / "icon_installer.png", CANVAS)
    for size in PNG_SIZES:
        write_png(master, icons / f"{size}x{size}.png", size)

    write_ico(master, build / "icon.ico", ICO_SIZES)
    write_ico(master, build / "icon_installer.ico", ICO_SIZES)
    write_icns(master, build / "icon.icns")
    write_icns(master, build / "icon_installer.icns")

    print(f"regenerated BakedWhiteSquircleMaster icons in {build} from {source}")


if __name__ == "__main__":
    main()
