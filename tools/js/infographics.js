// Инфографика
//
// Все цифры считаются из allData на лету, поэтому после обновления данных
// (новые усадьбы, сканы, правки) инфографика пересчитывается сама.
// Фильтры общие с картой (state из filters.js): щелчок по строке диаграммы
// ставит тот же фильтр, что и в боковой панели карты, и наоборот.
// Каждая диаграмма строится по выборке без учёта собственного измерения
// (как счётчики в боковой панели), выбранные значения подсвечиваются.

const INFO_NO_DATA = "Нет данных";
let infoFactIndex = 0;
let infoExpanded = {};

function infoSubset(exceptKey) {
  return allData.filter(item => {
    if (searchQuery && !matchesSearch(item, searchQuery)) return false;
    if (typeof matchesArea === "function" && !matchesArea(item)) return false;
    for (let i = 0; i < FILTERS.length; i++) {
      const f = FILTERS[i];
      if (f.key !== exceptKey && state[f.key].size > 0 && !state[f.key].has(item[f.key])) return false;
    }
    return true;
  });
}

function infoGroup(rows, key) {
  const groups = new Map();
  rows.forEach(d => {
    const k = d[key] || "";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(d);
  });
  return groups;
}

function infoMedian(values) {
  const arr = values.slice().sort((a, b) => a - b);
  if (!arr.length) return 0;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

const infoFmt = n => Math.round(n).toLocaleString("ru-RU");
const infoPct = n => (n >= 10 ? Math.round(n) : n.toFixed(1).replace(".", ",")) + "%";

// rows: [{value, label, amount, text, hint}]
// Самая длинная полоса занимает 80% дорожки, чтобы подпись справа не ложилась на неё.
function infoBarCard(opts) {
  const { title, sub, key, rows, color, limit = 10, wide = false } = opts;
  const active = key ? state[key] : null;
  const anyActive = active && active.size > 0;
  const expanded = infoExpanded[opts.id];
  const shown = expanded ? rows : rows.slice(0, limit);
  const max = Math.max(1, ...rows.map(r => r.amount));
  let h = `<div class="info-card${wide ? " info-card-wide" : ""}"><h3>${title}</h3>`;
  if (sub) h += `<div class="info-sub">${sub}</div>`;
  if (!rows.length) return h + `<div class="info-empty">В выборке нет данных для этой диаграммы</div></div>`;
  if (wide) h += `<div class="median-bars">`;
  shown.forEach(r => {
    const clickable = key && r.value;
    const isA = clickable && active.has(r.value);
    const cls = "bar-row" + (clickable ? " is-clickable" : "") + (isA ? " is-active" : "") + (anyActive && !isA ? " is-dim" : "");
    const attrs = clickable
      ? ` role="button" tabindex="0" aria-pressed="${isA}" data-key="${esc(key)}" data-val="${esc(r.value)}" title="${isA ? "Убрать фильтр" : "Показать только"}: ${esc(r.label)}"`
      : "";
    h += `<div class="${cls}"${attrs}>
            <div class="bar-label">${esc(r.label)}${r.hint ? `<span class="bar-hint">${esc(r.hint)}</span>` : ""}</div>
            <div class="bar-track">
              <div class="bar-fill" style="width:${Math.max(0.6, r.amount / max * 80).toFixed(1)}%;background:${color}"></div>
              <div class="bar-val">${esc(r.text)}</div>
            </div>
          </div>`;
  });
  if (wide) h += `</div>`;
  if (rows.length > limit) {
    h += `<button type="button" class="info-more" data-more="${esc(opts.id)}">${expanded ? "Свернуть ▴" : `Ещё ${rows.length - limit} ▾`}</button>`;
  }
  return h + `</div>`;
}

function infoLabel(v) { return v || INFO_NO_DATA; }

function infoSosloviyeRows(rows, measure) {
  const groups = infoGroup(rows, "soslovie");
  const out = [];
  groups.forEach((list, k) => {
    const areas = list.map(d => d.area_sazh).filter(a => a > 0);
    out.push({ value: k === INFO_NO_DATA ? "" : k, label: infoLabel(k), list, areas });
  });
  // «Нет данных» и пустое значение - одна строка
  const empty = out.filter(r => !r.value);
  if (empty.length > 1) {
    const merged = { value: "", label: INFO_NO_DATA, list: [], areas: [] };
    empty.forEach(r => { merged.list.push(...r.list); merged.areas.push(...r.areas); });
    out.splice(0, out.length, ...out.filter(r => r.value), merged);
  }
  return measure(out);
}

function computeFacts(rows) {
  const facts = [];
  const withArea = rows.filter(d => d.area_sazh > 0);
  const who = d => [d.surname, d.name].filter(Boolean).join(" ") || "владелец не указан";
  const where = d => `усадьба №${esc(String(d.num).replace(/\.0$/, ""))}, ${esc(d.settlement)}`;
  const byArea = (list, pick) => list.reduce((a, b) => (pick(b.area_sazh, a.area_sazh) ? b : a));
  if (withArea.length) {
    const big = byArea(withArea, (x, y) => x > y), small = byArea(withArea, (x, y) => x < y);
    facts.push({ n: infoFmt(big.area_sazh) + " саж²", t: "Самый большой участок", d: `${esc(who(big))}, ${where(big)}` });
    facts.push({ n: infoFmt(small.area_sazh) + " саж²", t: "Самый маленький участок", d: `${esc(who(small))}, ${where(small)}` });
    const women = withArea.filter(d => d.sex === "Женщины");
    if (women.length > 1) {
      const wb = byArea(women, (x, y) => x > y), ws = byArea(women, (x, y) => x < y);
      facts.push({ n: infoFmt(wb.area_sazh) + " саж²", t: "Самый большой участок среди женщин", d: `${esc(who(wb))}, ${where(wb)}` });
      facts.push({ n: infoFmt(ws.area_sazh) + " саж²", t: "Самый маленький участок среди женщин", d: `${esc(who(ws))}, ${where(ws)}` });
    }
  }
  const top = (list, key) => {
    const c = {};
    list.forEach(d => { if (d[key]) c[d[key]] = (c[d[key]] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  };
  const male = top(rows.filter(d => d.sex === "Мужчины"), "name")[0];
  if (male && male[1] > 1) facts.push({ n: esc(male[0]), t: "Самое распространённое мужское имя", d: `${infoFmt(male[1])} владельцев усадеб` });
  const female = top(rows.filter(d => d.sex === "Женщины"), "name")[0];
  if (female && female[1] > 1) facts.push({ n: esc(female[0]), t: "Самое распространённое женское имя", d: `${infoFmt(female[1])} владелиц усадеб` });
  const street = top(rows, "street")[0];
  if (street && street[1] > 1) facts.push({ n: infoFmt(street[1]), t: "Улица с наибольшим числом усадеб", d: esc(street[0]) });
  const surname = top(rows, "surname")[0];
  if (surname && surname[1] > 1) facts.push({ n: esc(surname[0]), t: "Самая частая фамилия", d: `${infoFmt(surname[1])} усадеб с этой фамилией` });
  const groups = top(rows.filter(d => d.soslovie && d.soslovie !== INFO_NO_DATA), "soslovie");
  if (groups.length > 2) {
    const minCount = groups[groups.length - 1][1];
    const rare = groups.filter(g => g[1] === minCount).map(g => g[0]);
    facts.push({ n: infoFmt(minCount), t: "Самая немногочисленная группа", d: `${esc(rare.join(", "))} - по ${infoFmt(minCount)} ${minCount === 1 ? "усадьбе" : "усадьбы"}` });
  }
  return facts;
}

function renderInfoControls(filteredCount) {
  const grid = document.getElementById("infoGrid");
  if (!grid) return;
  let box = document.getElementById("infoControls");
  if (!box) {
    box = document.createElement("div");
    box.id = "infoControls";
    box.className = "info-controls";
    grid.parentNode.insertBefore(box, grid);
    box.addEventListener("click", onInfoClick);
  }
  const chips = (key, values) => {
    const all = state[key].size === 0;
    let h = `<button type="button" class="info-chip${all ? " active" : ""}" data-clear="${key}" aria-pressed="${all}">Все</button>`;
    values.forEach(v => {
      const on = state[key].has(v);
      h += `<button type="button" class="info-chip${on ? " active" : ""}" data-key="${key}" data-val="${esc(v)}" aria-pressed="${on}">${esc(v)}</button>`;
    });
    return h;
  };
  const settlements = [...new Set(allData.map(d => d.settlement))];
  const sexes = [...new Set(allData.map(d => d.sex).filter(Boolean))];
  const tags = [];
  FILTERS.forEach(f => {
    if (f.key === "settlement" || f.key === "sex") return;
    state[f.key].forEach(v => tags.push(`<button type="button" class="tag" data-key="${esc(f.key)}" data-val="${esc(v)}">${esc(v || INFO_NO_DATA)} ×</button>`));
  });
  const areaOn = typeof areaRangeActive === "function" && areaRangeActive();
  if (areaOn) tags.push(`<button type="button" class="tag" data-area="1">Площадь ${infoFmt(areaRange.min)}-${infoFmt(areaRange.max)} саж² ×</button>`);
  if (searchQuery) tags.push(`<button type="button" class="tag" data-search="1">«${esc(searchQuery)}» ×</button>`);
  const anyFilter = FILTERS.some(f => state[f.key].size) || searchQuery || areaOn;

  box.innerHTML = `
    <div class="info-controls-row"><span class="info-controls-lbl">Поселение</span>${chips("settlement", settlements)}</div>
    <div class="info-controls-row"><span class="info-controls-lbl">Пол</span>${chips("sex", sexes)}</div>
    ${tags.length ? `<div class="info-controls-row"><span class="info-controls-lbl">Ещё фильтры</span>${tags.join("")}</div>` : ""}
    <div class="info-controls-foot">
      <span>В выборке <b>${infoFmt(filteredCount)}</b> из ${infoFmt(allData.length)} усадеб.
        <span class="info-controls-hint">Щелчок по строке диаграммы - фильтр для всех графиков и карты.</span></span>
      <span class="info-controls-actions">
        ${anyFilter ? `<button type="button" class="info-link" data-reset="1">Сбросить</button>` : ""}
        <button type="button" class="info-go" data-gomap="1">Показать на карте →</button>
      </span>
    </div>`;
}

function onInfoClick(e) {
  const el = e.target.closest("[data-key],[data-clear],[data-reset],[data-gomap],[data-search],[data-area],[data-more],[data-fact]");
  if (!el) return;
  if (el.dataset.more) {
    infoExpanded[el.dataset.more] = !infoExpanded[el.dataset.more];
    renderInfographics();
  } else if (el.dataset.fact) {
    const n = Number(el.dataset.fact);
    if (n > 1) {
      let next = infoFactIndex;
      while (next === infoFactIndex) next = Math.floor(Math.random() * n);
      infoFactIndex = next;
    }
    renderInfographics();
  } else if (el.dataset.clear) {
    state[el.dataset.clear].clear();
    update();
  } else if (el.dataset.reset) {
    resetAllFilters();
  } else if (el.dataset.search) {
    clearSearch();
  } else if (el.dataset.area) {
    areaRange = { min: AREA_MIN, max: AREA_MAX };
    update();
  } else if (el.dataset.gomap) {
    const nav = document.querySelector('.nav-items .nav-item[data-page="map"]');
    if (nav) nav.click();
    setTimeout(() => { if (typeof fitToEstates === "function") fitToEstates(16, true); }, 150);
  } else if (el.dataset.key) {
    toggle(el.dataset.key, el.dataset.val);
  }
}

function renderInfographics() {
  const grid = document.getElementById("infoGrid");
  if (!grid) return;
  if (!grid.dataset.bound) {
    grid.dataset.bound = "1";
    grid.addEventListener("click", onInfoClick);
    grid.addEventListener("keydown", e => {
      if ((e.key === "Enter" || e.key === " ") && e.target.matches(".bar-row.is-clickable")) {
        e.preventDefault();
        onInfoClick(e);
      }
    });
  }

  const filtered = infoSubset(null);
  renderInfoControls(filtered.length);

  // 1. Владельцы по сословно-профессиональным группам
  const bySoslCount = infoSosloviyeRows(infoSubset("soslovie"), groups =>
    groups.map(g => ({ value: g.value, label: g.label, amount: g.list.length, text: infoFmt(g.list.length) }))
          .sort((a, b) => b.amount - a.amount));
  const c1 = infoBarCard({ id: "sosl", title: "Владельцы усадеб по сословно-профессиональным группам", key: "soslovie", rows: bySoslCount, color: "var(--accent)" });

  // 2. Доля земли
  const landRows = infoSosloviyeRows(infoSubset("soslovie"), groups => {
    const total = groups.reduce((s, g) => s + g.areas.reduce((a, b) => a + b, 0), 0) || 1;
    return groups.map(g => {
      const sum = g.areas.reduce((a, b) => a + b, 0);
      return { value: g.value, label: g.label, amount: sum, text: `${infoPct(sum / total * 100)} · ${infoFmt(sum)} саж²` };
    }).filter(r => r.amount > 0).sort((a, b) => b.amount - a.amount);
  });
  const c2 = infoBarCard({ id: "land", title: "Доля земли по сословно-профессиональным группам", key: "soslovie", rows: landRows, color: "var(--ekb)" });

  // 3-4. Средний и медианный размер (группы от 3 участков - меньше шумно)
  const sizeRows = (fn, label) => infoSosloviyeRows(infoSubset("soslovie"), groups =>
    groups.filter(g => g.areas.length >= 3)
          .map(g => { const v = fn(g.areas); return { value: g.value, label: g.label, amount: v, text: `${infoFmt(v)} саж²`, hint: ` · ${g.areas.length} уч.` }; })
          .sort((a, b) => b.amount - a.amount));
  const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
  const c3 = infoBarCard({ id: "mean", title: "Средний размер усадьбы по группам", sub: "Группы, где не меньше трёх участков с известной площадью", key: "soslovie", rows: sizeRows(mean), color: "var(--accent)" });
  const c4 = infoBarCard({ id: "median", title: "Медианный размер усадьбы по группам", sub: "Медиана меньше зависит от единичных очень больших участков", key: "soslovie", rows: sizeRows(infoMedian), color: "var(--ukt)", wide: true, limit: 20 });

  // 5. Тип строений
  const btRows = [...infoGroup(infoSubset("buildingType"), "buildingType")]
    .map(([k, list]) => ({ value: k, label: infoLabel(k), amount: list.length, text: infoFmt(list.length) }))
    .sort((a, b) => b.amount - a.amount);
  const c5 = infoBarCard({ id: "bt", title: "Распределение усадеб по составу строений", key: "buildingType", rows: btRows, color: "var(--niz)", limit: 8 });

  // 6. Места службы
  const spRows = [...infoGroup(infoSubset("servicePlace").filter(d => d.servicePlace && !HIDDEN_FILTER_VALUES.servicePlace?.has(d.servicePlace)), "servicePlace")]
    .map(([k, list]) => ({ value: k, label: k, amount: list.length, text: infoFmt(list.length) }))
    .sort((a, b) => b.amount - a.amount);
  const c6 = infoBarCard({ id: "sp", title: "Места службы владельцев усадеб", sub: "Только записи, где место службы указано", key: "servicePlace", rows: spRows, color: "var(--accent)", limit: 8 });

  // 7. Случайный факт - по текущей выборке
  const facts = computeFacts(filtered);
  if (infoFactIndex >= facts.length) infoFactIndex = 0;
  const f = facts[infoFactIndex];
  const c7 = `<div class="info-card"><h3>Случайный факт</h3>` + (f
    ? `<div class="fact-box">
         <div class="fact-num">${f.n}</div>
         <div class="fact-title">${f.t}</div>
         <div class="fact-desc">${f.d}</div>
       </div>
       ${facts.length > 1 ? `<button type="button" class="fact-btn" data-fact="${facts.length}">Ещё факт →</button>` : ""}`
    : `<div class="info-empty">В выборке слишком мало усадеб для фактов</div>`) + `</div>`;

  // 8. Структура поселений
  const setRows = infoSubset("settlement");
  const colors = { "Екатеринбург": "var(--ekb)", "Нижне-Исетск": "var(--niz)", "Уктус": "var(--ukt)" };
  const setCounts = {};
  setRows.forEach(d => { setCounts[d.settlement] = (setCounts[d.settlement] || 0) + 1; });
  const maxSet = Math.max(1, ...Object.values(setCounts));
  const anySet = state.settlement.size > 0;
  let c8 = `<div class="info-card"><h3>Структура поселений</h3><div class="settlement-bubbles">`;
  Object.keys(colors).forEach(name => {
    const n = setCounts[name] || 0;
    const d = n ? Math.max(14, Math.round(Math.sqrt(n / maxSet) * 96)) : 0;
    const on = state.settlement.has(name);
    c8 += `<div class="settlement-bubble bar-row is-clickable${on ? " is-active" : ""}${anySet && !on ? " is-dim" : ""}" role="button" tabindex="0" aria-pressed="${on}" data-key="settlement" data-val="${esc(name)}">
             <div class="settlement-circle" style="width:${d}px;height:${d}px;background:${colors[name]};border-color:${colors[name]}"></div>
             <div style="font-weight:700;font-size:14px">${infoFmt(n)}</div>
             <div style="font-size:11px;color:var(--body)">${name}</div>
           </div>`;
  });
  c8 += `</div><div class="info-sub" style="margin-top:12px">Площадь круга пропорциональна числу усадеб</div></div>`;

  grid.innerHTML = c7 + c8 + c1 + c2 + c3 + c5 + c6 + c4;

  // Итоговая строка - по текущей выборке
  const statRow = document.getElementById("statRow");
  if (statRow) {
    const uniq = key => new Set(filtered.map(d => d[key]).filter(v => v && v !== INFO_NO_DATA)).size;
    statRow.innerHTML = [
      [infoFmt(filtered.length), "усадеб"],
      [uniq("street"), "улиц"],
      [uniq("soslovie"), "групп"],
      [uniq("settlement"), "поселения"],
      ["1809", "год"]
    ].filter(r => r[0] !== 0).map(r => `<div><div class="stat-num">${r[0]}</div><div class="stat-lbl">${r[1]}</div></div>`).join("");
  }
}
