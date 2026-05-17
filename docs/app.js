/**
 * app.js — UI logic for the crisp-links web app.
 * Wires inputs to the Crisp engine, manages state, syncs to URL hash,
 * handles preview/theme/copy/download/batch.
 */
(function () {
  "use strict";

  // ---- State -------------------------------------------------------------
  const state = {
    name: "Lumen",
    mode: "solid", // "solid" | "preset" | "custom"
    color: "#D97757",
    preset: null,
    customStops: ["#FF6B6B", "#A855F7"],
    customAngle: 90,
    link: "",
    fontSize: 16,
    fontWeight: 600,
    height: 22,
    leading: 6,
    trailing: 4,
    previewTheme: "light",
  };

  // ---- DOM refs ----------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    name: $("input-name"),
    colorPicker: $("color-picker"),
    colorSwatchPreview: $("color-swatch-preview"),
    colorHex: $("color-hex"),
    quickColors: $$(".quick-color"),
    segTabs: $$(".seg-tab"),
    modePanels: $$(".mode-panel"),
    presetCards: $$(".preset-card"),
    stopsList: $("stops-list"),
    addStop: $("btn-add-stop"),
    angle: $("input-angle"),
    angleVal: $("angle-val"),
    link: $("input-link"),
    fontSize: $("input-font-size"),
    fontWeight: $("input-font-weight"),
    height: $("input-height"),
    leading: $("input-leading"),
    trailing: $("input-trailing"),
    previewCanvas: $("preview-canvas"),
    previewSvg: $("preview-svg"),
    previewLink: $("preview-link"),
    themePills: $$(".theme-pill"),
    appThemeToggle: $("app-theme-toggle"),
    metaDim: $("meta-dim"),
    metaBytes: $("meta-bytes"),
    outputMarkdown: $("output-markdown"),
    outputSvg: $("output-svg"),
    copyMd: $("btn-copy-md"),
    downloadSvg: $("btn-download-svg"),
    batchInput: $("batch-input"),
    batchRun: $("btn-batch-run"),
    batchResults: $("batch-results"),
    toast: $("toast"),
  };

  // ---- Render -----------------------------------------------------------
  let currentSvg = "";
  let currentMd = "";
  let currentFilename = "";

  function buildGenerateOpts() {
    const opts = {
      name: state.name,
      fontSize: state.fontSize,
      fontWeight: state.fontWeight,
      height: state.height,
      leading: state.leading,
      trailing: state.trailing,
    };
    if (state.mode === "solid") {
      opts.color = state.color;
    } else if (state.mode === "preset" && state.preset) {
      opts.gradient = state.preset;
    } else if (state.mode === "custom") {
      opts.gradient = state.customStops.slice();
      opts.gradientAngle = state.customAngle;
    } else {
      // fallback: solid current color
      opts.color = state.color;
    }
    return opts;
  }

  function render() {
    let result;
    try {
      result = Crisp.generate(buildGenerateOpts());
    } catch (err) {
      console.error(err);
      dom.outputMarkdown.textContent = `// ${err.message}`;
      dom.outputSvg.textContent = "";
      return;
    }

    currentSvg = result.svg;
    currentFilename = Crisp.slugify(state.name) + ".svg";

    // Preview
    dom.previewSvg.src = Crisp.svgDataUrl(currentSvg);
    dom.previewSvg.style.width = result.width + "px";
    dom.previewSvg.style.height = result.height + "px";
    dom.previewLink.href = state.link || "#";

    // Markdown snippet (use a sensible default path for the snippet)
    currentMd = Crisp.snippet({
      filename: currentFilename,
      name: state.name,
      link: state.link,
    });
    dom.outputMarkdown.textContent = currentMd;
    dom.outputSvg.textContent = currentSvg;

    // Meta
    dom.metaDim.textContent = `${result.width} × ${result.height} px`;
    dom.metaBytes.textContent = `${new Blob([currentSvg]).size} bytes`;

    syncUrlHash();
  }

  // ---- Mode panels -------------------------------------------------------
  function setMode(mode) {
    state.mode = mode;
    dom.segTabs.forEach((t) => {
      const active = t.dataset.mode === mode;
      t.classList.toggle("active", active);
      t.setAttribute("aria-selected", active ? "true" : "false");
    });
    dom.modePanels.forEach((p) => {
      p.classList.toggle("hidden", p.dataset.modePanel !== mode);
    });
    render();
  }

  // ---- Solid color sync --------------------------------------------------
  function setColorFromHex(hex, sourceInput) {
    let normalized;
    try {
      normalized = Crisp.normalizeColor(hex);
    } catch (e) {
      return false;
    }
    state.color = normalized;
    if (sourceInput !== "picker") dom.colorPicker.value = normalized;
    if (sourceInput !== "hex") dom.colorHex.value = normalized.replace(/^#/, "");
    dom.colorSwatchPreview.style.background = normalized;
    dom.quickColors.forEach((b) => {
      b.classList.toggle("selected", "#" + b.dataset.hex.toUpperCase() === normalized);
    });
    return true;
  }

  // ---- Presets -----------------------------------------------------------
  function setPreset(name) {
    state.preset = name;
    dom.presetCards.forEach((c) => {
      c.classList.toggle("selected", c.dataset.preset === name);
    });
    render();
  }

  // ---- Custom stops ------------------------------------------------------
  function renderStops() {
    dom.stopsList.innerHTML = "";
    state.customStops.forEach((color, i) => {
      const row = document.createElement("div");
      row.className = "stop-row";

      const swatch = document.createElement("label");
      swatch.className = "stop-swatch";
      const colorInput = document.createElement("input");
      colorInput.type = "color";
      colorInput.value = color;
      colorInput.addEventListener("input", () => {
        state.customStops[i] = colorInput.value.toUpperCase();
        hexInput.value = colorInput.value.replace(/^#/, "").toUpperCase();
        preview.style.background = colorInput.value;
        render();
      });
      const preview = document.createElement("span");
      preview.className = "stop-swatch-preview";
      preview.style.background = color;
      swatch.appendChild(colorInput);
      swatch.appendChild(preview);

      const hexInput = document.createElement("input");
      hexInput.type = "text";
      hexInput.className = "text-input mono stop-hex";
      hexInput.value = color.replace(/^#/, "");
      hexInput.maxLength = 7;
      hexInput.addEventListener("input", () => {
        try {
          const normalized = Crisp.normalizeColor(hexInput.value);
          state.customStops[i] = normalized;
          colorInput.value = normalized;
          preview.style.background = normalized;
          render();
        } catch (_) {
          /* invalid yet, ignore */
        }
      });

      const remove = document.createElement("button");
      remove.className = "btn-icon";
      remove.setAttribute("aria-label", "Remove color stop");
      remove.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>';
      remove.disabled = state.customStops.length <= 2;
      remove.addEventListener("click", () => {
        if (state.customStops.length <= 2) return;
        state.customStops.splice(i, 1);
        renderStops();
        render();
      });

      row.appendChild(swatch);
      row.appendChild(hexInput);
      row.appendChild(remove);
      dom.stopsList.appendChild(row);
    });
  }

  // ---- Theme toggles -----------------------------------------------------
  function setPreviewTheme(theme) {
    state.previewTheme = theme;
    dom.previewCanvas.setAttribute("data-theme", theme);
    dom.themePills.forEach((p) => {
      const active = p.dataset.theme === theme;
      p.classList.toggle("active", active);
      p.setAttribute("aria-selected", active ? "true" : "false");
    });
    syncUrlHash();
  }

  function setAppTheme(theme) {
    document.body.setAttribute("data-app-theme", theme);
    try {
      localStorage.setItem("crisp-app-theme", theme);
    } catch (_) {}
  }

  function initAppTheme() {
    // Override priority: ?theme= query > localStorage > prefers-color-scheme > light default
    const urlOverride = new URLSearchParams(location.search).get("theme");
    if (urlOverride === "light" || urlOverride === "dark") {
      setAppTheme(urlOverride);
      return;
    }
    let saved = null;
    try {
      saved = localStorage.getItem("crisp-app-theme");
    } catch (_) {}
    if (saved === "light" || saved === "dark") {
      setAppTheme(saved);
      return;
    }
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    setAppTheme(prefersDark ? "dark" : "light");
  }

  // ---- Copy + download ---------------------------------------------------
  let toastTimer = null;
  function toast(msg) {
    dom.toast.textContent = msg;
    dom.toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => dom.toast.classList.remove("visible"), 1800);
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // Fallback for older browsers / non-secure contexts
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch (_) {}
      document.body.removeChild(ta);
      return true;
    }
  }

  // ---- URL hash state sync -----------------------------------------------
  function serializeState() {
    const p = new URLSearchParams();
    p.set("name", state.name);
    p.set("mode", state.mode);
    if (state.mode === "solid") p.set("color", state.color.replace(/^#/, ""));
    else if (state.mode === "preset" && state.preset) p.set("preset", state.preset);
    else if (state.mode === "custom") {
      p.set("stops", state.customStops.map((s) => s.replace(/^#/, "")).join(","));
      p.set("angle", String(state.customAngle));
    }
    if (state.link) p.set("link", state.link);
    if (state.previewTheme !== "light") p.set("pt", state.previewTheme);
    if (state.fontSize !== 16) p.set("fs", state.fontSize);
    if (state.height !== 22) p.set("h", state.height);
    if (state.fontWeight !== 600) p.set("fw", state.fontWeight);
    if (state.leading !== 6) p.set("ld", state.leading);
    if (state.trailing !== 4) p.set("tr", state.trailing);
    return p.toString();
  }

  let suppressHashWrite = false;
  function syncUrlHash() {
    if (suppressHashWrite) return;
    const next = "#" + serializeState();
    if (location.hash !== next) {
      history.replaceState(null, "", next);
    }
  }

  function readUrlHash() {
    const hash = location.hash.replace(/^#/, "");
    if (!hash) return;
    const p = new URLSearchParams(hash);
    if (p.has("name")) state.name = p.get("name");
    if (p.has("link")) state.link = p.get("link");
    const mode = p.get("mode");
    if (mode === "solid" || mode === "preset" || mode === "custom") state.mode = mode;
    if (p.has("color")) {
      try {
        state.color = Crisp.normalizeColor(p.get("color"));
      } catch (_) {}
    }
    if (p.has("preset") && Crisp.PRESETS[p.get("preset")]) state.preset = p.get("preset");
    if (p.has("stops")) {
      try {
        state.customStops = p.get("stops").split(",").map((s) => Crisp.normalizeColor(s));
      } catch (_) {}
    }
    if (p.has("angle")) state.customAngle = parseInt(p.get("angle"), 10) || 90;
    if (p.has("pt")) state.previewTheme = p.get("pt");
    if (p.has("fs")) state.fontSize = parseInt(p.get("fs"), 10) || 16;
    if (p.has("h")) state.height = parseInt(p.get("h"), 10) || 22;
    if (p.has("fw")) state.fontWeight = parseInt(p.get("fw"), 10) || 600;
    if (p.has("ld")) state.leading = parseInt(p.get("ld"), 10) || 6;
    if (p.has("tr")) state.trailing = parseInt(p.get("tr"), 10) || 4;
  }

  function applyStateToDom() {
    dom.name.value = state.name;
    dom.link.value = state.link;
    dom.fontSize.value = state.fontSize;
    dom.fontWeight.value = state.fontWeight;
    dom.height.value = state.height;
    dom.leading.value = state.leading;
    dom.trailing.value = state.trailing;
    dom.angle.value = state.customAngle;
    dom.angleVal.textContent = state.customAngle + "°";
    setColorFromHex(state.color);
    if (state.preset) setPreset(state.preset);
    renderStops();
    // mode must come after preset so panels show correctly
    suppressHashWrite = true;
    setMode(state.mode);
    setPreviewTheme(state.previewTheme);
    suppressHashWrite = false;
  }

  // ---- Batch mode --------------------------------------------------------
  function runBatch() {
    const text = dom.batchInput.value.trim();
    let items;
    try {
      items = JSON.parse(text);
    } catch (e) {
      dom.batchResults.innerHTML =
        '<p class="batch-error">JSON parse error: ' + escapeHtml(e.message) + "</p>";
      return;
    }
    if (!Array.isArray(items)) {
      dom.batchResults.innerHTML = '<p class="batch-error">Top-level must be an array.</p>';
      return;
    }

    const frag = document.createDocumentFragment();
    items.forEach((item, idx) => {
      const card = document.createElement("div");
      card.className = "batch-card";
      try {
        const result = Crisp.generate({
          name: item.name,
          color: item.color,
          gradient: item.gradient,
          gradientAngle: item.gradient_angle ?? item.gradientAngle,
          fontSize: item.font_size ?? item.fontSize,
          fontWeight: item.font_weight ?? item.fontWeight,
          height: item.height,
          leading: item.leading,
          trailing: item.trailing,
        });
        const filename = item.output || Crisp.slugify(item.name) + ".svg";
        const snippet = Crisp.snippet({
          filename,
          name: item.name,
          link: item.link,
        });
        card.innerHTML = `
          <div class="batch-card-head">
            <span class="batch-card-name">${escapeHtml(item.name)}</span>
            <span class="batch-card-meta mono">${result.width} × ${result.height} · ${filename}</span>
          </div>
          <div class="batch-card-preview"><img src="${Crisp.svgDataUrl(result.svg)}" alt=""></div>
          <pre class="code-block compact"><code>${escapeHtml(snippet)}</code></pre>
          <div class="batch-card-actions">
            <button class="btn-copy" data-batch-copy-md>Copy markdown</button>
            <button class="btn-copy" data-batch-download>Download .svg</button>
          </div>
        `;
        card.querySelector("[data-batch-copy-md]").addEventListener("click", async () => {
          await copyToClipboard(snippet);
          toast("Markdown copied");
        });
        card.querySelector("[data-batch-download]").addEventListener("click", () => {
          Crisp.downloadSvg(result.svg, filename.split("/").pop());
          toast("Downloaded " + filename.split("/").pop());
        });
      } catch (e) {
        card.innerHTML = `<p class="batch-error">Item ${idx + 1}: ${escapeHtml(e.message)}</p>`;
      }
      frag.appendChild(card);
    });
    dom.batchResults.innerHTML = "";
    dom.batchResults.appendChild(frag);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // ---- Events ------------------------------------------------------------
  function bindEvents() {
    dom.name.addEventListener("input", () => {
      state.name = dom.name.value;
      render();
    });

    dom.colorPicker.addEventListener("input", () => {
      setColorFromHex(dom.colorPicker.value, "picker");
      render();
    });

    dom.colorHex.addEventListener("input", () => {
      const v = dom.colorHex.value;
      // accept with or without #
      try {
        Crisp.normalizeColor(v);
        setColorFromHex(v, "hex");
        render();
      } catch (_) {
        // still typing
      }
    });

    dom.quickColors.forEach((b) =>
      b.addEventListener("click", () => {
        setColorFromHex("#" + b.dataset.hex);
        render();
      })
    );

    dom.segTabs.forEach((t) =>
      t.addEventListener("click", () => setMode(t.dataset.mode))
    );

    dom.presetCards.forEach((c) =>
      c.addEventListener("click", () => setPreset(c.dataset.preset))
    );

    dom.addStop.addEventListener("click", () => {
      const last = state.customStops[state.customStops.length - 1] || "#000000";
      state.customStops.push(last);
      renderStops();
      render();
    });

    dom.angle.addEventListener("input", () => {
      state.customAngle = parseInt(dom.angle.value, 10);
      dom.angleVal.textContent = state.customAngle + "°";
      render();
    });

    dom.link.addEventListener("input", () => {
      state.link = dom.link.value.trim();
      render();
    });

    // Advanced numeric inputs
    [
      ["fontSize", dom.fontSize, 16],
      ["fontWeight", dom.fontWeight, 600],
      ["height", dom.height, 22],
      ["leading", dom.leading, 6],
      ["trailing", dom.trailing, 4],
    ].forEach(([key, el, fallback]) => {
      el.addEventListener("input", () => {
        const v = parseInt(el.value, 10);
        state[key] = Number.isFinite(v) ? v : fallback;
        render();
      });
    });

    dom.themePills.forEach((p) =>
      p.addEventListener("click", () => setPreviewTheme(p.dataset.theme))
    );

    dom.appThemeToggle.addEventListener("click", () => {
      const current = document.body.getAttribute("data-app-theme") || "light";
      setAppTheme(current === "light" ? "dark" : "light");
    });

    dom.copyMd.addEventListener("click", async () => {
      await copyToClipboard(currentMd);
      toast("Markdown copied");
    });

    dom.downloadSvg.addEventListener("click", () => {
      Crisp.downloadSvg(currentSvg, currentFilename);
      toast("Downloaded " + currentFilename);
    });

    dom.batchRun.addEventListener("click", runBatch);

    window.addEventListener("hashchange", () => {
      readUrlHash();
      applyStateToDom();
      render();
    });
  }

  // ---- Boot --------------------------------------------------------------
  function boot() {
    initAppTheme();
    readUrlHash();
    bindEvents();
    applyStateToDom();
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
