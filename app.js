/* ===== GeoPlace — application logic ===== */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const form = $("searchForm");
  const input = $("queryInput");
  const btn = $("searchBtn");
  const statusEl = $("status");
  const resultEl = $("result");
  const latEl = $("latValue");
  const lngEl = $("lngValue");
  const placeEl = $("resultPlace");
  const mapEl = $("map");
  const altSection = $("alternatives");
  const altItems = $("altItems");
  const langSelect = $("langSelect");

  let map = null;
  let marker = null;
  let abortCtrl = null;
  let currentResults = [];

  const STORAGE_KEY = "geoplace.lang";

  /* ---------- Language ---------- */
  function populateLanguages() {
    const supported = Object.keys(LANG_NAMES);
    const saved = localStorage.getItem(STORAGE_KEY);
    const browser = (navigator.language || "en").slice(0, 2);
    const initial = saved && TRANSLATIONS[saved] ? saved
      : (TRANSLATIONS[browser] ? browser : "en");
    supported.forEach((code) => {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = LANG_NAMES[code] || code;
      if (code === initial) opt.selected = true;
      langSelect.appendChild(opt);
    });
    return initial;
  }

  function applyLang(code) {
    const t = TRANSLATIONS[code] || TRANSLATIONS.en;
    document.documentElement.lang = code;
    document.documentElement.dir = t.dir || "ltr";

    // Translate every element carrying data-i18n
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (t[key] != null) el.textContent = t[key];
    });
    // Translate attributes (e.g. placeholder)
    document.querySelectorAll("[data-i18n-attr]").forEach((el) => {
      const attr = el.getAttribute("data-i18n-attr");
      const key = el.getAttribute("data-i18n");
      if (t[key] != null) el.setAttribute(attr, t[key]);
    });
    document.title = "GeoPlace — " + (t.appTagline || "");
  }

  function setLang(code, persist) {
    applyLang(code);
    if (persist) localStorage.setItem(STORAGE_KEY, code);
    // Refresh status text if a search is NOT in progress
    if (!statusEl.classList.contains("loading")) {
      statusEl.textContent = "";
      statusEl.className = "status";
    }
    // Re-render current results' copy buttons etc. by re-applying labels
    if (currentResults.length) renderResults(currentResults, code);
  }

  /* ---------- Geocoding ----------
     Primary : Open-Meteo geocoding (free, no key, CORS-enabled, works in mainland China).
     Fallback: OpenStreetMap Nominatim (rest of the world / when Open-Meteo has no hit). */
  function omLanguage() {
    const c = langSelect.value;
    if (c === "zh-TW") return "zh"; // Open-Meteo has no traditional-Chinese variant
    return c.slice(0, 2);
  }

  function normalizeOpenMeteo(data) {
    if (!data || !Array.isArray(data.results)) return [];
    return data.results.map((r) => ({
      lat: String(r.latitude),
      lon: String(r.longitude),
      display_name: [r.name, r.admin1, r.country, r.country_code]
        .filter(Boolean)
        .join(", "),
    }));
  }

  function normalizeNominatim(data) {
    if (!Array.isArray(data)) return [];
    return data.map((r) => ({
      lat: String(r.lat),
      lon: String(r.lon),
      display_name: r.display_name || "",
    }));
  }

  async function geocode(query) {
    if (abortCtrl) abortCtrl.abort();
    abortCtrl = new AbortController();
    const lang = omLanguage();

    // 1) Open-Meteo (primary)
    try {
      const omUrl =
        "https://geocoding-api.open-meteo.com/v1/search?name=" +
        encodeURIComponent(query) +
        "&count=6&language=" + encodeURIComponent(lang) + "&format=json";
      const omRes = await fetch(omUrl, {
        signal: abortCtrl.signal,
        headers: { "Accept-Language": lang },
      });
      if (omRes.ok) {
        const omData = await omRes.json();
        const items = normalizeOpenMeteo(omData);
        if (items.length) return items;
      }
    } catch (e) {
      /* network blocked or error — fall through to Nominatim */
    }

    // 2) Nominatim fallback
    const nomUrl =
      "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&addressdetails=0&accept-language=" +
      encodeURIComponent(lang) + "&q=" + encodeURIComponent(query);
    const res = await fetch(nomUrl, {
      signal: abortCtrl.signal,
      headers: { "Accept-Language": lang },
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const nomData = await res.json();
    const items = normalizeNominatim(nomData);
    if (!items.length) throw new Error("empty");
    return items;
  }

  function fmt(n) {
    const v = Number(n);
    if (!isFinite(v)) return "—";
    // Trim to 6 decimals, drop trailing zeros
    return parseFloat(v.toFixed(6)).toString();
  }

  function renderResults(items, code) {
    const t = TRANSLATIONS[code] || TRANSLATIONS.en;
    if (!items.length) {
      resultEl.hidden = true;
      altSection.hidden = true;
      showStatus(t.noResult, "error");
      return;
    }
    currentResults = items;
    const top = items[0];
    const lat = fmt(top.lat);
    const lng = fmt(top.lon);

    placeEl.textContent = top.display_name || "";
    latEl.textContent = lat;
    lngEl.textContent = lng;
    resetCopyButtons();

    showStatus("", "");
    resultEl.hidden = false;

    drawMap(Number(top.lat), Number(top.lon), top.display_name);

    // Alternatives (skip the first one)
    if (items.length > 1) {
      altItems.innerHTML = "";
      items.slice(1).forEach((it, i) => {
        const li = document.createElement("li");
        li.className = "alt-item";
        li.innerHTML =
          '<span class="alt-name"></span>' +
          '<span class="alt-coord">' + fmt(it.lat) + ", " + fmt(it.lon) + "</span>";
        li.querySelector(".alt-name").textContent = it.display_name || "";
        li.addEventListener("click", () => selectResult(i + 1));
        altItems.appendChild(li);
      });
      altSection.hidden = false;
    } else {
      altSection.hidden = true;
    }
  }

  function selectResult(index) {
    const item = currentResults[index];
    if (!item) return;
    const items = currentResults.slice();
    // Move chosen to front
    items.splice(index, 1);
    items.unshift(item);
    renderResults(items, langSelect.value);
    resultEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  /* ---------- Map basemaps (China-accessible + global fallback) ----------
     geoq / geoqGray / amap use GCJ-02 (China offset) tiles; osm is WGS-84.
     The marker is reprojected to the active basemap's CRS so it stays aligned. */
  const BASEMAPS = {
    geoq: {
      url: "https://map.geoq.cn/ArcGIS/rest/services/ChinaOnlineCommunity/MapServer/tile/{z}/{y}/{x}",
      attr: "© Geoq 智图", crs: "gcj02", subdomains: "",
    },
    geoqGray: {
      url: "https://map.geoq.cn/ArcGIS/rest/services/ChinaOnlineStreetGray/MapServer/tile/{z}/{y}/{x}",
      attr: "© Geoq 智图", crs: "gcj02", subdomains: "",
    },
    amap: {
      url: "https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}",
      attr: "© 高德地图", crs: "gcj02", subdomains: "1234",
    },
    osm: {
      url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      attr: "© OpenStreetMap", crs: "wgs84", subdomains: "abc",
    },
  };
  let currentBaseKey = "geoq";
  let baseLayer = null;
  let autoFallbackDepth = 0;
  let lastLat = null, lastLng = null, lastLabel = null;

  function makeBaseLayer(key) {
    const b = BASEMAPS[key];
    return L.tileLayer(b.url, {
      maxZoom: 18,
      attribution: b.attr,
      subdomains: b.subdomains,
    });
  }

  // WGS-84 -> GCJ-02 (China offset) so markers align on Chinese basemaps
  const GCJ_A = 6378245.0, GCJ_EE = 0.00669342162296594323, GCJ_PI = Math.PI;
  function outOfChina(lat, lng) {
    return !(lng > 73.66 && lng < 135.05 && lat > 3.86 && lat < 53.55);
  }
  function transformLat(x, y) {
    let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    r += (20 * Math.sin(6 * x * GCJ_PI) + 20 * Math.sin(2 * x * GCJ_PI)) * 2 / 3;
    r += (20 * Math.sin(y * GCJ_PI) + 40 * Math.sin(y / 3 * GCJ_PI)) * 2 / 3;
    r += (160 * Math.sin(y / 12 * GCJ_PI) + 320 * Math.sin(y * GCJ_PI / 30)) * 2 / 3;
    return r;
  }
  function transformLng(x, y) {
    let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    r += (20 * Math.sin(6 * x * GCJ_PI) + 20 * Math.sin(2 * x * GCJ_PI)) * 2 / 3;
    r += (20 * Math.sin(x * GCJ_PI) + 40 * Math.sin(x / 3 * GCJ_PI)) * 2 / 3;
    r += (150 * Math.sin(x / 12 * GCJ_PI) + 300 * Math.sin(x / 30 * GCJ_PI)) * 2 / 3;
    return r;
  }
  function wgs84ToGcj02(lat, lng) {
    if (outOfChina(lat, lng)) return [lat, lng];
    let dLat = transformLat(lng - 105.0, lat - 35.0);
    let dLng = transformLng(lng - 105.0, lat - 35.0);
    const radLat = (lat / 180) * GCJ_PI;
    let magic = Math.sin(radLat);
    magic = 1 - GCJ_EE * magic * magic;
    const sqrtMagic = Math.sqrt(magic);
    dLat = (dLat * 180) / ((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic) * GCJ_PI);
    dLng = (dLng * 180) / (GCJ_A / sqrtMagic * Math.cos(radLat) * GCJ_PI);
    return [lat + dLat, lng + dLng];
  }
  function projectForBasemap(lat, lng, key) {
    return BASEMAPS[key].crs === "gcj02" ? wgs84ToGcj02(lat, lng) : [lat, lng];
  }

  function drawMap(lat, lng, label) {
    if (typeof L === "undefined") return; // map library unavailable — coords still shown
    lastLat = lat; lastLng = lng; lastLabel = label;
    if (!map) {
      // Point Leaflet's default markers at the locally bundled images
      if (L.Icon && L.Icon.Default) {
        L.Icon.Default.mergeOptions({
          iconRetinaUrl: "vendor/leaflet/images/marker-icon-2x.png",
          iconUrl: "vendor/leaflet/images/marker-icon.png",
          shadowUrl: "vendor/leaflet/images/marker-shadow.png",
        });
      }
      map = L.map(mapEl, { scrollWheelZoom: false }).setView([lat, lng], 12);
      baseLayer = makeBaseLayer(currentBaseKey);
      baseLayer.addTo(map);
      const p = projectForBasemap(lat, lng, currentBaseKey);
      marker = L.marker(p).addTo(map);
      bindTileErrorFallback();
    } else {
      map.setView([lat, lng], 12);
      const p = projectForBasemap(lat, lng, currentBaseKey);
      marker.setLatLng(p);
    }
    if (label) marker.bindPopup(label).openPopup();
    // Container may have just been un-hidden — fix sizing
    setTimeout(() => map.invalidateSize(), 60);
  }

  function switchBasemap(key, resetDepth) {
    if (!map || !BASEMAPS[key] || key === currentBaseKey) return;
    currentBaseKey = key;
    if (resetDepth) autoFallbackDepth = 0;
    if (baseLayer) map.removeLayer(baseLayer);
    baseLayer = makeBaseLayer(key);
    baseLayer.addTo(map);
    baseLayer.bringToBack();
    if (marker) marker.bringToFront();
    bindTileErrorFallback();
    if (lastLat != null) {
      const p = projectForBasemap(lastLat, lastLng, key);
      marker.setLatLng(p);
      map.setView(p, map.getZoom());
    }
    document.querySelectorAll(".map-opt").forEach((b) =>
      b.classList.toggle("active", b.dataset.base === key));
  }

  function bindTileErrorFallback() {
    if (!baseLayer) return;
    baseLayer.off("tileerror");
    baseLayer.on("tileerror", () => {
      const keys = Object.keys(BASEMAPS);
      if (autoFallbackDepth >= keys.length) return; // tried every source
      autoFallbackDepth++;
      const idx = keys.indexOf(currentBaseKey);
      const next = keys[(idx + 1) % keys.length];
      if (next !== currentBaseKey) switchBasemap(next, false);
    });
  }

  function showStatus(msg, kind) {
    statusEl.textContent = msg;
    statusEl.className = "status" + (kind ? " " + kind : "");
    if (kind === "loading") statusEl.classList.add("loading");
  }

  async function doSearch() {
    const q = input.value.trim();
    const t = TRANSLATIONS[langSelect.value] || TRANSLATIONS.en;
    if (!q) {
      input.focus();
      return;
    }
    btn.disabled = true;
    showStatus(t.locating, "loading");
    try {
      const data = await geocode(q);
      renderResults(data, langSelect.value);
    } catch (err) {
      if (err.name === "AbortError") return; // superseded by a newer request
      showStatus(t.error, "error");
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- Copy to clipboard ---------- */
  function resetCopyButtons() {
    document.querySelectorAll(".copy-btn").forEach((b) => {
      const t = TRANSLATIONS[langSelect.value] || TRANSLATIONS.en;
      b.textContent = t.copy;
      b.classList.remove("done");
    });
  }

  async function copyText(text, btnEl) {
    const t = TRANSLATIONS[langSelect.value] || TRANSLATIONS.en;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      btnEl.textContent = t.copied;
      btnEl.classList.add("done");
      setTimeout(() => {
        btnEl.textContent = t.copy;
        btnEl.classList.remove("done");
      }, 1600);
    } catch (e) {
      /* ignore */
    }
  }

  /* ---------- Wire up ---------- */
  const initLang = populateLanguages();
  setLang(initLang, false);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    doSearch();
  });

  langSelect.addEventListener("change", () => setLang(langSelect.value, true));

  document.addEventListener("click", (e) => {
    const cb = e.target.closest(".copy-btn");
    if (!cb) return;
    const which = cb.getAttribute("data-copy");
    const val = which === "lat" ? latEl.textContent : lngEl.textContent;
    copyText(val, cb);
  });

  // Basemap switcher (China-accessible sources + global fallback)
  document.querySelectorAll(".map-opt").forEach((b) => {
    b.addEventListener("click", () => switchBasemap(b.dataset.base, true));
  });

  // Auto-locate on pause of typing (debounced) — keeps it feeling instant
  let debounceTimer = null;
  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (q.length < 3) return;
    debounceTimer = setTimeout(doSearch, 650);
  });
})();
