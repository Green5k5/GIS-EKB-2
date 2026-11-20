let mapTableOpen = false;
let mapTableSelectedId = null;

function mapTableColumns() {
  return EstateTable.columns.filter(column => tableState.visible.has(column.key));
}
function mapTableRowHtml(record, columns = mapTableColumns()) {
  return `<tr tabindex="0" data-id="${esc(record.id)}">${columns.map(column =>
    `<td data-column="${column.key}">${tableCell(record, column)}</td>`).join('')}</tr>`;
}
function renderMapTable(filtered) {
  if (!mapTableOpen) return;
  const columns = mapTableColumns();
  document.getElementById('mapTableHead').innerHTML = '<tr>' + columns.map(column =>
    `<th scope="col" data-column="${column.key}" title="${esc(column.label)}" aria-label="${esc(column.label)}">${column.key === 'num' ? '№' : esc(column.label)}</th>`).join('') + '</tr>';
  document.getElementById('mapTableColumnChoices').innerHTML = EstateTable.columns.map(column =>
    `<label><input type="checkbox" data-map-column="${column.key}" ${tableState.visible.has(column.key) ? 'checked' : ''} ${column.key === 'num' ? 'disabled' : ''}>${esc(column.label)}</label>`).join('');
  document.getElementById('mapTableColumnsSummary').textContent = `Столбцы · ${columns.length}`;
  document.getElementById('mapTableBody').innerHTML = filtered.map(record => mapTableRowHtml(record, columns)).join('') ||
    `<tr><td colspan="${columns.length}" class="map-table-empty">Усадьбы не найдены. Измените поиск или фильтры.</td></tr>`;
  selectMapTableRow(mapTableSelectedId);
  document.getElementById('mapTableCount').textContent =
    `Показано: ${filtered.length.toLocaleString('ru-RU')} из ${allData.length.toLocaleString('ru-RU')}`;
}

function setMapTable(open) {
  mapTableOpen = open;
  document.getElementById("mapTablePanel").hidden = !open;
  document.getElementById("mapTableOpen").hidden = open;
  document.getElementById("page-map").classList.toggle("has-map-table", open);
  document.getElementById("mapTableOpen").setAttribute("aria-expanded", String(open));
  if (open) renderMapTable(getFiltered());
  if (window.map) window.map.invalidateSize();
}

function showMapTableRow(row) {
  if (!row) return;
  focusOnItem(Number(row.dataset.id));
  selectMapTableRow(Number(row.dataset.id));
}

function initMapTable() {
  document.getElementById("mapTableOpen").addEventListener("click", () => setMapTable(true));
  document.getElementById("mapTableClose").addEventListener("click", () => setMapTable(false));
  const body = document.getElementById("mapTableBody");
  document.getElementById('mapTableColumnChoices').addEventListener('change', event => {
    const key = event.target.dataset.mapColumn;
    if (key) setTableColumnVisibility(key, event.target.checked);
  });
  body.addEventListener('click', event => {
    const scan = event.target.closest('[data-scan-id]');
    if (scan) { openEstateScan(Number(scan.dataset.scanId)); return; }
    showMapTableRow(event.target.closest('tr[data-id]'));
  });
  body.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.target.closest("button")) showMapTableRow(e.target.closest("tr[data-id]"));
  });
}

function selectMapTableRow(id) {
  mapTableSelectedId = id;
  document.querySelectorAll('#mapTableBody tr[data-id]').forEach(row => {
    const selected = id !== null && Number(row.dataset.id) === Number(id);
    row.classList.toggle('is-selected', selected);
    row.setAttribute('aria-selected', String(selected));
  });
}
function openMapSelection(ids, description, question = '') {
  if (!applyDatabaseMapFilter(ids, description, question)) return false;
  document.querySelector('.nav-item[data-page="map"]').click();
  setMapTable(true);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    window.map.invalidateSize(); fitToEstates(16, true);
  }));
  return true;
}
