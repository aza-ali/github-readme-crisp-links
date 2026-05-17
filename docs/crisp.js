/**
 * crisp.js — browser port of the crisp-links Python CLI.
 *
 * Generates the same SVGs as `crisp.py`. Width is measured via Canvas
 * with the same system font stack the SVGs render against, so widths
 * stay within 1-2px of the Python (Pillow + Helvetica Bold) version —
 * comfortably inside the leading/trailing buffer.
 *
 * No DOM dependencies. Safe to require/import anywhere a Canvas is available.
 */
(function (global) {
  "use strict";

  const PRESETS = {
    rainbow: ["#FF6B6B", "#FFA500", "#FFD700", "#10B981", "#4F46E5", "#A855F7"],
    sunset:  ["#DC2626", "#F59E0B", "#EC4899"],
    ocean:   ["#06B6D4", "#3B82F6", "#8B5CF6"],
    mint:    ["#10B981", "#06B6D4"],
    candy:   ["#EC4899", "#8B5CF6"],
    dusk:    ["#4F46E5", "#A855F7"],
  };

  const DEFAULTS = Object.freeze({
    fontSize: 16,
    fontWeight: 600,
    height: 22,
    leading: 6,
    trailing: 4,
    gradientAngle: 90,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  });

  // Reusable canvas for text measurement
  let _ctx = null;
  function _measureCtx() {
    if (_ctx) return _ctx;
    const canvas = (typeof OffscreenCanvas !== "undefined")
      ? new OffscreenCanvas(8, 8)
      : (typeof document !== "undefined" ? document.createElement("canvas") : null);
    if (!canvas) throw new Error("crisp.js needs a Canvas (browser or OffscreenCanvas).");
    _ctx = canvas.getContext("2d");
    return _ctx;
  }

  // ---- Path-mode font (opentype.js) -------------------------------------
  // Used for gradient rendering: converts glyphs to vector paths so the
  // gradient applies cleanly without per-glyph fuzziness.
  let _font = null;
  let _fontLoadPromise = null;

  function loadFont(url) {
    if (_font) return Promise.resolve(_font);
    if (_fontLoadPromise) return _fontLoadPromise;
    if (typeof opentype === "undefined") {
      return Promise.reject(new Error("opentype.js not loaded"));
    }
    _fontLoadPromise = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error("font fetch failed: " + r.status);
        return r.arrayBuffer();
      })
      .then((buf) => {
        _font = opentype.parse(buf);
        return _font;
      })
      .catch((err) => {
        _fontLoadPromise = null; // allow retry
        throw err;
      });
    return _fontLoadPromise;
  }

  function isFontLoaded() {
    return _font !== null;
  }

  function measureWidth(text, fontSize, fontWeight, fontFamily) {
    const ctx = _measureCtx();
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    return ctx.measureText(text).width;
  }

  function normalizeColor(input) {
    if (input == null) throw new Error("missing color");
    let c = String(input).trim().replace(/^#/, "");
    if (!/^([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c)) {
      throw new Error(`invalid hex color: ${input}`);
    }
    if (c.length === 3) c = c.split("").map((ch) => ch + ch).join("");
    return "#" + c.toUpperCase();
  }

  function parseGradient(spec) {
    if (Array.isArray(spec)) {
      return spec.map(normalizeColor);
    }
    if (typeof spec !== "string") throw new Error("gradient must be string or array");
    const trimmed = spec.trim();
    if (PRESETS[trimmed.toLowerCase()]) {
      return PRESETS[trimmed.toLowerCase()].map(normalizeColor);
    }
    return trimmed.split(",").map((s) => s.trim()).filter(Boolean).map(normalizeColor);
  }

  // CSS-style angle: 0=up, 90=right, 180=down, 270=left.
  // Returns endpoints in 0-100 percentages.
  function gradientEndpoints(angleDeg) {
    const rad = (angleDeg * Math.PI) / 180;
    const dx = Math.sin(rad);
    const dy = -Math.cos(rad);
    return {
      x1: 50 - dx * 50,
      y1: 50 - dy * 50,
      x2: 50 + dx * 50,
      y2: 50 + dy * 50,
    };
  }

  function buildGradientDef(colors, angle) {
    const { x1, y1, x2, y2 } = gradientEndpoints(angle);
    const n = colors.length;
    const stops = colors
      .map((c, i) => {
        const offset = n === 1 ? 0 : Math.round((i * 100) / (n - 1));
        return `<stop offset="${offset}%" stop-color="${c}"/>`;
      })
      .join("");
    return (
      `<linearGradient id="crisp-grad" x1="${x1.toFixed(1)}%" y1="${y1.toFixed(1)}%" ` +
      `x2="${x2.toFixed(1)}%" y2="${y2.toFixed(1)}%">${stops}</linearGradient>`
    );
  }

  function xmlEscape(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  // Path-based generator: converts text to vector paths via opentype.js, then
  // fills with userSpaceOnUse gradient. Avoids the fuzzy rendering browsers
  // produce for <text fill="url(#g)"> at small sizes. Requires loadFont() first.
  function generatePaths(opts) {
    if (!_font) throw new Error("font not loaded; call Crisp.loadFont(url) first");

    const name = opts.name;
    const fontSize = opts.fontSize ?? DEFAULTS.fontSize;
    const height = opts.height ?? DEFAULTS.height;
    const leading = opts.leading ?? DEFAULTS.leading;
    const trailing = opts.trailing ?? DEFAULTS.trailing;
    const colors = parseGradient(opts.gradient);
    const angle = opts.gradientAngle ?? DEFAULTS.gradientAngle;

    const baseline = Math.round(height / 2 + fontSize * 0.25);
    const advance = _font.getAdvanceWidth(name, fontSize);
    const width = Math.round(leading + advance + trailing);

    // opentype.js positions glyphs at (x, y) with y = baseline in display coords.
    // The path data comes out already positioned and scaled — no extra transforms.
    const path = _font.getPath(name, leading, baseline, fontSize);
    const pathData = path.toPathData(3); // 3 decimal precision

    const n = colors.length;
    const stops = colors
      .map((c, i) => {
        const offset = n === 1 ? 0 : Math.round((i * 100) / (n - 1));
        return `<stop offset="${offset}%" stop-color="${c}"/>`;
      })
      .join("");

    // userSpaceOnUse so the gradient spans the entire word, not per-glyph.
    // Default direction is horizontal (leading → leading+advance). For non-90
    // angles, apply a gradientTransform rotation around the gradient center.
    const gradX1 = leading;
    const gradX2 = leading + advance;
    const cx = (gradX1 + gradX2) / 2;
    const rotation = angle - 90;
    const gradientTransform =
      rotation === 0
        ? ""
        : ` gradientTransform="rotate(${rotation} ${cx} ${baseline})"`;

    const gradientDef =
      `<linearGradient id="crisp-grad" gradientUnits="userSpaceOnUse" ` +
      `x1="${gradX1}" y1="0" x2="${gradX2}" y2="0"${gradientTransform}>` +
      stops +
      `</linearGradient>`;

    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" ` +
      `width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
      `<defs>${gradientDef}</defs>` +
      `<path d="${pathData}" fill="url(#crisp-grad)"/>` +
      `</svg>`;

    return { svg, width, height };
  }

  // Solid-color path: keeps <text> so the browser uses its native font
  // rasterizer (with hinting). Smaller, sharper than path conversion at 16px.
  function generateText(opts) {
    const name = opts.name;
    const fontSize = opts.fontSize ?? DEFAULTS.fontSize;
    const fontWeight = opts.fontWeight ?? DEFAULTS.fontWeight;
    const height = opts.height ?? DEFAULTS.height;
    const leading = opts.leading ?? DEFAULTS.leading;
    const trailing = opts.trailing ?? DEFAULTS.trailing;
    const fontFamily = opts.fontFamily ?? DEFAULTS.fontFamily;

    const textWidth = measureWidth(name, fontSize, fontWeight, fontFamily);
    const width = Math.round(textWidth + leading + trailing);
    // See above for align="absmiddle" baseline rationale.
    const baseline = Math.round(height / 2 + fontSize * 0.25);

    let gradientDef = "";
    let fill;
    if (opts.gradient) {
      // Fallback path (no opentype font loaded yet). Uses <text> + gradient
      // which is fuzzier but renders without the font dependency.
      const colors = parseGradient(opts.gradient);
      const angle = opts.gradientAngle ?? DEFAULTS.gradientAngle;
      gradientDef = `<defs>${buildGradientDef(colors, angle)}</defs>`;
      fill = "url(#crisp-grad)";
    } else {
      const color = normalizeColor(opts.color ?? "#0969DA");
      fill = color;
    }

    const escapedName = xmlEscape(name);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" ` +
      `width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
      gradientDef +
      `<text x="${leading}" y="${baseline}" ` +
      `font-family="${xmlEscape(fontFamily)}" ` +
      `font-size="${fontSize}" font-weight="${fontWeight}" fill="${fill}">` +
      `${escapedName}</text></svg>`;

    return { svg, width, height };
  }

  function generate(opts) {
    if (!opts || !opts.name) throw new Error("name is required");
    // Gradient + font loaded → path-based (sharp). Otherwise text-based.
    if (opts.gradient && _font) {
      return generatePaths(opts);
    }
    return generateText(opts);
  }

  function slugify(name) {
    const s = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return s || "name";
  }

  function snippet({ filename, name, link }) {
    const file = xmlEscape(filename);
    const alt = xmlEscape(name);
    const img = `<img src="${file}" align="absmiddle" alt="${alt}" />`;
    if (link) {
      return `<a href="${xmlEscape(link)}">${img}</a>`;
    }
    return img;
  }

  function downloadSvg(svgString, filename) {
    const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 250);
  }

  function svgDataUrl(svgString) {
    return "data:image/svg+xml;utf8," + encodeURIComponent(svgString);
  }

  global.Crisp = {
    PRESETS,
    DEFAULTS,
    measureWidth,
    normalizeColor,
    parseGradient,
    gradientEndpoints,
    buildGradientDef,
    generate,
    generateText,
    generatePaths,
    loadFont,
    isFontLoaded,
    slugify,
    snippet,
    downloadSvg,
    svgDataUrl,
  };
})(typeof window !== "undefined" ? window : globalThis);
