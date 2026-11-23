import {
  button, el, emptyState, entryChanged, field, fieldChanged, formatNumber, glyph,
  searchBox, selectInput, switchInput, textInput,
} from "./editor-dom.js?v=inline-2";
import { columnLabel } from "./editor-table.js?v=bulk-table";

const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true });

export function movedFilters(rows) {
  const active = rows.filter(entry => !entry.removed && entry.original);
  const originalOrder = active.map(entry => entry.index).toSorted((a, b) => a - b);
  return new Set(active.filter((entry, index) => entry.index !== originalOrder[index]));
}

export function createMapFilterEditor({ getSnapshot, getRows, getArea, getRecords, refreshStatus }) {
  const block = el("section", "editor-map-filters");
  let filterControls = [];

  function updateFieldChoices() {
    const used = new Set(getRows().filter(entry => !entry.removed).map(entry => entry.value.key));
    for (const { entry, select } of filterControls) {
      for (const option of select.options)
        option.disabled = option.value !== entry.value.key && used.has(option.value);
    }
  }

  function filterCard(entry, data, index, moved) {
    const values = entry.value;
    const card = el("article", "editor-filter-card");
    const remove = button(entry.removed ? "Вернуть фильтр" : "Удалить фильтр", () => {
      const rows = getRows();
      if (entry.original) entry.removed = !entry.removed;
      else rows.splice(rows.indexOf(entry), 1);
      render();
      refreshStatus();
    }, { icon: entry.removed ? "undo" : "trash", iconOnly: !entry.removed,
      className: entry.removed ? "" : "editor-quiet editor-danger" });
    card.classList.toggle("is-dirty", entryChanged(entry) || moved);
    if (entry.removed) {
      card.classList.add("is-removed");
      card.append(el("p", "editor-removed-name", values.title), remove);
      return card;
    }
    const header = el("div", "editor-filter-header");
    const tile = el("span", "editor-filter-symbol");
    tile.append(glyph("sliders"));
    const name = textInput("Название фильтра", values.title, {
      className: "editor-filter-name", placeholder: "Название фильтра",
    });
    const titleField = el("label", "editor-inline-title");
    titleField.append(name, glyph("edit"));
    const reorder = el("div", "editor-item-actions");
    for (const [step, label, icon] of [[-1, "Поднять фильтр", "arrowUp"], [1, "Опустить фильтр", "arrowDown"]]) {
      const rows = getRows();
      const adjacent = step < 0
        ? rows.findLastIndex((other, position) => position < index && !other.removed)
        : rows.findIndex((other, position) => position > index && !other.removed);
      const move = button(label, () => {
        [rows[index], rows[adjacent]] = [rows[adjacent], rows[index]];
        render();
        const movedCard = block.children[adjacent];
        movedCard?.querySelector(".editor-filter-name")?.focus({ preventScroll: true });
        refreshStatus();
      }, { icon, iconOnly: true, className: "editor-quiet" });
      move.disabled = adjacent === -1;
      reorder.append(move);
    }
    reorder.append(remove);
    header.append(tile, titleField, reorder);
    const body = el("div", "editor-filter-body");
    const config = el("div", "editor-filter-config");
    const grid = el("div", "editor-filter-field-grid");
    const fields = getSnapshot().site.filterFields.map(key => [key, key === "soslovie" ? "Сословная группа" : columnLabel(key)]);
    const source = selectInput("Поле данных", [["", "Выберите поле"], ...fields], values.key);
    filterControls.push({ entry, select: source });
    const sort = selectInput("Сортировка", [["count", "По числу усадеб"], ["alpha", "По алфавиту"]], values.sort);
    const limit = textInput("Сколько значений видно сразу", values.limit, { type: "number" });
    limit.min = 0;
    limit.max = 1000;
    limit.step = 1;
    const inline = switchInput("Компактный вид", values.inline, value => patch("inline", value, inline, true),
      { hint: "Варианты располагаются в строку" });
    grid.append(field("Поле данных", source), field("Сортировка", sort),
      field("Вариантов до «Ещё»", limit, "0 показывает все значения"), inline);
    config.append(grid);
    const preview = el("div", "editor-filter-preview");
    const previewHead = el("div", "editor-preview-head");
    const previewTitle = el("span", "editor-preview-label", values.title || "Варианты фильтра");
    const tabs = el("div", "editor-segmented editor-preview-tabs");
    const shown = el("div", "editor-filter-values");
    const footer = el("div", "editor-preview-footer");
    let previewMode = "visible", query = "", expanded = false;
    const search = searchBox("Найти значение", "", value => { query = value; drawPreview(); });
    const tabButtons = [
      button("Видимые", () => { previewMode = "visible"; drawPreview(); }, { className: "editor-segment" }),
      button("Скрытые", () => { previewMode = "hidden"; drawPreview(); }, { className: "editor-segment" }),
    ];
    tabs.append(...tabButtons);
    previewHead.append(previewTitle, tabs);
    preview.append(previewHead, search, shown, footer);
    body.append(config, preview);
    card.append(header, body);

    function mark(control, key) {
      control.classList.toggle("is-dirty", Boolean(entry.original && fieldChanged(entry, key)));
    }

    function patch(key, value, control, redraw = false) {
      values[key] = value;
      mark(control, key);
      card.classList.toggle("is-dirty", entryChanged(entry) || moved);
      if (redraw) drawPreview();
      refreshStatus();
    }

    function drawPreview(returnFocus) {
      const counts = new Map();
      for (const record of data) {
        const value = record[values.key];
        if (value) counts.set(String(value), (counts.get(String(value)) || 0) + 1);
      }
      for (const value of values.hiddenValues) if (!counts.has(value)) counts.set(value, 0);
      const hidden = new Set(values.hiddenValues);
      const showHidden = previewMode === "hidden";
      tabButtons[0].querySelector("span").textContent = `Видимые ${counts.size - hidden.size}`;
      tabButtons[1].querySelector("span").textContent = `Скрытые ${hidden.size}`;
      tabButtons[0].setAttribute("aria-pressed", String(!showHidden));
      tabButtons[1].setAttribute("aria-pressed", String(showHidden));
      search.hidden = counts.size <= 8 && !query;
      const matches = [...counts].filter(([value]) =>
        hidden.has(value) === showHidden && EstateTable.normalize(value).includes(EstateTable.normalize(query)));
      matches.sort((a, b) => values.sort === "alpha" ? collator.compare(a[0], b[0]) : b[1] - a[1]);
      const limit = !expanded && !showHidden && !query && Number(values.limit) > 0 ? Number(values.limit) : matches.length;
      shown.classList.toggle("is-compact", Boolean(values.inline));
      shown.replaceChildren();
      footer.replaceChildren();
      for (const [value, count] of matches.slice(0, limit)) {
        const control = button(value, () => {
          if (showHidden) hidden.delete(value);
          else hidden.add(value);
          patch("hiddenValues", [...hidden], preview);
          drawPreview(true);
        }, { icon: showHidden ? "hidden" : "check", className: "editor-value-pill" });
        control.append(el("small", "", formatNumber(count)));
        const action = (showHidden ? "Показать: " : "Скрыть: ") + value;
        control.title = action;
        control.setAttribute("aria-label", action);
        shown.append(control);
      }
      if (!matches.length) {
        shown.append(emptyState(!values.key ? "Выберите поле данных." :
          query ? "Значения не найдены." : showHidden ? "Скрытых значений нет." : "Нет видимых значений."));
      }
      if (limit < matches.length)
        footer.append(button(`Ещё ${formatNumber(matches.length - limit)}`, () => { expanded = true; drawPreview(true); },
          { icon: "chevron", className: "editor-quiet" }));
      if (returnFocus) (shown.querySelector("button") || tabButtons[showHidden ? 1 : 0]).focus({ preventScroll: true });
    }

    for (const [key, control] of [["key", source], ["title", name], ["sort", sort], ["limit", limit], ["inline", inline], ["hiddenValues", preview]])
      mark(control, key);
    name.oninput = () => {
      previewTitle.textContent = name.value || "Варианты фильтра";
      patch("title", name.value, name);
    };
    source.onchange = () => {
      if (!values.title.trim() && source.value) {
        name.value = columnLabel(source.value);
        name.oninput();
      }
      patch("key", source.value, source);
      updateFieldChoices();
      expanded = false;
      drawPreview();
    };
    sort.onchange = () => patch("sort", sort.value, sort, true);
    limit.oninput = () => {
      expanded = false;
      patch("limit", limit.value === "" ? 0 : Number(limit.value), limit, true);
    };
    drawPreview();
    return card;
  }

  function areaCard(data) {
    const entry = getArea();
    const card = el("article", "editor-filter-card editor-area-card");
    const header = el("div", "editor-filter-header");
    const tile = el("span", "editor-filter-symbol");
    tile.append(createGlossaryIcon("ruler"));
    const name = textInput("Название фильтра площади", entry.value.title,
      { className: "editor-filter-name", placeholder: "Название фильтра площади" });
    const titleField = el("label", "editor-inline-title");
    titleField.append(name, glyph("edit"));
    header.append(tile, titleField);
    const summary = el("div", "editor-area-summary");
    const display = el("span");
    summary.append(glyph("sliders"), display);
    const toggle = switchInput("Показывать на карте", entry.value.enabled, value => {
      entry.value.enabled = value;
      sync();
      refreshStatus();
    });
    const stats = data.reduce((bounds, record) => {
      const value = EstateTable.number(record.area_sazh);
      if (value != null && value > 0) {
        bounds.min = Math.min(bounds.min, value);
        bounds.max = Math.max(bounds.max, value);
      }
      return bounds;
    }, { min: Infinity, max: -Infinity });
    display.textContent = Number.isFinite(stats.min)
      ? `${formatNumber(Math.floor(stats.min))}–${formatNumber(Math.ceil(stats.max))} саж²` : "Диапазон площади · саж²";
    const body = el("div", "editor-area-body");
    body.append(toggle, summary);
    card.append(header, body);
    function sync() {
      card.classList.toggle("is-dirty", entryChanged(entry));
      name.classList.toggle("is-dirty", fieldChanged(entry, "title"));
      toggle.classList.toggle("is-dirty", fieldChanged(entry, "enabled"));
      summary.classList.toggle("is-off", !entry.value.enabled);
    }
    name.oninput = () => {
      entry.value.title = name.value;
      sync();
      refreshStatus();
    };
    sync();
    return card;
  }

  function render() {
    const entries = getRows();
    const moved = movedFilters(entries);
    const data = getRecords();
    filterControls = [];
    const cards = entries.map((entry, index) => filterCard(entry, data, index, moved.has(entry)));
    block.replaceChildren(...cards, areaCard(data));
    updateFieldChoices();
  }

  return {
    block, render,
    focusNew() {
      const input = block.querySelector(".editor-filter-name");
      input?.scrollIntoView({ block: "nearest" });
      input?.focus({ preventScroll: true });
    },
  };
}
