// =====================================================================
// Карта усадеб на собственном движке «Картограф» (js/kartograf/*).
// Подложка — собственные векторные тайлы assets/basemap (данные OSM),
// без внешних сервисов и без Leaflet.
// =====================================================================
let map;
let estateLayer;
let markersGroup;          // совместимость со старым кодом: то же, что estateLayer
let overlayLayers = [];
let historicalOverlaysEnabled = false;

const SOSLOVIE_COLORS = [
  "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
  "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf",
  "#4e79a7", "#f28e2b", "#59a14f", "#e15759", "#76b7b2"
];

const DEFAULT_COLOR = "#C49A5C";

// Пределы перемещения карты — чуть шире покрытия подложки
const MAP_MAX_BOUNDS = [[56.655, 60.24], [56.98, 60.92]];
const BASEMAP_VERSION = "20260927";

const SETTLEMENT_BOUNDS = {
  "Екатеринбург": [[56.7927911754743, 60.5750235922242], [56.8551170611752, 60.6562421757520]],
  "Нижне-Исетск": [[56.7421477889542, 60.6734656696532], [56.7549395792231, 60.7047743621075]],
  "Уктус": [[56.7765203849077, 60.6388761928545], [56.7856875315059, 60.6663385556073]]
};

const OVERLAY_BASE_PATH = "assets/overlays-lite";
const OVERLAY_VERSION = "20260619-ni-no-mode-1";
const overlayUrl = fileName => (window.KH_INLINE_ASSETS && window.KH_INLINE_ASSETS[fileName]) ||
  `${OVERLAY_BASE_PATH}/${fileName}?v=${OVERLAY_VERSION}`;

const HISTORICAL_OVERLAYS = [
  { url: overlayUrl("ekb-plan-1.webp"), bounds: [[56.8377931146054, 60.5702035731542], [56.8522689721454, 60.6079379255312]] },
  { url: overlayUrl("ekb-plan-2.webp"), bounds: [[56.8396680218251, 60.6026082847361], [56.8551170611752, 60.6395297198479]] },
  { url: overlayUrl("ekb-plan-3.webp"), bounds: [[56.8218774047269, 60.5750235922242], [56.8402751837158, 60.6132545360013]] },
  { url: overlayUrl("ekb-plan-4.webp"), bounds: [[56.8258407106161, 60.6068097453513], [56.8445465369357, 60.6463043603396]] },
  { url: overlayUrl("ekb-plan-5.webp"), bounds: [[56.8087627383191, 60.5798843778145], [56.8260436112885, 60.6185924669467]] },
  { url: overlayUrl("ekb-plan-6.webp"), bounds: [[56.8117186117775, 60.6123612106181], [56.8299963336875, 60.6493399108491]] },
  { url: overlayUrl("ekb-plan-8.webp"), bounds: [[56.7927911754743, 60.6182411553104], [56.8157711510122, 60.6562421757520]] },
  { url: overlayUrl("ni-plan-1.webp"), bounds: [[56.7442144208524, 60.6734656696532], [56.7543139226161, 60.6957519187631]] },
  { url: overlayUrl("ni-plan-2.webp"), bounds: [[56.7464309702041, 60.6826682492235], [56.7540138535890, 60.7047743621075]] },
  { url: overlayUrl("ni-plan-3.webp"), bounds: [[56.7472015644912, 60.6755104796883], [56.7532665336143, 60.6855516477125]] },
  { url: overlayUrl("ni-plan-4.webp"), bounds: [[56.7459709072051, 60.6829023722163], [56.7549395792231, 60.6993132898570]] },
  { url: overlayUrl("ni-plan-5.webp"), bounds: [[56.7456499933395, 60.6920532418001], [56.7494902463049, 60.7032789640166]] },
  { url: overlayUrl("ni-plan-6.webp"), bounds: [[56.7421477889542, 60.6879534783064], [56.7489477047511, 60.7016004049810]] },
  { url: overlayUrl("uktus-plan-2.webp"), bounds: [[56.7800202483807, 60.6491429946757], [56.7845546472531, 60.6555451392860]] },
  { url: overlayUrl("uktus-plan-3.webp"), bounds: [[56.7834411939831, 60.6503580016756], [56.7851184893273, 60.6539975060555]] },
  { url: overlayUrl("uktus-plan-4.webp"), bounds: [[56.7814179562033, 60.6523835454807], [56.7856875315059, 60.6604668952290]] },
  { url: overlayUrl("uktus-plan-5.webp"), bounds: [[56.7804315741802, 60.6586974140737], [56.7837600435609, 60.6663385556073]] },
  { url: overlayUrl("uktus-plan-6.webp"), bounds: [[56.7785904897463, 60.6555498939090], [56.7824954235554, 60.6641415059546]] },
  { url: overlayUrl("uktus-plan-7.webp"), bounds: [[56.7765203849077, 60.6529681496874], [56.7804519934062, 60.6653534687148]] },
  { url: overlayUrl("uktus-plan-8.webp"), bounds: [[56.7767378571737, 60.6388761928545], [56.7812317014816, 60.6509493738894]] },
  { url: overlayUrl("uktus-plan-1.webp"), bounds: [[56.7796392134027, 60.653159060667576], [56.78138896288448, 60.65679496812579]] }
];

let soslovieColorMap = null;

function getSoslovieColor(item) {
  if (shouldUseColorCoding()) {
    if (!soslovieColorMap) {
      const values = [...new Set(allData.map(d => d.soslovie).filter(Boolean))].sort();
      soslovieColorMap = new Map(values.map((value, index) => [
        value,
        SOSLOVIE_COLORS[index % SOSLOVIE_COLORS.length]
      ]));
    }
    return (item.soslovie && soslovieColorMap.get(item.soslovie)) || DEFAULT_COLOR;
  }

  return DEFAULT_COLOR;
}

function shouldUseColorCoding() {
  return Boolean(state.soslovie && state.soslovie.size >= 2);
}

function isMobileViewport() {
  return window.matchMedia("(max-width: 768px)").matches;
}

function currentTheme() {
  return document.body.classList.contains("dark-theme") || localStorage.getItem("theme") === "dark" ? "dark" : "light";
}

function initMap() {
  map = new Kartograf.Map("map", {
    center: [56.82, 60.60],
    zoom: 12,
    minZoom: 10,
    maxZoom: 19,
    maxBounds: MAP_MAX_BOUNDS,
    theme: currentTheme(),
    basemap: {
      url: `assets/basemap/basemap.json?v=${BASEMAP_VERSION}`,
      workerUrl: `js/kartograf/tile-worker.js?v=${BASEMAP_VERSION}`,
      // автономный комплект тайлов: карта работает и без сервера (file://)
      offlineUrl: "assets/basemap/offline/",
      // элементы сайта поверх карты, под которые не ставим подписи
      obstacles: "#overlayControl, .theme-toggle.floating, .cross-badge.show, .sources-panel",
      // ?kg=main — принудительно рисовать в основном потоке (для отладки)
      forceMainThread: new URLSearchParams(location.search).get("kg") === "main",
      keepAttribution: true
    }
  });
  map.container.setAttribute("aria-label", "Карта усадеб. Стрелки — перемещение, плюс и минус — масштаб");

  estateLayer = new Kartograf.FeatureLayer({ zIndex: 300 });
  estateLayer.on("click", e => openEstate(e.feature.data, e));
  map.addLayer(estateLayer);
  markersGroup = estateLayer;

  window.map = map;
  window.markersGroup = markersGroup;

  // Тема сайта переключается классом на body — подложка следует за ней
  new MutationObserver(() => map.setTheme(currentTheme()))
    .observe(document.body, { attributes: true, attributeFilter: ["class"] });

  map.on("click", () => estateLayer.setSelected(null));
  map.on("basemaperror", () => {
    console.warn("Подложка недоступна: нет папки assets/basemap");
  });

  initOverlay(HISTORICAL_OVERLAYS);

  const initialSettlement = new URLSearchParams(window.location.search).get("settlement");
  if (initialSettlement && SETTLEMENT_BOUNDS[initialSettlement]) {
    setTimeout(() => flyToSettlement(initialSettlement), 150);
  }
}

function polygonFor(item) {
  const numKey = String(Math.round(parseFloat(item.num)));
  if (item.settlement === "Нижне-Исетск") return niPolygons[numKey];
  if (item.settlement === "Екатеринбург") return ekbPolygons[numKey];
  if (item.settlement === "Уктус" && typeof uktPolygons !== "undefined") return uktPolygons[numKey];
  return null;
}

function renderMap(filtered) {
  if (!estateLayer) return;
  if (shouldUseColorCoding()) soslovieColorMap = null;
  const mobile = isMobileViewport();

  const features = [];
  filtered.forEach(item => {
    if (!item.lat || !item.lng) return;
    const color = getSoslovieColor(item);
    const poly = polygonFor(item);
    if (poly) {
      features.push({
        id: item.id,
        rings: [poly.coords.map(c => [c[1], c[0]])],
        color, fillOpacity: 0.35, weight: 1.5, opacity: 0.8,
        data: item
      });
    } else {
      // Контура в ГИС-слое нет (сейчас так только у №969): рисуем
      // пунктирный кружок, чтобы его не приняли за точное место участка.
      const minSize = mobile ? 6 : 5;
      features.push({
        id: item.id,
        center: [item.lat, item.lng],
        radius: Math.max(minSize, Math.min(10, Math.sqrt(item.area_sazh || 100) * 0.25)),
        color, fillOpacity: 0.18, weight: mobile ? 2 : 1.5, opacity: 0.95, dashed: true,
        data: item
      });
    }
  });
  estateLayer.setFeatures(features);
  if (estateLayer.selectedId != null && !estateLayer.byId.has(estateLayer.selectedId)) {
    estateLayer.setSelected(null);
    map.closePopup();
  }
}

function estatePopupHtml(item) {
  const displayNum = formatNum(item.num);
  const fullName = [item.surname, item.name, item.patronymic].filter(Boolean).join(" ");
  let html = `<div class="popup-inner"><div class="popup-title">Усадьба №${esc(displayNum)}</div>`;
  [
    ["Владелец", fullName],
    ["Поселение", item.settlement],
    ["Тип", item.buildingType],
    ["Сословие", item.soslovie],
    ["Семейное положение", item.familyStatus],
    ["Чин", item.rank],
    ["Место приписки", item.registrationPlace],
    ["Место службы", item.servicePlace],
    ["Площадь", item.area_sazh ? `${item.area_sazh} саж.` : ""],
    ["Источник", formatArchiveSource(item.source)]
  ].forEach(row => {
    if (row[1]) {
      html += `<div class="popup-row"><span class="popup-lbl">${row[0]}</span><span>${esc(row[1])}</span></div>`;
    }
  });
  if (!polygonFor(item)) {
    html += `<div class="popup-note">Контур участка не оцифрован; точка показывает приблизительное место.</div>`;
  }
  if (item.scanUrl) {
    html += `<div class="popup-row"><span class="popup-lbl">Скан</span><span><a href="#" onclick="openScan('${esc(item.scanUrl)}'); return false;">Открыть скан</a></span></div>`;
  }
  return html + "</div>";
}

// Клик/касание по усадьбе: на компьютере — попап у точки,
// на телефоне — карточка в нижней шторке (попап там мешает).
function openEstate(item, e) {
  estateLayer.setSelected(item.id);
  if (!isMobileViewport()) {
    const at = e && e.latlng ? e.latlng : estateAnchor(item);
    map.openPopup(at, estatePopupHtml(item), { className: "custom-popup", maxWidth: 300 });
  }
  if (typeof showSelected === "function") showSelected(item);
}

function estateAnchor(item) {
  const poly = polygonFor(item);
  return poly && poly.clat ? [poly.clat, poly.clng] : [item.lat, item.lng];
}

function flyToSettlement(settlement) {
  const bounds = SETTLEMENT_BOUNDS[settlement];
  if (!map || !bounds) return;
  map.flyToBounds(bounds, {
    duration: 1.2,
    paddingTopLeft: [24, 24],
    paddingBottomRight: [24, isMobileViewport() ? 90 : 24]
  });
}

function initOverlay(overlays) {
  const opacity = document.getElementById("overlayOpacity");
  const initialOpacity = ((opacity && Number(opacity.value)) || 45) / 100;
  // Растры грузятся лениво: только когда слой включён и план попал в кадр
  overlayLayers = overlays.map(item => new Kartograf.ImageOverlay(item.url, item.bounds, {
    opacity: initialOpacity,
    visible: false,
    zIndex: 100
  }));
  overlayLayers.forEach(layer => map.addLayer(layer));

  const control = document.getElementById("overlayControl");
  if (control) control.style.display = "block";

  const panelToggle = document.getElementById("overlayControlToggle");
  if (control && panelToggle) {
    panelToggle.onclick = function(event) {
      event.stopPropagation();
      const expanded = control.classList.toggle("expanded");
      panelToggle.setAttribute("aria-expanded", String(expanded));
    };
    control.addEventListener("click", event => event.stopPropagation());
    map.on("click", () => {
      control.classList.remove("expanded");
      panelToggle.setAttribute("aria-expanded", "false");
    });
  }

  const toggle = document.getElementById("overlayToggle");
  if (toggle) {
    toggle.checked = false;
    toggle.onchange = function() {
      historicalOverlaysEnabled = this.checked;
      if (opacity) opacity.disabled = !historicalOverlaysEnabled;
      syncHistoricalOverlays();
    };
  }

  if (opacity) {
    opacity.disabled = true;
    opacity.oninput = function() {
      const value = this.value / 100;
      overlayLayers.forEach(layer => layer.setOpacity(value));
    };
  }
}

function syncHistoricalOverlays() {
  overlayLayers.forEach(layer => layer.setVisible(historicalOverlaysEnabled));
}
