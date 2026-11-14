#!/usr/bin/env python3
"""Regenerate packages/desktop/build icon assets as an OpaqueWhiteSquareMaster.

Data shape: OpaqueWhiteSquareMaster. Composite the robot mark onto a fully
opaque white 1024x1024 PNG. macOS Dock masks the square to a squircle; do not
flood-fill-knockout the white card after compositing.
"""

from __future__ import annotations

import argparse
import io
import struct
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageFilter

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

# Mark width relative to canvas (~16% side inset). Interior face-plate whites stay.
MARK_SCALE = 0.68
CANVAS = 1024
SHADOW_ALPHA_SCALE = 0.16
SHADOW_BLUR = 18
SHADOW_Y_OFFSET = 10


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

    Never run this on the final OpaqueWhiteSquareMaster. Edge flood-fill keeps
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
    """Very soft silhouette shadow under the mark; stays inside the white card."""
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


def compose_opaque_white_square(mark: Image.Image) -> Image.Image:
    """OpaqueWhiteSquareMaster: white card + centered mark (~68% width)."""
    target_w = max(1, int(round(CANVAS * MARK_SCALE)))
    scale = target_w / mark.size[0]
    target_h = max(1, int(round(mark.size[1] * scale)))
    sized = mark.resize((target_w, target_h), Image.Resampling.LANCZOS)

    canvas = Image.new("RGBA", (CANVAS, CANVAS), (255, 255, 255, 255))
    x = (CANVAS - target_w) // 2
    y = (CANVAS - target_h) // 2

    shadow = soft_contact_shadow(sized)
    # Shadow pad so blur/offset stay on-canvas without clipping the soft falloff.
    pad = SHADOW_BLUR * 2 + abs(SHADOW_Y_OFFSET)
    shadow_layer = Image.new("RGBA", (CANVAS + pad * 2, CANVAS + pad * 2), (0, 0, 0, 0))
    shadow_layer.paste(shadow, (pad + x, pad + y + SHADOW_Y_OFFSET), shadow)
    shadow_cropped = shadow_layer.crop((pad, pad, pad + CANVAS, pad + CANVAS))
    canvas = Image.alpha_composite(canvas, shadow_cropped)
    canvas.paste(sized, (x, y), sized)
    return canvas


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
            "Build OpaqueWhiteSquareMaster icons for Dock (OS masks squircle)."
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
    # Intentional opaque white square for Dock; macOS supplies the squircle mask.
    master = compose_opaque_white_square(mark)
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

    print(f"regenerated OpaqueWhiteSquareMaster icons in {build} from {source}")


if __name__ == "__main__":
    main()
