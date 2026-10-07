// Состояние фильтров
let state = {};
let searchQuery = "";
let expanded = {};
let AREA_VALUES = [];
let AREA_MIN = 1;
let AREA_MAX = 1;
let areaRange = { min: AREA_MIN, max: AREA_MAX };

function refreshAreaBounds() {
  AREA_VALUES = allData.map(item => Number(item.area_sazh)).filter(value => Number.isFinite(value) && value > 0);
  AREA_MIN = AREA_VALUES.length ? Math.floor(Math.min(...AREA_VALUES)) : 1;
  AREA_MAX = AREA_VALUES.length ? Math.ceil(Math.max(...AREA_VALUES)) : 1;
  areaRange = { min: AREA_MIN, max: AREA_MAX };
}

function areaRangeActive() {
  return areaRange.min > AREA_MIN || areaRange.max < AREA_MAX;
}

function matchesArea(item) {
  if (!areaRangeActive()) return true;
  const value = Number(item.area_sazh);
  return Number.isFinite(value) && value > 0 && value >= areaRange.min && value <= areaRange.max;
}

function areaToPosition(value) {
  return Math.round(Math.log(value / AREA_MIN) / Math.log(AREA_MAX / AREA_MIN) * 1000);
}

function positionToArea(position) {
  return Math.round(AREA_MIN * Math.pow(AREA_MAX / AREA_MIN, position / 1000));
}

const HIDDEN_FILTER_VALUES = {
  servicePlace: new Set(["Третья часть"]),
  registrationPlace: new Set(["Место приписки"])
};

// Инициализация состояния фильтров
function initFiltersState() {
  FILTERS.forEach(f => {
    state[f.key] = new Set();
  });
}

// Получение отфильтрованных данных
function getFiltered() {
  return allData.filter(item => {
    if (searchQuery && !matchesSearch(item, searchQuery)) return false;
    if (!matchesArea(item)) return false;
    for (let i = 0; i < FILTERS.length; i++) {
      const f = FILTERS[i];
      if (state[f.key].size > 0 && !state[f.key].has(item[f.key])) return false;
    }
    return true;
  });
}

// Получение кросс-статистики
function getCrossCounts(dimKey) {
  const counts = {};
  allData.forEach(item => {
    if (searchQuery && !matchesSearch(item, searchQuery)) return;
    if (!matchesArea(item)) return;
    for (let i = 0; i < FILTERS.length; i++) {
      const f = FILTERS[i];
      if (f.key !== dimKey && state[f.key].size > 0 && !state[f.key].has(item[f.key])) return;
    }
    counts[item[dimKey]] = (counts[item[dimKey]] || 0) + 1;
  });
  return counts;
}

// Переключение фильтра
function toggle(key, value) {
  if (state[key].has(value)) {
    state[key].delete(value);
  } else {
    state[key].add(value);
  }
  if (key === "settlement" && typeof flyToSettlement === "function") {
    setTimeout(() => {
      if (state.settlement.size === 1) {
        flyToSettlement(Array.from(state.settlement)[0]);
      }
    }, 100);
  }
  if (typeof update === 'function') update();
}

// Сброс всех фильтров
function resetAllFilters() {
  FILTERS.forEach(f => {
    state[f.key].clear();
  });
  searchQuery = "";
  expanded = {};
  areaRange = { min: AREA_MIN, max: AREA_MAX };
  const searchInput = document.getElementById("searchInput");
  if (searchInput) searchInput.value = "";
  if (typeof update === 'function') update();
}

// Рендер фильтров
function renderFilters() {
  const container = document.getElementById("filtersContainer");
  if (!container) return;
  container.innerHTML = "";

  FILTERS.forEach(cfg => {
    let title = cfg.title;
    if (cfg.key === "soslovie") title = "Сословно-профессиональная группа";
    if (cfg.key === "familyStatus") title = "Семейное положение";
    const cross = getCrossCounts(cfg.key);
    const vals = [];
    const seen = {};
    const hiddenValues = HIDDEN_FILTER_VALUES[cfg.key];
    allData.forEach(d => {
      if (d[cfg.key] && !hiddenValues?.has(d[cfg.key]) && !seen[d[cfg.key]]) {
        seen[d[cfg.key]] = true;
        vals.push(d[cfg.key]);
      }
    });
    vals.sort((a, b) => (cross[b] || 0) - (cross[a] || 0));
    if (!vals.length) return;

    const activeN = state[cfg.key].size;
    const limit = cfg.limit || 999;
    const isExp = expanded[cfg.key];
    const show = isExp ? vals : vals.slice(0, limit);

    const div = document.createElement("div");
    div.className = "filter-section";
    let h = `<div class="filter-title">${title}${activeN ? `<span class="filter-count">${activeN}</span>` : ""}</div>`;
    if (cfg.inline) h += '<div class="filter-row">';

    show.forEach(v => {
      const cnt = cross[v] || 0;
      const isA = state[cfg.key].has(v);
      const dis = cnt === 0 && !isA;
      const color = cfg.key === "soslovie" ? getSoslovieColor({ soslovie: v })
        : cfg.key === "sex" ? getSexColor({ sex: v }) : "";
      const swatch = color ? `<span class="filter-swatch" style="background:${esc(color)}"></span>` : "";
      // Отображаемое значение — без .0 для числовых номеров
      const displayV = formatNum(v) || v;
      h += `<button type="button" class="filter-option${isA ? " active" : ""}${dis ? " disabled" : ""}" data-key="${esc(cfg.key)}" data-val="${esc(v)}" aria-pressed="${isA}"${dis ? " disabled" : ""}>
              <span class="cb" aria-hidden="true">${isA ? "✓" : ""}</span>
              ${swatch}
              <span>${esc(displayV)}</span>
              <span class="fb">${cnt}</span>
            </button>`;
    });

    if (cfg.inline) h += "</div>";
    if (vals.length > limit && !isExp) {
      h += `<button type="button" class="filter-expand" data-key="${esc(cfg.key)}">Ещё ${vals.length - limit} ▾</button>`;
    }
    div.innerHTML = h;
    container.appendChild(div);
    if (cfg.key === "sex") renderAreaFilter(container);
  });

  // Обработчики событий
  container.onclick = function (e) {
    const opt = e.target.closest(".filter-option");
    if (opt) {
      toggle(opt.dataset.key, opt.dataset.val);
      return;
    }
    const exp = e.target.closest(".filter-expand");
    if (exp) {
      expanded[exp.dataset.key] = true;
      if (typeof update === 'function') update();
    }
  };
}

function renderAreaFilter(container) {
  const section = document.createElement("div");
  section.className = "filter-section area-filter";
  section.innerHTML = `<div class="filter-title">Площадь усадьбы <span>саж²</span></div>
    <div class="area-inputs">
      <label><span>От</span><input type="number" inputmode="numeric" min="${AREA_MIN}" max="${AREA_MAX}" step="1" value="${areaRange.min}" data-bound="min" aria-label="Площадь от, квадратных саженей"></label>
      <label><span>До</span><input type="number" inputmode="numeric" min="${AREA_MIN}" max="${AREA_MAX}" step="1" value="${areaRange.max}" data-bound="max" aria-label="Площадь до, квадратных саженей"></label>
    </div>
    <div class="area-range-track" style="--range-start:${areaToPosition(areaRange.min) / 10}%;--range-end:${areaToPosition(areaRange.max) / 10}%">
      <input type="range" min="0" max="1000" value="${areaToPosition(areaRange.min)}" data-bound="min" aria-label="Минимальная площадь усадьбы">
      <input type="range" min="0" max="1000" value="${areaToPosition(areaRange.max)}" data-bound="max" aria-label="Максимальная площадь усадьбы">
    </div>`;
  container.appendChild(section);

  const numbers = section.querySelectorAll('input[type="number"]');
  const sliders = section.querySelectorAll('input[type="range"]');
  const track = section.querySelector(".area-range-track");
  function setBound(bound, value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const bounded = Math.min(AREA_MAX, Math.max(AREA_MIN, Math.round(parsed)));
    areaRange[bound] = bound === "min" ? Math.min(bounded, areaRange.max) : Math.max(bounded, areaRange.min);
    numbers[0].value = areaRange.min;
    numbers[1].value = areaRange.max;
    sliders[0].value = areaToPosition(areaRange.min);
    sliders[1].value = areaToPosition(areaRange.max);
    track.style.setProperty("--range-start", `${areaToPosition(areaRange.min) / 10}%`);
    track.style.setProperty("--range-end", `${areaToPosition(areaRange.max) / 10}%`);
  }
  numbers.forEach(input => input.addEventListener("change", () => {
    setBound(input.dataset.bound, input.value);
    update();
  }));
  sliders.forEach(input => {
    input.addEventListener("input", () => setBound(input.dataset.bound, positionToArea(Number(input.value))));
    input.addEventListener("change", () => update());
  });
}

// Рендер активных тегов
function renderActiveTags() {
  const tags = [];
  FILTERS.forEach(f => {
    state[f.key].forEach(v => {
      tags.push({ key: f.key, val: v });
    });
  });
  if (searchQuery) tags.push({ key: "search", val: searchQuery });
  if (areaRangeActive()) tags.push({ key: "area", val: `${areaRange.min}–${areaRange.max} саж²` });

  const activeBar = document.getElementById("activeBar");
  if (activeBar) {
    activeBar.className = "active-bar" + (tags.length ? " show" : "");
  }

  const container = document.getElementById("activeTags");
  if (!container) return;
  container.innerHTML = "";

  tags.forEach(t => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tag";
    const label = t.key === "search" ? `«${t.val}»` : t.key === "area" ? t.val : (formatNum(t.val) || t.val);
    button.textContent = label + " ×";
    button.setAttribute("aria-label", `Убрать фильтр ${label}`);
    button.onclick = () => {
      if (t.key === "search") {
        clearSearch();
      } else if (t.key === "area") {
        areaRange = { min: AREA_MIN, max: AREA_MAX };
        update();
      } else {
        toggle(t.key, t.val);
      }
    };
    container.appendChild(button);
  });
}
