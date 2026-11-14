# ZCode Brand Logo Kit

Master creative: cream ribbon **Z** with orange fold accents and two terminal dots, on deep blue-black plate `#2C343C`.

Source master: [`source/zcode-app-icon.png`](./source/zcode-app-icon.png)

## Palette

| Token | Hex | Use |
| --- | --- | --- |
| Plate | `#2C343C` | App icon / badge background |
| Cream | `#F5F0E6` | Ribbon body |
| Orange | `#FF6A1A` | Fold accents + terminal dots |
| Light ground | `#F7F5F2` | Light lockup / mark-on-light |

## Layout

```
assets/brand/
  source/          # Master raster (1024)
  app-icon/        # Squircle-masked desktop icons + .ico
  mark/            # On-dark / on-light / transparent mark
  lockup/          # Horizontal badge + "ZCode" wordmark
  mono/            # Flat SVG marks (currentColor / cream-orange)
  favicon/         # 16–512 PNG + favicon.ico + apple-touch
  social/          # Open Graph 1200×630 / 2400×1260
  ui/              # Small badge PNGs + logo-badge.svg
  exports/         # Raw generation stills (jpg)
```

## Usage guide

| Surface | Asset |
| --- | --- |
| macOS / Windows / Linux app icon | `app-icon/` → also wired in `packages/desktop/build/` |
| In-app title / provider badge | `packages/ui/.../logo-zai.svg` (from `ui/logo-badge.svg`) |
| Marketing lockup (dark) | `lockup/lockup-horizontal-dark-*.png` |
| Marketing lockup (light) | `lockup/lockup-horizontal-light-*.png` |
| Transparent mark overlays | `mark/mark-transparent-*.png` |
| Favicon / PWA | `favicon/` |
| Social / OG | `social/og-1200x630.png` |
| Mono UI silhouette | `mono/mark-ribbon-mono.svg` |

## Clear space

Keep clear space around the mark ≥ **1/8 of the badge width** on each side. Do not place other logos inside the plate. Do not recolor cream/orange independently for product UI badges.

## Regenerate desktop icons

```bash
python3 packages/desktop/scripts/regen-app-icons.py
# prefers packages/desktop/build/icon-plate.png (full-plate mode)
```

To rebuild this kit from `assets/zcode-app-icon.png`, re-run the brand export script used in the agent session (or copy masters into `source/` and resize with the same size table above).

## Notes

- Raster lockups/marks may include generative texture; prefer `app-icon/` and `ui/logo-badge.svg` for product surfaces.
- Geometric `currentColor` Z used by About / startup loading remains available for monochrome UI; ribbon mono SVG is the brand-aligned replacement when updating those surfaces.
