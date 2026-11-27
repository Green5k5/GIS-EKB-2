import { button, el, field, formatNumber, glyph, searchBox, selectInput, textInput } from "./editor-dom.js?v=inline-2";

export const jsonRecordFields = ["extra", "sourceData"];
export const numericRecordFields = ["area_sazh", "lat", "lng"];
const extraColumns = [
  ["rankClass", "Ранг согласно табели", true],
  ["spouseSurname", "Фамилия супруга"],
  ["spouseName", "Имя супруга"],
  ["spousePatronymic", "Отчество супруга"],
  ["nobility", "Дворянство"],
  ["serviceStatus", "Статус мужчины"],
  ["awards", "Сведения о награждениях"],
  ["institutionType", "Род институции"],
  ["institutionName", "Название институции"],
  ["arshin", "Аршин"],
  ["quarter", "Четверть"],
].map(([key, label, visible = false]) => ({ key, label, visible, numeric: false }));
const sourceRowColumn = { key: "sourceRowNumber", label: "Порядковый номер строки в таблице", numeric: false };
const columns = EstateTable.columns.flatMap(column => column.key === "rank" ? [column, extraColumns[0]] : [column])
  .concat(extraColumns.slice(1), sourceRowColumn);
const columnsByKey = new Map(columns.map(column => [column.key, column]));
const extraByKey = new Map(extraColumns.map(column => [column.key, column.label]));
const headerKey = label => EstateTable.normalize(label).replace(/\s+/g, " ")
  .replace(/ \((?:если указано|действующий \/ отставной)\)$/, "");
const rowPageSize = 100;
const facetBatchSize = 100;

function draftObject(value, original) {
  if (typeof value !== "string") return value ?? original;
  try {
    return JSON.parse(value) || {};
  } catch {
    return original;
  }
}

export function withExtraColumns(record, draft) {
  const sourceData = draftObject(draft?.sourceData, record.sourceData);
  const extraData = draftObject(draft?.extra, record.extra);
  const source = new Map(Object.entries(sourceData || {}).map(([label, value]) => [headerKey(label), value]));
  const extra = new Map(Object.entries(extraData || {}).map(([label, value]) => [headerKey(label), value]));
  const fields = Object.fromEntries(extraColumns.map(({ key, label }) => {
    const header = headerKey(label);
    return [key, extra.get(header) ?? source.get(header) ?? ""];
  }));
  return { ...record, ...fields, sourceRowNumber: source.get(headerKey(sourceRowColumn.label)) ?? "", ...draft };
}

export function mergeExtraColumnEdits(changes, originalExtra) {
  let extra;
  for (const [key, value] of Object.entries(changes)) {
    const label = extraByKey.get(key);
    if (!label) continue;
    extra ??= { ...(changes.extra ?? originalExtra) };
    const header = headerKey(label);
    const aliases = Object.keys(extra).filter(existing => headerKey(existing) === header);
    const storedLabel = aliases[0] ?? label;
    for (const alias of aliases) delete extra[alias];
    // An empty override also clears a value present in the original workbook data.
    extra[storedLabel] = value;
    delete changes[key];
  }
  if (extra) changes.extra = extra;
  return changes;
}

export const columnLabel = key => columnsByKey.get(key)?.label || key;
export const isExtraColumn = key => extraByKey.has(key);
export const recordFieldLabel = key => key === "settlementId" ? "Поселение" : columnLabel(key);

export function recordFieldText(key, value) {
  if (jsonRecordFields.includes(key) && typeof value !== "string") return JSON.stringify(value ?? {}, null, 2);
  return String(value ?? "");
}

const defaultColumns = () => new Set(columns.filter(column => column.visible).map(column => column.key));

function columnFields(key) {
  if (key === "id" || key === sourceRowColumn.key) return [];
  if (key === "owner") return ["surname", "name", "patronymic"];
  return [key === "settlement" ? "settlementId" : key];
}

function cellText(record, column) {
  const { key, numeric } = column;
  const value = jsonRecordFields.includes(key) && typeof record[key] === "string"
    ? record[key] : EstateTable.value(record, key);
  if (numeric) {
    const number = EstateTable.number(value);
    return number == null ? "—" : formatNumber(number);
  }
  return key === "scanUrl" && value ? "Ссылка на скан" : String(value ?? "") || "—";
}

export function createEstateEditor({ getSnapshot, getRecords, getRecord, getChanges, changeRecord, changeRecords, openRecord }) {
  let query = "", city = "", sort = null, filterColumn = null, activeCell, searchTimer;
  let page = 0, rows = [], recordCount = 0;
  let visibleColumns = defaultColumns();
  const filters = new Map();
  const block = el("section", "estate-table-section editor-table");
  const toolbar = el("div", "editor-table-toolbar");
  const cities = el("div", "table-city-tabs");
  const filterBar = el("div", "editor-table-filterbar");
  const facetsPanel = el("div", "editor-facets");
  const picker = el("details", "table-columns editor-columns");
  const pickerLabel = el("summary");
  const choices = el("div");
  choices.id = "tableColumnChoices";
  picker.append(pickerLabel, choices);
  const search = searchBox("Поиск по усадьбам", "", value => {
    query = value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { if (block.isConnected) draw(); }, 120);
  });
  const replacePanel = el("div", "editor-replace");
  replacePanel.id = "editor-replace";
  replacePanel.hidden = true;
  const find = textInput("Найти в ячейках", "", { type: "search", placeholder: "Текст или значение" });
  const replacement = textInput("Заменить на", "", { placeholder: "Пустое поле удалит найденное" });
  const columnPicker = selectInput("Где искать", [], "");
  const scopePicker = selectInput("Охват замены", [["all", "Весь реестр"], ["selection", "Текущая выборка"]], "all");
  const whole = el("input");
  const matchCase = el("input");
  whole.type = matchCase.type = "checkbox";
  whole.checked = true;
  const wholeLabel = el("label");
  wholeLabel.append(whole, " Ячейка целиком");
  const caseLabel = el("label");
  caseLabel.append(matchCase, " Учитывать регистр");
  const replaceToggle = button("Найти и заменить", () => {
    if (replacePanel.hidden) openReplacement();
    else closeReplacement();
  }, { icon: "search" });
  replaceToggle.setAttribute("aria-expanded", "false");
  replaceToggle.setAttribute("aria-controls", replacePanel.id);
  const replaceHeader = el("div", "editor-replace-header");
  replaceHeader.append(el("strong", "", "Найти и заменить"),
    button("Закрыть поиск и замену", closeReplacement, { icon: "close", iconOnly: true, className: "editor-quiet" }));
  const replaceFields = el("div", "editor-replace-fields");
  replaceFields.append(field("Найти", find), field("Заменить на", replacement),
    field("Столбец", columnPicker), field("Усадьбы", scopePicker));
  const replaceOptions = el("div", "editor-replace-options");
  replaceOptions.append(wholeLabel, caseLabel);
  const replaceSummary = el("p", "editor-replace-summary");
  replaceSummary.setAttribute("role", "status");
  const replaceExamples = el("ul", "editor-replace-examples");
  const replaceResult = el("p", "editor-replace-result");
  replaceResult.setAttribute("role", "status");
  const replaceAll = button("Заменить всё", applyReplacement, { className: "editor-primary" });
  const replaceFooter = el("div", "editor-replace-footer");
  replaceFooter.append(replaceSummary, replaceAll);
  replacePanel.append(replaceHeader, replaceFields, replaceOptions, replaceExamples, replaceFooter, replaceResult);
  for (const input of [find, replacement, columnPicker, scopePicker, whole, matchCase]) input.oninput = () => {
    replaceResult.textContent = "";
    previewReplacement();
  };
  replacePanel.onkeydown = event => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    closeReplacement();
  };
  toolbar.append(search, cities, picker, replaceToggle);
  const wrap = el("div", "ds-table-wrap");
  wrap.tabIndex = 0;
  wrap.setAttribute("aria-label", "Редактируемая таблица усадеб");
  const table = el("table", "ds-table");
  table.id = "dsTable";
  const head = table.createTHead();
  const body = table.createTBody();
  body.onclick = event => {
    const control = event.target.closest(".editor-cell, .editor-map-link");
    if (!control) return;
    const cell = control.closest("td");
    const id = Number(cell.parentElement.dataset.recordId);
    if (control.classList.contains("editor-map-link")) {
      openRecord(id);
      return;
    }
    const column = columnsByKey.get(cell.dataset.column);
    startCell(cell, getRecord(id), column, columnFields(column.key));
  };
  wrap.append(table);
  const range = el("p", "editor-table-count");
  range.setAttribute("role", "status");
  const pagination = el("div", "editor-table-pagination");
  const previous = button("Предыдущая страница", () => changePage(-1), { icon: "left", iconOnly: true });
  const next = button("Следующая страница", () => changePage(1), { icon: "right", iconOnly: true });
  pagination.append(range, previous, next);
  block.append(toolbar, replacePanel, filterBar, facetsPanel, wrap, pagination);

  const selection = () => ({ scope: null, query, city, sort, filters, columns });
  const replaceColumns = columns.filter(column => columnFields(column.key).length === 1);
  const replaceFieldsByColumn = replaceColumns.map(column => [columnFields(column.key)[0], column.label]);
  const textKeys = replaceFieldsByColumn.map(([key]) => key)
    .filter(key => key !== "settlementId" && !numericRecordFields.includes(key) && !jsonRecordFields.includes(key));
  for (const [key, label] of [["", "Все текстовые столбцы"], ...replaceFieldsByColumn])
    columnPicker.add(new Option(label, key));

  function openReplacement() {
    finishCell();
    replacePanel.hidden = false;
    replaceToggle.setAttribute("aria-expanded", "true");
    previewReplacement();
    find.focus();
  }

  function closeReplacement() {
    replacePanel.hidden = true;
    replaceToggle.setAttribute("aria-expanded", "false");
    replaceToggle.focus();
  }

  function replacementPlan(records, rows) {
    const edits = [], examples = [];
    let cells = 0;
    if (!find.value.trim()) return { edits, examples, cells };
    const escaped = find.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const key = columnPicker.value;
    const exact = whole.checked || key === "settlementId";
    const pattern = new RegExp(exact ? "^" + escaped + "$" : escaped, matchCase.checked ? (exact ? "u" : "gu") : (exact ? "iu" : "giu"));
    const searchRows = scopePicker.value === "selection" ? rows : records;
    const keys = key ? [key] : textKeys;
    for (const record of searchRows) {
      const changes = {};
      for (const key of keys) {
        const before = key === "settlementId" ? String(record.settlement ?? "") : recordFieldText(key, record[key]);
        if (exact && pattern.exec(before)?.[0] !== before) continue;
        const after = before.replace(pattern, () => replacement.value);
        if (after === before) continue;
        const invalid = validateReplacement(key, after, record);
        if (invalid) return { error: `Усадьба № ${record.num}. ${invalid}` };
        const value = key === "settlementId"
          ? getSnapshot().settlements.find(item => [item.name, item.id].some(name => name.toLocaleLowerCase("ru") === after.trim().toLocaleLowerCase("ru"))).id
          : after;
        if (value === recordFieldText(key, record[key])) continue;
        changes[key] = value;
        cells++;
        if (examples.length < 3 && !examples.some(item => item.key === key && item.before === before && item.after === after))
          examples.push({ key, before, after });
      }
      if (Object.keys(changes).length) edits.push({ id: record.id, changes });
    }
    return { edits, examples, cells };
  }

  function validateReplacement(key, value, record) {
    if (key === "num" && !value.trim()) return "Номер усадьбы должен быть заполнен.";
    if (key === "settlementId" && !getSnapshot().settlements.some(item =>
      [item.name, item.id].some(name => name.toLocaleLowerCase("ru") === value.trim().toLocaleLowerCase("ru"))))
      return "В поле «Заменить на» укажите название существующего поселения.";
    if (jsonRecordFields.includes(key)) {
      try {
        const parsed = JSON.parse(value.trim() || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      } catch {
        return `После замены в поле «${recordFieldLabel(key)}» должен остаться корректный JSON-объект.`;
      }
    }
    if (numericRecordFields.includes(key)) {
      const number = EstateTable.number(value);
      const max = key === "lat" ? 90 : key === "lng" ? 180 : Infinity;
      const other = key === "lat" ? record.lng : record.lat;
      if ((value.trim() && (number == null || Math.abs(number) > max || (key === "area_sazh" && number < 0))) ||
          (key !== "area_sazh" && ((number == null) !== (EstateTable.number(other) == null))))
        return `Проверьте значение в поле «${recordFieldLabel(key)}».`;
    }
  }

  function previewReplacement(records = getRecords(), rows) {
    wholeLabel.hidden = columnPicker.value === "settlementId";
    const selectedRows = scopePicker.value === "selection" ? rows ?? EstateTable.select(records, selection()) : records;
    const plan = replacementPlan(records, selectedRows);
    replaceAll.disabled = !plan.cells;
    replaceSummary.classList.toggle("is-error", Boolean(plan.error));
    replaceSummary.textContent = plan.error || (!find.value.trim() ? "Введите значение для поиска."
      : plan.cells ? `Ячеек к изменению: ${formatNumber(plan.cells)} · Усадеб: ${formatNumber(plan.edits.length)}`
      : "По этим условиям замен нет.");
    replaceExamples.replaceChildren();
    for (const { key, before, after } of plan.examples || []) {
      const line = el("li");
      line.append(el("strong", "", recordFieldLabel(key)), el("del", "", before.slice(0, 100)),
        el("span", "", "→"), el("ins", "", after.slice(0, 100) || "(пусто)"));
      replaceExamples.append(line);
    }
    return plan;
  }

  function applyReplacement() {
    finishCell();
    const plan = previewReplacement();
    if (!plan.cells) return;
    changeRecords(plan.edits);
    draw(true);
    replaceResult.textContent = `Изменено в черновике: ${formatNumber(plan.cells)} ячеек. Нажмите «Сохранить», чтобы записать правки.`;
  }

  function updateToolbar() {
    const settlements = getSnapshot().settlements;
    if (!settlements.some(item => item.name === city)) city = "";
    cities.replaceChildren();
    for (const name of ["", ...settlements.map(item => item.name)]) {
      const filter = button(name || "Все поселения", () => {
        city = name;
        for (const item of cities.children) {
          const selected = item === filter;
          item.classList.toggle("active", selected);
          item.setAttribute("aria-pressed", String(selected));
        }
        draw();
      }, { className: name === city ? "active" : "" });
      filter.setAttribute("aria-pressed", String(name === city));
      cities.append(filter);
    }
    pickerLabel.replaceChildren(glyph("table"), el("span", "", "Столбцы · " + visibleColumns.size), glyph("chevron"));
    choices.replaceChildren();
    for (const column of columns) {
      const input = el("input");
      input.type = "checkbox";
      input.checked = visibleColumns.has(column.key);
      input.disabled = column.key === "num";
      input.onchange = () => {
        if (input.checked) visibleColumns.add(column.key);
        else {
          visibleColumns.delete(column.key);
          if (filterColumn === column.key) filterColumn = null;
        }
        pickerLabel.querySelector("span").textContent = "Столбцы · " + visibleColumns.size;
        draw(true);
      };
      const label = el("label");
      label.append(input, column.label);
      choices.append(label);
    }
  }

  function renderFacets(records, state) {
    facetsPanel.replaceChildren();
    const key = filterColumn;
    facetsPanel.hidden = !key;
    if (!key) return;
    const header = el("div", "editor-facets-header");
    const label = columnLabel(key);
    const close = () => {
      filterColumn = null;
      updateFacetPanel();
      head.querySelector(`[data-filter-column="${key}"]`)?.focus();
    };
    header.append(el("strong", "", label), button("Закрыть фильтр", close, { icon: "close", iconOnly: true, className: "editor-quiet" }));
    const footer = el("div", "editor-facets-footer");
    const apply = value => {
      if (EstateTable.active(value)) filters.set(key, value);
      else filters.delete(key);
      filterColumn = null;
      draw();
      head.querySelector(`[data-filter-column="${key}"]`)?.focus();
    };
    const reset = button("Сбросить", () => apply(null), { className: "editor-quiet" });
    if (columnsByKey.get(key).numeric) {
      const bounds = el("div", "editor-range-fields");
      const min = textInput("От", filters.get(key)?.min, { placeholder: "—" });
      const max = textInput("До", filters.get(key)?.max, { placeholder: "—" });
      min.inputMode = max.inputMode = "decimal";
      bounds.append(field("От", min), field("До", max));
      footer.append(reset, button("Применить", () => {
        for (const input of [min, max]) {
          input.setCustomValidity(input.value.trim() && EstateTable.number(input.value) == null ? "Введите число." : "");
          if (!input.reportValidity()) return;
        }
        max.setCustomValidity(min.value.trim() && max.value.trim() &&
          EstateTable.number(max.value) < EstateTable.number(min.value) ? "Верхняя граница меньше нижней." : "");
        if (!max.reportValidity()) return;
        apply({ values: null, min: min.value.trim(), max: max.value.trim() });
      }, { className: "editor-primary" }));
      facetsPanel.append(header, bounds, footer);
      return;
    }
    const facets = EstateTable.facets(records, { ...state, sort: null }, key);
    const selected = new Set(filters.get(key)?.values ?? facets.map(([value]) => value));
    const list = el("div", "editor-facet-values");
    const options = facets.map(([value, count]) => {
      const name = value || "(Пустые)";
      return { value, count, name, searchText: EstateTable.normalize(name) };
    });
    let matching = options, rendered = 0;
    const more = button("Показать ещё значения", appendValues, { className: "editor-quiet" });
    function appendValues() {
      const fragment = document.createDocumentFragment();
      const end = Math.min(rendered + facetBatchSize, matching.length);
      for (const { value, name, count } of matching.slice(rendered, end)) {
        const input = el("input");
        input.type = "checkbox";
        input.checked = selected.has(value);
        input.onchange = () => { if (input.checked) selected.add(value); else selected.delete(value); };
        const item = el("label", "editor-facet-option");
        item.append(input, el("span", "", name), el("small", "", formatNumber(count)));
        fragment.append(item);
      }
      const firstNew = fragment.firstElementChild;
      list.append(fragment);
      if (rendered && firstNew) firstNew.querySelector("input").focus();
      rendered = end;
      more.hidden = rendered >= matching.length;
    }
    const renderValues = query => {
      const needle = EstateTable.normalize(query);
      matching = needle ? options.filter(option => option.searchText.includes(needle)) : options;
      rendered = 0;
      list.replaceChildren();
      if (matching.length) appendValues();
      else {
        list.append(el("p", "editor-inline-note", "Нет подходящих значений"));
        more.hidden = true;
      }
      list.scrollTop = 0;
    };
    const find = searchBox("Найти значение", "", renderValues);
    renderValues("");
    footer.append(reset, button("Применить", () => apply({
      values: facets.every(([value]) => selected.has(value)) ? null : selected, min: "", max: "",
    }), { className: "editor-primary" }));
    facetsPanel.append(header, find, list, more, footer);
  }

  function updateFacetPanel() {
    for (const toggle of head.querySelectorAll("[data-filter-column]"))
      toggle.setAttribute("aria-expanded", String(toggle.dataset.filterColumn === filterColumn));
    renderFacets(filterColumn ? getRecords() : [], selection());
  }

  function closeCellOnClickOutside(event) {
    if (event.button !== 0 || event.composedPath().includes(activeCell.cell)) return;
    finishCell();
    if (!replacePanel.hidden) previewReplacement();
  }

  function finishCell() {
    if (!activeCell) return;
    const { cell, id, column, focusOnClose } = activeCell;
    activeCell = null;
    document.removeEventListener("pointerdown", closeCellOnClickOutside, true);
    renderCell(cell, getRecord(id), column);
    if (focusOnClose) cell.firstElementChild?.focus({ preventScroll: true });
  }

  function startCell(cell, record, column, keys) {
    finishCell();
    const id = record.id;
    const before = getChanges(id);
    const originals = Object.fromEntries(keys.map(key => [key, before?.[key]]));
    activeCell = { cell, id, column };
    document.addEventListener("pointerdown", closeCellOnClickOutside, true);
    cell.classList.add("is-editing");
    const group = el("div", "editor-cell-fields");
    const inputs = keys.map(key => {
      const label = recordFieldLabel(key);
      const raw = recordFieldText(key, record[key]);
      const multiline = jsonRecordFields.includes(key) || key === "notes" || key === "source" || raw.length > 130;
      const input = key === "settlementId"
        ? selectInput(label, getSnapshot().settlements.map(item => [item.id, item.name]), raw)
        : textInput(label, raw, { tag: multiline ? "textarea" : "input", placeholder: "Введите значение" });
      if (numericRecordFields.includes(key)) input.inputMode = "decimal";
      input.setAttribute("autocomplete", "off");
      input.classList.toggle("is-dirty", Object.hasOwn(before || {}, key));
      input.oninput = () => {
        changeRecord(id, key, input.value);
        const pending = getChanges(id) || {};
        input.classList.toggle("is-dirty", Object.hasOwn(pending, key));
        cell.classList.toggle("is-dirty", keys.some(field => Object.hasOwn(pending, field)));
      };
      group.append(keys.length > 1 ? field(label, input) : input);
      return input;
    });
    group.onfocusout = event => {
      if (activeCell?.cell !== cell || group.contains(event.relatedTarget)) return;
      finishCell();
      if (!replacePanel.hidden) previewReplacement();
    };
    group.onkeydown = event => {
      if (event.isComposing) return;
      const cancel = event.key === "Escape";
      const apply = event.key === "Enter" && (event.target.tagName === "INPUT" || event.ctrlKey || event.metaKey);
      if (!cancel && !apply) return;
      event.preventDefault();
      event.stopPropagation();
      if (cancel) for (const key of keys) changeRecord(id, key, originals[key]);
      if (activeCell) activeCell.focusOnClose = true;
      finishCell();
      if (!replacePanel.hidden) previewReplacement();
    };
    cell.replaceChildren(group);
    inputs[0].focus({ preventScroll: true });
    if (inputs[0].tagName === "INPUT") inputs[0].select();
  }

  function renderCell(cell, record, column) {
    const keys = columnFields(column.key);
    cell.dataset.column = column.key;
    cell.classList.toggle("table-number", column.numeric);
    cell.classList.toggle("is-editable", keys.length > 0);
    cell.classList.toggle("is-dirty", keys.some(key => Object.hasOwn(getChanges(record.id) || {}, key)));
    cell.classList.remove("is-editing");
    const text = cellText(record, column);
    if (!keys.length) {
      cell.textContent = text;
      return;
    }
    const control = button(String(text), null, { className: "editor-cell" });
    control.setAttribute("aria-label", `${column.label}, ${text}. Изменить`);
    cell.replaceChildren(control);
  }

  function draw(keepRowPosition = false) {
    clearTimeout(searchTimer);
    finishCell();
    const records = getRecords();
    const enabled = new Set([...getSnapshot().site.tableFilters, ...extraByKey.keys(), sourceRowColumn.key]);
    for (const key of filters.keys()) if (!enabled.has(key)) filters.delete(key);
    if (filterColumn && !enabled.has(filterColumn)) filterColumn = null;
    const state = selection();
    rows = EstateTable.select(records, state);
    recordCount = records.length;
    if (!keepRowPosition) page = 0;
    if (!replacePanel.hidden) previewReplacement(records, rows);
    renderFacets(records, state);
    filterBar.replaceChildren();
    for (const key of filters.keys()) {
      filterBar.append(button(columnLabel(key), () => {
        filters.delete(key);
        draw();
      }, { icon: "close", className: "editor-filter-chip" }));
    }
    if (filters.size > 1) filterBar.append(button("Сбросить фильтры", () => {
      filters.clear(); filterColumn = null; draw();
    }, { className: "editor-quiet" }));
    filterBar.hidden = !filters.size;
    head.replaceChildren();
    const header = head.insertRow();
    for (const column of columns.filter(column => visibleColumns.has(column.key))) {
      const { key, label } = column;
      const th = el("th");
      th.dataset.column = key;
      th.scope = "col";
      const direction = sort?.key === key ? sort.direction : null;
      th.setAttribute("aria-sort", direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none");
      const group = el("div", "table-heading");
      const sortButton = button((key === "num" ? "№" : label) + (direction === "asc" ? " ↑" : direction === "desc" ? " ↓" : ""), () => {
        sort = { key, direction: direction === "asc" ? "desc" : "asc" };
        draw();
        head.querySelector(`[data-sort-column="${key}"]`)?.focus();
      });
      sortButton.dataset.sortColumn = key;
      sortButton.title = "Сортировать по столбцу «" + label + "»";
      group.append(sortButton);
      if (enabled.has(key)) {
        const toggle = button("Фильтр: " + label, () => {
          filterColumn = filterColumn === key ? null : key;
          updateFacetPanel();
          if (filterColumn) facetsPanel.querySelector("input")?.focus();
          else head.querySelector(`[data-filter-column="${key}"]`)?.focus();
        }, { icon: "filter", iconOnly: true, className: "table-filter-button" + (filters.has(key) ? " is-filtered" : "") });
        toggle.dataset.filterColumn = key;
        toggle.setAttribute("aria-expanded", String(filterColumn === key));
        group.append(toggle);
      }
      th.append(group);
      header.append(th);
    }
    const mapHeading = el("th", "", "Карта");
    mapHeading.scope = "col";
    header.append(mapHeading);
    renderRows(keepRowPosition);
  }

  function changePage(delta) {
    finishCell();
    page += delta;
    renderRows(false);
    const control = delta < 0 ? previous : next;
    if (control.disabled) (delta < 0 ? next : previous).focus();
  }

  function renderRows(keepRowPosition) {
    const top = wrap.scrollTop, left = wrap.scrollLeft;
    const shown = columns.filter(column => visibleColumns.has(column.key));
    const lastPage = Math.max(0, Math.ceil(rows.length / rowPageSize) - 1);
    page = Math.min(Math.max(page, 0), lastPage);
    const start = page * rowPageSize, end = Math.min(start + rowPageSize, rows.length);
    const results = document.createDocumentFragment();
    for (const { id } of rows.slice(start, end)) {
      const record = getRecord(id);
      const row = el("tr");
      row.dataset.recordId = record.id;
      for (const column of shown) renderCell(row.insertCell(), record, column);
      row.insertCell().append(button("Усадьба № " + record.num + " на карте", null, {
        icon: "external", iconOnly: true, className: "editor-quiet editor-map-link",
      }));
      results.append(row);
    }
    if (!rows.length) {
      const row = el("tr");
      const empty = row.insertCell();
      empty.colSpan = shown.length + 1;
      empty.className = "table-empty";
      empty.textContent = recordCount ? "По этим условиям ничего не найдено." : "В таблице пока нет усадеб.";
      results.append(row);
    }
    body.replaceChildren(results);
    const total = rows.length === recordCount ? `Усадеб: ${formatNumber(recordCount)}`
      : `Найдено: ${formatNumber(rows.length)} из ${formatNumber(recordCount)}`;
    range.textContent = lastPage ? `${total} · Строки ${formatNumber(start + 1)}–${formatNumber(end)}` : total;
    previous.hidden = next.hidden = !lastPage;
    previous.disabled = page === 0;
    next.disabled = page === lastPage;
    wrap.scrollTo(left, keepRowPosition ? top : 0);
  }

  return {
    block,
    finishCell,
    render() { updateToolbar(); draw(true); },
    reset() {
      finishCell();
      clearTimeout(searchTimer);
      query = city = "";
      search.querySelector("input").value = "";
      sort = filterColumn = null;
      page = 0;
      filters.clear();
      visibleColumns = defaultColumns();
      picker.open = false;
      find.value = replacement.value = replaceResult.textContent = "";
      columnPicker.value = "";
      scopePicker.value = "all";
      whole.checked = true;
      matchCase.checked = false;
      replacePanel.hidden = true;
      replaceToggle.setAttribute("aria-expanded", "false");
      wrap.scrollTo(0, 0);
    },
  };
}
