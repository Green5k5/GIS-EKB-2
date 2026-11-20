// The table and map have independent filters; AI results define the table's base selection.
const tableState = {
  scope: null, scopeLabel: '', scopeQuestion: '', focus: new Set(),
  filters: new Map(), query: '', city: '', sort: null, page: 0, pageSize: 100,
  visible: new Set(EstateTable.columns.filter(c => c.visible).map(c => c.key)),
};
let tableRows = [];
let tableFilterDraft = null;
let tableFilterAnchor = null;
const tableFormat = n => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
const tableEscape = v => esc(String(v ?? ''));

function tableCell(record, column) {
  const v = EstateTable.value(record, column.key);
  if (column.key === 'scanUrl') return v
    ? `<button type="button" class="table-text-button" data-scan-id="${Number(record.id)}">Открыть скан ↗</button>` : '—';
  if (column.key === 'source') return tableEscape(formatArchiveSource(v) || '—');
  if (column.numeric) {
    const n = EstateTable.number(v);
    return n === null ? '—' : tableFormat(n);
  }
  return tableEscape(v || '—');
}
function filterTable(resetPage = true) {
  if (isTableFilterOpen()) closeTableFilter();
  if (resetPage) tableState.page = 0;
  tableRows = EstateTable.select(allData, tableState);
  renderEstateTable();
}
function filterTableByCity(city) {
  tableState.city = city;
  document.querySelectorAll('[data-table-city]').forEach(b => {
    b.classList.toggle('active', b.dataset.tableCity === city);
    b.setAttribute('aria-pressed', String(b.dataset.tableCity === city));
  });
  filterTable();
}
function resetTableFilters() {
  tableState.filters.clear(); tableState.query = ''; tableState.sort = null;
  document.getElementById('dsFilter').value = '';
  filterTableByCity('');
}
function setTableAIScope(ids, description, question = '', focusIds = [], operation = '') {
  tableState.scope = new Set(ids.map(Number));
  tableState.scopeLabel = description || 'Ответ помощника';
  tableState.scopeQuestion = question;
  tableState.focus = new Set(focusIds.map(Number));
  resetTableFilters();
  if (operation === 'max' || operation === 'min') {
    tableState.sort = { key: 'area_sazh', direction: operation === 'max' ? 'desc' : 'asc' };
    filterTable();
  }
}
function clearTableAIScope() {
  tableState.scope = null; tableState.scopeLabel = ''; tableState.scopeQuestion = '';
  tableState.focus.clear(); resetTableFilters();
}
function scrollToEstateTable() {
  document.getElementById('estateTableSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function renderEstateTable() {
  const columns = EstateTable.columns.filter(c => tableState.visible.has(c.key));
  const size = tableState.pageSize || Math.max(1, tableRows.length);
  const pages = Math.max(1, Math.ceil(tableRows.length / size));
  tableState.page = Math.min(tableState.page, pages - 1);
  const start = tableState.page * size;
  document.getElementById('dsTableHead').innerHTML = '<tr>' + columns.map(c => {
    const sort = tableState.sort?.key === c.key ? tableState.sort.direction : null;
    const filtered = EstateTable.active(tableState.filters.get(c.key));
    return `<th scope="col" aria-sort="${sort ? sort === 'asc' ? 'ascending' : 'descending' : 'none'}" data-column="${c.key}"><div class="table-heading"><button type="button" data-sort-column="${c.key}" title="Сортировать: ${c.label}">${c.key === 'num' ? '№' : c.label}<span aria-hidden="true">${sort === 'asc' ? ' ↑' : sort === 'desc' ? ' ↓' : ''}</span></button><button type="button" class="table-filter-button ${filtered ? 'is-filtered' : ''}" data-filter-column="${c.key}" aria-label="Фильтр столбца: ${c.label}" aria-haspopup="dialog" aria-expanded="false" title="Фильтр: ${c.label}"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M2 3h12L9.5 8v4l-3 1V8Z"/></svg></button></div></th>`;
  }).join('') + '<th scope="col">На карте</th></tr>';
  const visibleRows = tableRows.slice(start, start + size);
  document.getElementById('dsTableBody').innerHTML = visibleRows.length ? visibleRows.map(r =>
    `<tr data-record-id="${Number(r.id)}" class="${tableState.focus.has(Number(r.id)) ? 'is-table-focus' : ''}">${columns.map(c => `<td class="${c.numeric ? 'table-number' : ''}" data-column="${c.key}">${c.key === 'num' && tableState.focus.has(Number(r.id)) ? '<span class="table-focus-mark" title="Найденный максимум или минимум">★</span> ' : ''}${tableCell(r, c)}</td>`).join('')}<td><button type="button" class="table-text-button" data-table-map-id="${Number(r.id)}" aria-label="Усадьба ${tableEscape(r.num)}: показать на карте">↗</button></td></tr>`
  ).join('') : `<tr><td colspan="${columns.length + 1}" class="table-empty"><strong>Подходящих усадеб нет</strong><span>Измените условия вопроса или сбросьте фильтры таблицы.</span></td></tr>`;
  const stats = EstateTable.statistics(tableRows);
  document.getElementById('tableSelectionStats').innerHTML =
    `<span><b>${tableFormat(stats.count)}</b> усадеб</span><span>Площадь: <b>${tableFormat(stats.sum)}</b> саж²</span><span>Средняя: <b>${stats.mean === null ? '—' : tableFormat(stats.mean)}</b> саж²</span><small>В расчёте площади: ${tableFormat(stats.included)}; без положительной площади: ${tableFormat(stats.missing)}</small>`;
  document.getElementById('dsTableInfo').textContent = tableRows.length
    ? `Строки ${start + 1}–${Math.min(start + size, tableRows.length)} из ${tableFormat(tableRows.length)} · В реестре ${tableFormat(allData.length)}`
    : `Найдено 0 из ${tableFormat(allData.length)}`;
  document.getElementById('tablePageNumber').textContent = `${tableState.page + 1} / ${pages}`;
  for (const name of ['first', 'prev']) document.querySelector(`[data-table-page="${name}"]`).disabled = tableState.page === 0;
  for (const name of ['next', 'last']) document.querySelector(`[data-table-page="${name}"]`).disabled = tableState.page >= pages - 1;
  document.getElementById('tableExport').disabled = !tableRows.length;
  document.getElementById('tableMap').disabled = !tableRows.length;
  document.getElementById('tableColumnsSummary').textContent = `Столбцы · ${columns.length}`;
  const scope = document.getElementById('tableAIScope');
  scope.hidden = tableState.scope === null;
  document.getElementById('tableAIScopeLabel').textContent = tableState.scopeQuestion || tableState.scopeLabel;
  document.getElementById('tableAIScopeDescription').textContent = `${tableState.scopeLabel} · ${tableFormat(tableState.scope?.size || 0)} записей до фильтров таблицы${tableState.focus.size ? ' · ★ отмечен найденный максимум или минимум' : ''}`;
  document.getElementById('tableFilterChips').innerHTML = [...tableState.filters].filter(([, f]) => EstateTable.active(f)).map(([key]) =>
    `<button type="button" data-clear-column="${key}" aria-label="Убрать фильтр: ${EstateTable.columns.find(c => c.key === key).label}">${EstateTable.columns.find(c => c.key === key).label} ×</button>`).join('');
}
function sortEstateTable(key, direction) {
  tableState.sort = { key, direction: direction || (tableState.sort?.key === key && tableState.sort.direction === 'asc' ? 'desc' : 'asc') };
  filterTable();
}
function isTableFilterOpen() {
  return Boolean(document.getElementById('tableFilterDialog')?.matches?.(':popover-open'));
}
function closeTableFilter(restoreFocus = false) {
  if (isTableFilterOpen()) document.getElementById('tableFilterDialog').hidePopover();
  tableFilterAnchor?.setAttribute('aria-expanded', 'false');
  if (restoreFocus) tableFilterAnchor?.focus();
}
function positionTableFilter() {
  if (!isTableFilterOpen() || !tableFilterAnchor?.isConnected) return;
  const anchor = tableFilterAnchor.getBoundingClientRect();
  if (anchor.bottom <= 0 || anchor.top >= innerHeight || anchor.right <= 0 || anchor.left >= innerWidth) {
    closeTableFilter(); return;
  }
  const popover = document.getElementById('tableFilterDialog');
  const box = popover.getBoundingClientRect();
  const columnLeft = tableFilterAnchor.closest('th').getBoundingClientRect().left;
  const left = Math.max(8, Math.min(columnLeft, innerWidth - box.width - 8));
  const below = anchor.bottom + 6;
  const top = below + box.height <= innerHeight - 8 ? below : Math.max(8, anchor.top - box.height - 6);
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}
function syncTableSelectAll() {
  const values = tableFilterDraft.visibleValues;
  const selected = values.filter(v => tableFilterDraft.values.has(v)).length;
  const checkbox = document.getElementById('tableSelectAll');
  checkbox.checked = values.length > 0 && selected === values.length;
  checkbox.indeterminate = selected > 0 && selected < values.length;
  checkbox.disabled = !values.length;
}
function renderTableFilterValues() {
  const search = EstateTable.normalize(document.getElementById('tableValueSearch').value);
  const entries = tableFilterDraft.options.map(([v, count], i) => ({ v, count, i })).filter(x => EstateTable.normalize(x.v || '(Пустые)').includes(search));
  tableFilterDraft.visibleValues = entries.map(x => x.v);
  document.getElementById('tableFilterValues').innerHTML = entries.map(({ v, count, i }) =>
    `<label><input type="checkbox" data-value-index="${i}" ${tableFilterDraft.values.has(v) ? 'checked' : ''}><span>${tableEscape(v || '(Пустые)')}</span><small>${tableFormat(count)}</small></label>`).join('') || '<p class="table-no-values">Нет значений</p>';
  document.getElementById('tableValuesCount').textContent = `${entries.length} значений`;
  syncTableSelectAll();
  positionTableFilter();
}
function openTableFilter(key, anchor) {
  if (isTableFilterOpen() && tableFilterDraft?.key === key) { closeTableFilter(); return; }
  closeTableFilter();
  tableFilterAnchor = anchor;
  const column = EstateTable.columns.find(c => c.key === key);
  const previous = tableState.filters.get(key) || { values: null, min: '', max: '' };
  const options = column.numeric ? [] : EstateTable.facets(allData, tableState, key);
  tableFilterDraft = { key, numeric: column.numeric, options, visibleValues: [], values: new Set(previous.values ?? options.map(([v]) => v)) };
  document.getElementById('tableFilterTitle').textContent = column.label;
  document.getElementById('tableValueSearch').value = '';
  document.getElementById('tableNumberCondition').hidden = !column.numeric;
  document.getElementById('tableTextValues').hidden = column.numeric;
  document.getElementById('tableNumberMin').value = previous.min;
  document.getElementById('tableNumberMax').value = previous.max;
  document.getElementById('tableFilterError').textContent = '';
  renderTableFilterValues();
  document.getElementById('tableFilterDialog').showPopover();
  anchor.setAttribute('aria-expanded', 'true');
  positionTableFilter();
  document.getElementById(column.numeric ? 'tableNumberMin' : 'tableValueSearch').focus();
}
function applyTableFilter() {
  const { key, numeric } = tableFilterDraft;
  const min = numeric ? document.getElementById('tableNumberMin').value.trim() : '';
  const max = numeric ? document.getElementById('tableNumberMax').value.trim() : '';
  if ([min, max].some(v => v !== '' && EstateTable.number(v) === null) || (min !== '' && max !== '' && EstateTable.number(min) > EstateTable.number(max))) {
    document.getElementById('tableFilterError').textContent = 'Проверьте диапазон: «от» должно быть не больше «до».';
    positionTableFilter(); return;
  }
  const search = EstateTable.normalize(document.getElementById('tableValueSearch').value);
  const selected = new Set([...tableFilterDraft.values].filter(v => !search || tableFilterDraft.visibleValues.includes(v)));
  const allSelected = tableFilterDraft.options.every(([v]) => selected.has(v));
  const filter = { values: numeric || (allSelected && !search) ? null : selected, text: '', min, max };
  if (EstateTable.active(filter)) tableState.filters.set(key, filter); else tableState.filters.delete(key);
  closeTableFilter(); filterTable();
  document.querySelector(`[data-filter-column="${key}"]`)?.focus();
}
function showEstateTableOnMap(id = null) {
  if (!tableRows.length) return;
  if (document.body.classList.contains('table-expanded')) expandEstateTable(false);
  openMapSelection(tableRows.map(r => Number(r.id)), tableState.scopeLabel || 'Выборка из таблицы', tableState.scopeQuestion || tableState.query || 'Фильтры таблицы');
  if (id === null) return;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    window.map.invalidateSize(); fitToEstates(16, true);
    const record = id === null ? null : tableRows.find(r => Number(r.id) === id);
    if (record && record.lat && record.lng) { window.map.flyTo(estateAnchor(record), 18, { duration: .7 }); openEstate(record); }
  }));
}
function exportEstateTable() {
  const blob = new Blob([EstateTable.csv(tableRows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = `ekb-estates-${tableRows.length}.csv`;
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function expandEstateTable(expanded) {
  const section = document.getElementById('estateTableSection');
  section.classList.toggle('is-expanded', expanded);
  document.body.classList.toggle('table-expanded', expanded);
  if (expanded) { section.setAttribute('role', 'dialog'); section.setAttribute('aria-modal', 'true'); }
  else { section.removeAttribute('role'); section.removeAttribute('aria-modal'); }
  for (const sibling of section.parentElement.children) if (sibling !== section) sibling.inert = expanded;
  document.querySelector('.nav').inert = expanded;
  document.getElementById('mobileMenu').inert = expanded;
  const button = document.getElementById('tableExpand');
  button.setAttribute('aria-expanded', String(expanded));
  button.textContent = expanded ? 'Свернуть таблицу' : 'На весь экран';
  if (!expanded) { button.focus(); scrollToEstateTable(); }
}
function initTable() {
  const columns = document.getElementById('tableColumnChoices');
  columns.innerHTML = EstateTable.columns.map(c => `<label><input type="checkbox" data-table-column="${c.key}" ${tableState.visible.has(c.key) ? 'checked' : ''} ${c.key === 'num' ? 'disabled' : ''}>${c.label}</label>`).join('');
  columns.addEventListener('change', event => {
    setTableColumnVisibility(event.target.dataset.tableColumn, event.target.checked);
  });
  document.getElementById('dsFilter').addEventListener('input', event => { tableState.query = event.target.value; filterTable(); });
  document.getElementById('tablePageSize').addEventListener('change', event => { tableState.pageSize = Number(event.target.value); filterTable(); });
  document.getElementById('estateTableSection').addEventListener('click', event => {
    const b = event.target.closest('button'); if (!b) return;
    if (b.dataset.sortColumn) sortEstateTable(b.dataset.sortColumn);
    else if (b.dataset.filterColumn) openTableFilter(b.dataset.filterColumn, b);
    else if (b.dataset.clearColumn) { tableState.filters.delete(b.dataset.clearColumn); filterTable(); }
    else if (b.hasAttribute('data-table-city')) filterTableByCity(b.dataset.tableCity);
    else if (b.dataset.tablePage) {
      const pages = Math.max(1, Math.ceil(tableRows.length / (tableState.pageSize || Math.max(1, tableRows.length))));
      tableState.page = ({ first: 0, prev: tableState.page - 1, next: tableState.page + 1, last: pages - 1 })[b.dataset.tablePage];
      filterTable(false); document.querySelector('#estateTableSection .ds-table-wrap').scrollTop = 0;
    } else if (b.dataset.scanId) openEstateScan(Number(b.dataset.scanId));
    else if (b.dataset.tableMapId) showEstateTableOnMap(Number(b.dataset.tableMapId));
  });
  document.getElementById('tableResetFilters').onclick = resetTableFilters;
  document.getElementById('tableClearAI').onclick = clearTableAIScope;
  document.getElementById('tableExport').onclick = exportEstateTable;
  document.getElementById('tableMap').onclick = () => showEstateTableOnMap();
  document.getElementById('tableExpand').onclick = () => expandEstateTable(!document.body.classList.contains('table-expanded'));
  document.addEventListener('keydown', event => {
    if (!document.body.classList.contains('table-expanded') || isTableFilterOpen()) return;
    if (event.key === 'Escape') expandEstateTable(false);
    if (event.key === 'Tab') {
      const section = document.getElementById('estateTableSection');
      const controls = [...section.querySelectorAll('button:not(:disabled), input:not(:disabled), select, summary, [tabindex="0"]')].filter(el => el.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if ((!event.shiftKey && document.activeElement === last) || !section.contains(document.activeElement)) { event.preventDefault(); first?.focus(); }
    }
  });
  const popover = document.getElementById('tableFilterDialog');
  document.getElementById('tableFilterClose').onclick = () => closeTableFilter(true);
  document.getElementById('tableFilterApply').onclick = applyTableFilter;
  document.getElementById('tableFilterClear').onclick = () => {
    const key = tableFilterDraft.key;
    tableState.filters.delete(key); closeTableFilter(); filterTable();
    document.querySelector(`[data-filter-column="${key}"]`)?.focus();
  };
  document.getElementById('tableValueSearch').oninput = renderTableFilterValues;
  document.getElementById('tableFilterValues').onchange = event => {
    const index = event.target.dataset.valueIndex; if (index === undefined) return;
    const v = tableFilterDraft.options[Number(index)][0];
    if (event.target.checked) tableFilterDraft.values.add(v); else tableFilterDraft.values.delete(v);
    syncTableSelectAll();
  };
  document.getElementById('tableSelectAll').onchange = event => {
    for (const v of tableFilterDraft.visibleValues) {
      if (event.target.checked) tableFilterDraft.values.add(v); else tableFilterDraft.values.delete(v);
    }
    renderTableFilterValues();
  };
  popover.addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target.tagName === 'INPUT') { event.preventDefault(); applyTableFilter(); }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && isTableFilterOpen()) { event.preventDefault(); closeTableFilter(true); }
  });
  document.addEventListener('pointerdown', event => {
    if (isTableFilterOpen() && !popover.contains(event.target) && !event.target.closest('[data-filter-column]')) closeTableFilter();
  });
  popover.addEventListener('toggle', event => {
    if (event.newState === 'closed' && !isTableFilterOpen()) tableFilterAnchor?.setAttribute('aria-expanded', 'false');
  });
  window.addEventListener('resize', positionTableFilter);
  document.addEventListener('scroll', positionTableFilter, true);
  filterTable();
}

// Both views use the same column set; map columns never add row filters.
function setTableColumnVisibility(key, visible) {
  if (key === 'num' || !EstateTable.columns.some(column => column.key === key)) return;
  if (visible) tableState.visible.add(key); else tableState.visible.delete(key);
  document.querySelectorAll('#tableColumnChoices [data-table-column]').forEach(input => {
    input.checked = tableState.visible.has(input.dataset.tableColumn);
  });
  renderEstateTable();
  if (mapTableOpen) renderMapTable(getFiltered());
}
