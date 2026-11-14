#!/usr/bin/env python3
"""Regenerate packages/desktop/build icon assets from a 1024x1024 source image."""

from __future__ import annotations

import argparse
import io
import struct
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

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


def load_rgba(source: Path) -> Image.Image:
    img = Image.open(source).convert("RGBA")
    if img.size != (1024, 1024):
        img = img.resize((1024, 1024), Image.Resampling.LANCZOS)
    return img


def _is_near_white(pixel: tuple[int, int, int, int], threshold: int) -> bool:
    r, g, b, _a = pixel
    if r >= threshold and g >= threshold and b >= threshold:
        return True
    # Soft card edges / drop-shadow are slightly tinted off-white below the hard threshold.
    value = max(r, g, b)
    chroma = value - min(r, g, b)
    return value >= threshold - 20 and chroma <= 24


def knockout_near_white(img: Image.Image, threshold: int = 235) -> Image.Image:
    """Flood-fill near-white from the canvas edge so Dock icons are not white cards.

    Edge flood-fill keeps interior whites (robot face plate) while clearing the
    outer card, padding, and soft drop-shadow connected to the border.
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument(
        "--build-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "build",
    )
    args = parser.parse_args()

    master = knockout_near_white(load_rgba(args.source))
    build = args.build_dir
    icons = build / "icons"

    # Transparent PNG master for Dock / applyAppIcon; keep JPEG source as design input only.
    write_png(master, build / "icon-source.png", 1024)
    write_png(master, build / "icon.png", 1024)
    write_png(master, build / "icon_windows.png", 1024)
    write_png(master, build / "icon_installer.png", 1024)
    for size in PNG_SIZES:
        write_png(master, icons / f"{size}x{size}.png", size)

    write_ico(master, build / "icon.ico", ICO_SIZES)
    write_ico(master, build / "icon_installer.ico", ICO_SIZES)
    write_icns(master, build / "icon.icns")
    write_icns(master, build / "icon_installer.icns")

    print(f"regenerated icons in {build}")


if __name__ == "__main__":
    main()
