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

  /* ---------- Geocoding (Nominatim / OpenStreetMap, no API key) ---------- */
  async function geocode(query) {
    if (abortCtrl) abortCtrl.abort();
    abortCtrl = new AbortController();
    const lang = langSelect.value;
    const url =
      "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&addressdetails=0&accept-language=" +
      encodeURIComponent(lang) + "&q=" + encodeURIComponent(query);

    const res = await fetch(url, {
      signal: abortCtrl.signal,
      headers: { "Accept-Language": lang },
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
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

  function drawMap(lat, lng, label) {
    if (!map) {
      map = L.map(mapEl, { scrollWheelZoom: false }).setView([lat, lng], 12);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap",
      }).addTo(map);
      marker = L.marker([lat, lng]).addTo(map);
    } else {
      map.setView([lat, lng], 12);
      marker.setLatLng([lat, lng]);
    }
    if (label) marker.bindPopup(label).openPopup();
    // Container may have just been un-hidden — fix sizing
    setTimeout(() => map.invalidateSize(), 60);
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

  // Auto-locate on pause of typing (debounced) — keeps it feeling instant
  let debounceTimer = null;
  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (q.length < 3) return;
    debounceTimer = setTimeout(doSearch, 650);
  });
})();
