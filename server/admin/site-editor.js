import { button, el, entryChanged, fieldChanged, formatNumber, glyph, loadEditorStyles, splitLines, switchInput } from "./editor-dom.js?v=change-grid";
import { changedEstateColumns, createEstateEditor, isExtraColumn, jsonRecordFields, mergeExtraColumnEdits, numericRecordFields, recordFieldLabel, recordFieldText, withExtraColumns } from "./editor-table.js?v=change-grid";
import { createGlossaryEditor } from "./editor-glossary.js?v=bulk-table";
import { createMapFilterEditor, movedFilters } from "./editor-filters.js?v=bulk-table";

const sections = {
  records: { title: "Таблица усадеб", short: "Усадьбы", icon: "table", note: "Нажмите на ячейку, чтобы изменить значение." },
  glossary: { title: "Глоссарий", short: "Глоссарий", icon: "book", note: "Нажмите на текст или значок, чтобы изменить карточку термина." },
  filters: { title: "Фильтры карты", short: "Фильтры карты", icon: "sliders", note: "Меняйте названия, порядок и видимость значений. Предпросмотр обновляется сразу." },
  tableFilters: { title: "Фильтры таблицы", short: "Фильтры таблицы", icon: "filter", note: "Выберите, в каких столбцах посетители смогут фильтровать таблицу." },
};
const collapseLabel = "Свернуть таблицу";
const expandLabel = "На весь экран";
const toList = value => Array.isArray(value) ? value : splitLines(value);
const draftRows = source => source.map((original, index) => ({ original, value: { ...original }, index }));

function editorError(section, message) {
  return Object.assign(new Error(message), { section });
}

export function createSiteEditor(root, { api, refresh, toast, openRecord }) {
  const shadow = root.attachShadow({ mode: "open" });
  const loading = el("p", "editor-loading", "Загружаем редактор…");
  loading.setAttribute("role", "status");
  loading.style.padding = "24px";
  const stylesLoaded = loadEditorStyles(shadow);

  const panel = el("div", "editor-panel");
  panel.hidden = true;
  let stylesReady = false;
  const command = el("div", "editor-command");
  const tabs = el("nav", "editor-tabs");
  tabs.setAttribute("aria-label", "Разделы редактора данных");
  const tabButtons = new Map();
  for (const [key, { short, icon }] of Object.entries(sections)) {
    const tab = button(short, () => {
      if (snapshot && !saving && !uploads && key !== section) openSection(key);
    }, { icon, className: "editor-tab" });
    const count = el("span", "editor-tab-count");
    count.hidden = true;
    count.setAttribute("aria-hidden", "true");
    tab.append(count);
    tab.dataset.section = key;
    tabs.append(tab);
    tabButtons.set(key, { tab, count });
  }
  const commandRight = el("div", "editor-command-actions");
  const status = el("span", "editor-status");
  status.setAttribute("role", "status");
  const statusDot = el("span", "editor-status-dot");
  const statusText = el("span");
  status.append(statusDot, statusText);
  const discard = button("Отменить все несохранённые правки", () => {
    discardConfirm.hidden = false;
    cancelDiscard.focus();
  }, { icon: "undo", iconOnly: true, className: "editor-quiet" });
  const save = button("Сохранить", saveDraft, { icon: "check", className: "editor-primary" });
  commandRight.append(status, discard, save);
  const commandRow = el("div", "editor-command-row");
  commandRow.append(tabs, commandRight);
  const discardConfirm = el("div", "editor-message editor-discard");
  discardConfirm.hidden = true;
  const cancelDiscard = button("Продолжить редактирование", () => {
    discardConfirm.hidden = true;
    discard.focus();
  }, { className: "editor-quiet" });
  discardConfirm.append(el("span", "", "Отменить все несохранённые правки?"), cancelDiscard,
    button("Отменить правки", () => {
      load(snapshot, { preserveView: true });
      refreshStatus();
    }));
  const message = el("p", "editor-message");
  message.hidden = true;
  message.setAttribute("role", "alert");
  command.append(commandRow, discardConfirm, message);

  const heading = el("h1", "editor-title");
  const note = el("p", "editor-intro");
  const intro = el("div");
  intro.append(heading, note);
  const actions = el("div", "editor-header-actions");
  const expanded = button(expandLabel, () => setExpanded(!root.hasAttribute("data-expanded")), { icon: "expand" });
  const add = button("Добавить", addItem, { icon: "plus", className: "editor-add" });
  actions.append(expanded, add);
  const header = el("header", "editor-header");
  header.append(intro, actions);
  const viewport = el("div", "editor-viewport");
  panel.append(command, header, viewport);
  shadow.append(loading, panel);
  stylesLoaded.then(() => {
    stylesReady = true;
    reveal();
  }).catch(() => {
    loading.textContent = "Стили редактора не загрузились. Обновите страницу.";
  });

  let snapshot, glossaryRows, filterRows, area, tableFilters, publishedTableFilters;
  let recordsById, settlementsById, draftRecordIds, publishedDifferences;
  let section = "records", saving = false, uploads = 0, reloadNeeded = false;
  let inertBeforeExpand = [];
  const recordChanges = new Map();
  const editedRecords = new Map();

  const getSnapshot = () => snapshot;
  const getRecord = id => {
    const original = recordsById.get(id);
    const changes = recordChanges.get(id);
    if (!changes) return original;
    if (!editedRecords.has(id)) {
      const record = changes.extra !== undefined || changes.sourceData !== undefined
        ? withExtraColumns(original, changes) : { ...original, ...changes };
      record.settlement = settlementsById.get(record.settlementId) || record.settlementId;
      editedRecords.set(id, record);
    }
    return editedRecords.get(id);
  };
  const getRecords = () => Array.from(recordsById.keys(), getRecord);
  const getHighlights = (record, includePublished) => {
    const original = recordsById.get(record.id);
    const pending = recordChanges.get(record.id);
    const published = includePublished && publishedDifferences[record.id];
    if (!pending && !published) return null;
    const keys = changedEstateColumns(record, original, pending);
    if (published) {
      const previous = published.added ? {} : withExtraColumns({ ...original, ...published });
      for (const key of changedEstateColumns(original, previous, published)) keys.add(key);
    }
    return keys;
  };
  const table = createEstateEditor({
    getSnapshot, getRecords, getRecord,
    getChanges: id => recordChanges.get(id), getHighlights, isChanged: id => recordChanges.has(id) || draftRecordIds.has(id),
    changeRecord, changeRecords, openRecord,
  });
  const glossary = createGlossaryEditor({
    getSnapshot, getRows: () => glossaryRows,
    getMapFilters: () => filterRows.filter(entry => !entry.removed).map(entry => entry.value),
    refreshStatus, imageBusy(delta) { uploads += delta; refreshStatus(); },
  });
  const mapFilters = createMapFilterEditor({
    getSnapshot, getRows: () => filterRows, getArea: () => area, getRecords, refreshStatus,
  });

  function reveal() {
    const ready = stylesReady && Boolean(snapshot);
    loading.hidden = ready;
    panel.hidden = !ready;
  }

  function load(nextSnapshot, { preserveView = false } = {}) {
    table.finishCell();
    snapshot = nextSnapshot;
    settlementsById = new Map(snapshot.settlements.map(item => [item.id, item.name]));
    recordsById = new Map(snapshot.records.map(record => [record.id, withExtraColumns({
      ...record, settlement: settlementsById.get(record.settlementId) || record.settlementId,
    })]));
    recordChanges.clear();
    draftRecordIds = new Set(snapshot.changedRecordIds || []);
    publishedDifferences = snapshot.changedRecordFields || {};
    editedRecords.clear();
    glossaryRows = draftRows(snapshot.site.glossary.map(row => ({
      ...row, icon: row.icon || "", aliases: toList(row.aliases), filterKey: row.filterKey || "",
      filterValue: row.filterKey ? toList(row.filterValue) : [],
    })));
    filterRows = draftRows(snapshot.site.filters.map(row => ({
      ...row, sort: row.sort || "count", inline: Boolean(row.inline), limit: row.limit ?? 0,
      hiddenValues: toList(row.hiddenValues),
    })));
    const areaRule = { title: snapshot.site.areaFilterTitle || "Площадь усадьбы", enabled: snapshot.site.areaFilter };
    area = { original: areaRule, value: { ...areaRule } };
    publishedTableFilters = new Set(snapshot.site.tableFilters);
    tableFilters = new Set(publishedTableFilters);
    reloadNeeded = false;
    message.hidden = discardConfirm.hidden = true;
    if (!preserveView) {
      table.reset();
      glossary.reset();
    }
    openSection(section);
    reveal();
  }

  function stageRecordField(id, key, value) {
    const original = recordsById.get(id);
    const changes = recordChanges.get(id) || {};
    const record = isExtraColumn(key) && (changes.extra !== undefined || changes.sourceData !== undefined)
      ? withExtraColumns(original, { extra: changes.extra, sourceData: changes.sourceData }) : original;
    const baseline = recordFieldText(key, record[key]);
    if (value == null || value === baseline) delete changes[key];
    else changes[key] = value;
    if (Object.keys(changes).length) recordChanges.set(id, changes);
    else recordChanges.delete(id);
    editedRecords.delete(id);
  }

  function changeRecord(id, key, value) {
    stageRecordField(id, key, value);
    refreshStatus();
  }

  function changeRecords(rows) {
    for (const { id, changes } of rows) {
      for (const [key, value] of Object.entries(changes)) stageRecordField(id, key, value);
    }
    refreshStatus();
  }

  function counts() {
    if (!snapshot || reloadNeeded) return { records: 0, glossary: 0, filters: 0, tableFilters: 0 };
    const moved = movedFilters(filterRows);
    return {
      records: recordChanges.size,
      glossary: glossaryRows.filter(entryChanged).length,
      filters: filterRows.filter(entry => entryChanged(entry) || moved.has(entry)).length + Number(entryChanged(area)),
      tableFilters: snapshot.site.tableFields.filter(key => tableFilters.has(key) !== publishedTableFilters.has(key)).length,
    };
  }

  function refreshStatus() {
    const edits = counts();
    const total = Object.values(edits).reduce((sum, value) => sum + value, 0);
    for (const [key, { tab, count }] of tabButtons) {
      const quantity = edits[key];
      count.hidden = !quantity;
      count.textContent = quantity;
      tab.setAttribute("aria-pressed", String(key === section));
      tab.setAttribute("aria-label", sections[key].short + (quantity ? `, изменено: ${quantity}` : ""));
      tab.disabled = saving || uploads > 0;
    }
    status.classList.toggle("is-pending", total > 0);
    status.classList.toggle("is-busy", saving || uploads > 0);
    const summary = saving ? "Сохраняем…" : uploads ? "Обработка значка…" : reloadNeeded ? "Нужно обновить данные"
      : total ? `Несохранённые правки: ${formatNumber(total)}`
      : snapshot?.hasChanges ? "Черновик сохранён" : "Нет правок";
    if (statusText.textContent !== summary) statusText.textContent = summary;
    save.querySelector("span").textContent = reloadNeeded ? "Обновить данные" : "Сохранить";
    save.disabled = saving || uploads > 0 || (!reloadNeeded && !total);
    discard.hidden = !total;
    discard.disabled = saving || uploads > 0;
    if (!total || saving) discardConfirm.hidden = true;
    add.disabled = saving || uploads > 0 || reloadNeeded;
    viewport.inert = saving || reloadNeeded;
    panel.setAttribute("aria-busy", String(saving));
  }

  function setExpanded(enabled, focus = true) {
    if (root.hasAttribute("data-expanded") === enabled) return;
    root.toggleAttribute("data-expanded", enabled);
    if (enabled) {
      const away = [...root.parentElement.children].filter(item => item !== root);
      const side = root.closest("main")?.parentElement.querySelector(":scope > .sidebar");
      if (side) away.push(side);
      inertBeforeExpand = away.map(item => [item, item.inert]);
      for (const [item] of inertBeforeExpand) item.inert = true;
    } else {
      for (const [item, wasInert] of inertBeforeExpand) item.inert = wasInert;
      inertBeforeExpand = [];
    }
    const title = enabled ? collapseLabel : expandLabel;
    expanded.replaceChildren(glyph(enabled ? "collapse" : "expand"), el("span", "", title));
    expanded.setAttribute("aria-expanded", String(enabled));
    expanded.title = enabled ? collapseLabel + " · Esc" : expandLabel;
    if (focus) expanded.focus({ preventScroll: true });
  }
  expanded.setAttribute("aria-expanded", "false");
  panel.addEventListener("keydown", event => {
    if (event.key === "Escape" && root.hasAttribute("data-expanded") && !event.defaultPrevented) {
      event.preventDefault();
      setExpanded(false);
    }
  });

  function renderTableFilters() {
    const block = el("div", "editor-table-filter-settings");
    const groups = [
      ["Основные столбцы", EstateTable.columns.filter(column => column.visible)],
      ["Дополнительные столбцы", EstateTable.columns.filter(column => !column.visible)],
    ];
    for (const [title, columns] of groups) {
      const group = el("section", "editor-toggle-group");
      const grid = el("div", "editor-toggle-grid");
      group.append(el("h2", "editor-toggle-heading", title), grid);
      for (const { key, label } of columns) {
        if (!snapshot.site.tableFields.includes(key)) continue;
        const item = switchInput(label, tableFilters.has(key), enabled => {
          if (enabled) tableFilters.add(key);
          else tableFilters.delete(key);
          item.classList.toggle("is-dirty", enabled !== publishedTableFilters.has(key));
          refreshStatus();
        });
        item.classList.toggle("is-dirty", tableFilters.has(key) !== publishedTableFilters.has(key));
        grid.append(item);
      }
      block.append(group);
    }
    return block;
  }

  function openSection(key) {
    const changingSection = section !== key;
    table.finishCell();
    if (key !== "records") setExpanded(false, false);
    section = key;
    const config = sections[key];
    heading.textContent = config.title;
    note.textContent = config.note;
    expanded.hidden = key !== "records";
    add.hidden = key === "tableFilters";
    add.querySelector("span").textContent = {
      records: "Добавить усадьбу", glossary: "Добавить термин", filters: "Добавить фильтр", tableFilters: "",
    }[key];
    viewport.id = key === "records" ? "page-data" : "editor-section";
    const content = { records: table, glossary, filters: mapFilters }[key];
    const block = content?.block || renderTableFilters();
    if (viewport.firstElementChild !== block) viewport.replaceChildren(block);
    content?.render();
    refreshStatus();
    if (changingSection && root.getBoundingClientRect().top < 0) root.scrollIntoView({ block: "start" });
  }

  function addItem() {
    discardConfirm.hidden = true;
    if (section === "records") {
      openRecord(null);
      return;
    }
    if (section === "glossary") {
      glossaryRows.unshift({ value: {
        term: "", category: glossary.selectedCategory(), description: "", aliases: [], filterKey: "", filterValue: [], icon: "",
      } });
      glossary.focusNew();
    } else {
      filterRows.unshift({ value: { key: "", title: "", sort: "count", limit: 6, inline: false, hiddenValues: [] } });
      mapFilters.render();
      mapFilters.focusNew();
    }
    refreshStatus();
  }

  function payload() {
    const edits = counts();
    const site = {};
    if (edits.glossary) {
      const names = new Set();
      site.glossary = glossaryRows.filter(entry => !entry.removed).map(({ value }) => {
        const term = value.term.trim(), category = value.category.trim(), description = value.description.trim();
        if (!term || !category || !description)
          throw editorError("glossary", `Глоссарий. Заполните термин, категорию и определение${term ? " для «" + term + "»" : ""}.`);
        const key = term.toLocaleLowerCase("ru");
        if (names.has(key)) throw editorError("glossary", `Термин «${term}» встречается дважды.`);
        names.add(key);
        if (value.filterKey && !value.filterValue.length)
          throw editorError("glossary", `Укажите значения фильтра для термина «${term}» или снимите связь.`);
        return { ...value, term, category, description, filterValue: value.filterKey ? value.filterValue : "" };
      });
    }
    if (filterRows.some(entryChanged) || movedFilters(filterRows).size) {
      const keys = new Set();
      site.filters = filterRows.filter(entry => !entry.removed).map(({ value }) => {
        const title = value.title.trim();
        if (!title || !value.key) throw editorError("filters", "Укажите название и поле данных для каждого фильтра.");
        if (keys.has(value.key)) throw editorError("filters", `Поле фильтра «${title}» уже используется.`);
        keys.add(value.key);
        if (!Number.isInteger(value.limit) || value.limit < 0 || value.limit > 1000)
          throw editorError("filters", `Для фильтра «${title}» укажите целое число вариантов от 0 до 1000.`);
        return { ...value, title };
      });
    }
    if (fieldChanged(area, "enabled")) site.areaFilter = area.value.enabled;
    if (fieldChanged(area, "title")) {
      site.areaFilterTitle = area.value.title.trim();
      if (!site.areaFilterTitle) throw editorError("filters", "Укажите название фильтра площади.");
    }
    if (edits.tableFilters) site.tableFilters = snapshot.site.tableFields.filter(key => tableFilters.has(key));
    const records = [...recordChanges].map(([id, values]) => {
      const changes = { ...values };
      for (const [key, value] of Object.entries(changes)) {
        if (jsonRecordFields.includes(key)) {
          try {
            const parsed = JSON.parse(value.trim() || "{}");
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
            changes[key] = parsed;
          } catch {
            throw editorError("records", `Усадьба № ${getRecord(id).num}. Проверьте JSON в поле «${recordFieldLabel(key)}».`);
          }
        } else if (numericRecordFields.includes(key)) {
          changes[key] = EstateTable.number(value);
          if (value.trim() && changes[key] == null)
            throw editorError("records", `Усадьба № ${getRecord(id).num}. Введите число в поле «${recordFieldLabel(key)}».`);
        }
      }
      return { id, changes: mergeExtraColumnEdits(changes, recordsById.get(id).extra) };
    });
    return { revision: snapshot.revision, site, ...(records.length ? { records } : {}) };
  }

  async function saveDraft() {
    if (saving || uploads || (!reloadNeeded && !hasChanges())) return;
    table.finishCell();
    saving = true;
    message.hidden = true;
    refreshStatus();
    try {
      if (!reloadNeeded) {
        await api("/editor", { method: "PATCH", body: JSON.stringify(payload()) });
        reloadNeeded = true;
      }
      const updated = await refresh();
      load(updated, { preserveView: true });
      toast("Правки сохранены. Опубликуйте их, чтобы обновить сайт.");
    } catch (error) {
      if (error.section) openSection(error.section);
      message.textContent = reloadNeeded
        ? "Правки сохранены. Нажмите «Обновить данные», чтобы вернуться к редактированию."
        : error.message;
      message.hidden = false;
    } finally {
      saving = false;
      refreshStatus();
    }
  }

  function hasChanges() {
    return Object.values(counts()).some(Boolean);
  }
  function canLeave() {
    return !saving && !uploads && (!hasChanges() || confirm("Закрыть редактор и отменить несохранённые правки?"));
  }

  return {
    load, canLeave, hasChanges,
    leave() {
      table.finishCell();
      setExpanded(false, false);
    },
  };
}
