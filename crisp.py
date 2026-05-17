#!/usr/bin/env python3
"""
crisp - generate SVG link text that bypasses GitHub's README underline.

Why this exists:
    GitHub's markdown CSS forces an underline on any <a> that contains text.
    But links that contain only <img> elements get no underline. So we render
    the project name as an SVG image and drop it inside an <a> tag. Clean,
    crisp link text. No CSS hacks. No sanitizer fights.

Usage:
    crisp.py "Retina" --color D97757 --link https://example.com
    crisp.py --batch projects.json
    crisp.py "Retina" --color D97757 --font /path/to/Inter-Bold.ttf

The width of the SVG is measured against Helvetica Bold (or your --font choice)
using Pillow. GitHub renders the SVG against the viewer's font stack at display
time. For short names this matches almost exactly; for long names you may want
to bump --trailing by a px or two.
"""

import argparse
import html
import json
import math
import os
import re
import sys
from pathlib import Path

try:
    from PIL import ImageFont
except ImportError:
    sys.stderr.write(
        "error: Pillow is required.\n"
        "  pip install Pillow\n"
    )
    sys.exit(2)

# fontTools is only needed for gradient rendering (it converts glyphs to vector
# paths so the gradient applies cleanly without the per-glyph fuzziness that
# browsers produce for <text fill="url(#gradient)">).
try:
    from fontTools.ttLib import TTFont
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen
except ImportError:
    TTFont = None


SVG_TEMPLATE = (
    '<svg xmlns="http://www.w3.org/2000/svg" '
    'width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
    '<text x="{x}" y="{y}" '
    'font-family="-apple-system, BlinkMacSystemFont, &quot;Segoe UI&quot;, Helvetica, Arial, sans-serif" '
    'font-size="{fs}" font-weight="{fw}" fill="{color}">{name}</text></svg>\n'
)

SVG_TEMPLATE_PATHS = (
    '<svg xmlns="http://www.w3.org/2000/svg" '
    'width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
    '<defs>{grad}</defs>'
    '<g fill="url(#crisp-grad)" '
    'transform="translate({x}, {y}) scale({scale:.6f}, -{scale:.6f})">'
    '<path d="{d}"/></g></svg>\n'
)

GRADIENT_PRESETS = {
    "rainbow": ["#FF6B6B", "#FFA500", "#FFD700", "#10B981", "#4F46E5", "#A855F7"],
    "sunset": ["#DC2626", "#F59E0B", "#EC4899"],
    "ocean": ["#06B6D4", "#3B82F6", "#8B5CF6"],
    "mint": ["#10B981", "#06B6D4"],
    "candy": ["#EC4899", "#8B5CF6"],
    "dusk": ["#4F46E5", "#A855F7"],
}


FONT_CANDIDATES = [
    ("/System/Library/Fonts/Helvetica.ttc", 1),
    ("/System/Library/Fonts/HelveticaNeue.ttc", 1),
    ("/Library/Fonts/Helvetica.ttc", 1),
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 0),
    ("/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf", 0),
    ("C:/Windows/Fonts/arialbd.ttf", 0),
]


def load_font(font_path, font_size):
    if font_path:
        return ImageFont.truetype(font_path, font_size)
    for path, index in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, font_size, index=index)
            except Exception:
                continue
    sys.stderr.write(
        "warning: no bold system font found; falling back to Pillow default. "
        "Width measurement will be inaccurate. Pass --font /path/to/Bold.ttf for accuracy.\n"
    )
    return ImageFont.load_default()


def find_path_font(user_font_path, user_font_index):
    """Return (path, index) of a font file usable by fontTools for path-mode."""
    if user_font_path:
        return user_font_path, user_font_index or 0
    for path, index in FONT_CANDIDATES:
        if os.path.exists(path):
            return path, index
    return None, 0


def slugify(name):
    s = re.sub(r"[^a-z0-9]+", "-", name.lower())
    return s.strip("-") or "name"


def normalize_color(c):
    c = c.strip().lstrip("#")
    if not re.fullmatch(r"[0-9a-fA-F]{3}|[0-9a-fA-F]{6}", c):
        raise ValueError(f"invalid hex color: {c!r}")
    return "#" + c.upper()


def parse_gradient(spec):
    if isinstance(spec, list):
        return [normalize_color(c) for c in spec]
    spec = spec.strip()
    if spec.lower() in GRADIENT_PRESETS:
        return [normalize_color(c) for c in GRADIENT_PRESETS[spec.lower()]]
    return [normalize_color(c) for c in spec.split(",") if c.strip()]


def _build_path_gradient_def(colors, x_max):
    """userSpaceOnUse gradient spanning x=0..x_max horizontally (left → right).
    Coordinates are in the inner font-unit space established by the <g> transform."""
    n = len(colors)
    stops = "".join(
        f'<stop offset="{0 if n == 1 else int(round(i * 100 / (n - 1)))}%" stop-color="{c}"/>'
        for i, c in enumerate(colors)
    )
    return (
        f'<linearGradient id="crisp-grad" gradientUnits="userSpaceOnUse" '
        f'x1="0" y1="0" x2="{x_max}" y2="0">{stops}</linearGradient>'
    )


def _generate_paths(name, font_path, font_index, font_size,
                    height, leading, trailing, colors):
    """Convert glyphs to vector paths via fontTools, then fill with the gradient.

    Browsers render text-with-gradient via a fallback path that loses font
    hinting and looks fuzzy at small sizes. Pre-baking glyphs as paths and
    filling them via userSpaceOnUse gradient produces sharp output that
    matches the rendering of any other vector shape on the page.
    """
    if TTFont is None:
        raise RuntimeError(
            "fontTools is required for gradient rendering. "
            "Install it: pip install fonttools"
        )
    font_path_resolved, font_idx = find_path_font(font_path, font_index)
    if font_path_resolved is None:
        raise RuntimeError(
            "no system font found for path-mode rendering; "
            "pass --font /path/to/Bold.ttf"
        )

    tt = TTFont(font_path_resolved, fontNumber=font_idx)
    cmap = tt.getBestCmap()
    glyph_set = tt.getGlyphSet()
    hmtx = tt['hmtx']
    units_per_em = tt['head'].unitsPerEm
    scale = font_size / units_per_em

    # Accumulate glyph outlines into a single <path> with x-offsets baked into
    # the coordinates. One path means one bounding box, so the userSpaceOnUse
    # gradient spans the whole word instead of cycling per glyph.
    pen = SVGPathPen(glyph_set)
    x_pen = 0
    for char in name:
        glyph_name = cmap.get(ord(char)) or '.notdef'
        glyph = glyph_set[glyph_name]
        translated_pen = TransformPen(pen, (1, 0, 0, 1, x_pen, 0))
        glyph.draw(translated_pen)
        x_pen += hmtx[glyph_name][0]
    combined_d = pen.getCommands()

    width = int(round(leading + x_pen * scale + trailing))
    # See generate() for baseline rationale (align="absmiddle" alignment).
    baseline = round(height / 2 + font_size * 0.25)
    grad_def = _build_path_gradient_def(colors, x_pen)

    svg = SVG_TEMPLATE_PATHS.format(
        w=width, h=height, x=leading, y=baseline, scale=scale,
        grad=grad_def, d=combined_d,
    )
    return svg, width


def generate(name, color, gradient, gradient_angle, font_path, font_index,
             font_size, font_weight, height, leading, trailing):
    if gradient:
        # Gradient → path-based rendering (sharp glyphs, clean color spread)
        colors = parse_gradient(gradient)
        return _generate_paths(
            name, font_path, font_index, font_size,
            height, leading, trailing, colors,
        )

    # Solid color → keep <text>. Browsers use the native font rasterizer
    # (with hinting) for single-color text, which is sharper than any path
    # conversion at small sizes.
    font = load_font(font_path, font_size)
    text_width = font.getlength(name)
    width = int(round(text_width + leading + trailing))
    # Baseline tuned for align="absmiddle" inline rendering:
    # vertical-align:middle anchors the image center to body x-height middle
    # (~font_size * 0.25 above body baseline). Putting the SVG baseline at
    # height/2 + font_size * 0.25 makes the SVG text baseline land exactly on
    # body baseline, so the text sits flush with surrounding paragraph.
    baseline = round(height / 2 + font_size * 0.25)
    svg = SVG_TEMPLATE.format(
        w=width, h=height, x=leading, y=baseline,
        fs=font_size, fw=font_weight, color=color,
        name=html.escape(name, quote=True),
    )
    return svg, width


def render_snippet(name, output_path, link):
    img_tag = (
        f'<img src="{html.escape(output_path, quote=True)}" '
        f'align="absmiddle" alt="{html.escape(name, quote=True)}" />'
    )
    if link:
        return f'<a href="{html.escape(link, quote=True)}">{img_tag}</a>'
    return img_tag


def process_one(args, item):
    name = item["name"]
    gradient = item.get("gradient") or args.gradient
    gradient_angle = item.get("gradient_angle") if "gradient_angle" in item else args.gradient_angle
    color = None if gradient else normalize_color(item.get("color", args.color))
    output = item.get("output") or args.output or f"{slugify(name)}.svg"
    link = item.get("link") or args.link
    font_path = item.get("font") or args.font
    font_index = item.get("font_index") if "font_index" in item else args.font_index
    font_size = item.get("font_size") or args.font_size
    font_weight = item.get("font_weight") or args.font_weight
    height = item.get("height") or args.height
    leading = item.get("leading") if "leading" in item else args.leading
    trailing = item.get("trailing") if "trailing" in item else args.trailing

    svg, width = generate(
        name=name,
        color=color,
        gradient=gradient,
        gradient_angle=gradient_angle,
        font_path=font_path,
        font_index=font_index,
        font_size=font_size,
        font_weight=font_weight,
        height=height,
        leading=leading,
        trailing=trailing,
    )
    out_path = Path(output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(svg, encoding="utf-8")
    snippet = render_snippet(name, str(out_path), link)
    return out_path, width, snippet


def build_parser():
    p = argparse.ArgumentParser(
        prog="crisp",
        description="Generate SVG link text that bypasses GitHub's README underline.",
    )
    p.add_argument("name", nargs="?", help="Display text (e.g., the project name).")
    p.add_argument("--color", default="0969DA", help="Hex color of the text. Default: 0969DA (GitHub link blue). Ignored if --gradient is set.")
    p.add_argument("--gradient", help="Linear gradient as comma-separated hex colors (e.g., 'EC4899,8B5CF6') or preset name (rainbow, sunset, ocean, mint, candy, dusk).")
    p.add_argument("--gradient-angle", type=int, default=90, help="Gradient angle in degrees, CSS-style. 0=up, 90=right (horizontal, default), 180=down, 270=left.")
    p.add_argument("--output", help="Output SVG path. Default: <slugified-name>.svg in cwd.")
    p.add_argument("--link", help="Wrap the snippet in <a href=...>. Optional.")
    p.add_argument("--font", help="Path to a TTF/OTF/TTC font file. Default: auto-detect Helvetica Bold.")
    p.add_argument("--font-index", type=int, default=None, help="Font index inside a TTC collection. Default: 0 if user-supplied, 1 for system Helvetica.ttc (Bold).")
    p.add_argument("--font-size", type=int, default=16, help="Font size in px. Default: 16.")
    p.add_argument("--font-weight", type=int, default=600, help="Font weight. Default: 600.")
    p.add_argument("--height", type=int, default=22, help="SVG height in px. Default: 22.")
    p.add_argument("--leading", type=int, default=6, help="Leading padding in px. Default: 6.")
    p.add_argument("--trailing", type=int, default=4, help="Trailing padding in px. Default: 4.")
    p.add_argument("--batch", help="Path to a JSON array of items. Each item may set any of: name, color, output, link, font, font_size, font_weight, height, leading, trailing.")
    p.add_argument("--quiet", action="store_true", help="Suppress the stdout snippet (only write files).")
    return p


def main(argv=None):
    args = build_parser().parse_args(argv)

    if args.batch:
        with open(args.batch, encoding="utf-8") as f:
            items = json.load(f)
        if not isinstance(items, list):
            sys.stderr.write("error: --batch file must contain a JSON array.\n")
            sys.exit(2)
    elif args.name:
        items = [{"name": args.name}]
    else:
        build_parser().print_help(sys.stderr)
        sys.exit(2)

    for item in items:
        if "name" not in item or not item["name"]:
            sys.stderr.write(f"error: item missing 'name': {item!r}\n")
            sys.exit(2)
        try:
            out_path, width, snippet = process_one(args, item)
        except ValueError as e:
            sys.stderr.write(f"error: {e}\n")
            sys.exit(2)
        if not args.quiet:
            print(snippet)
        sys.stderr.write(f"wrote {out_path} ({width}x{args.height})\n")


if __name__ == "__main__":
    main()
