// Записи - таблица, поиск, фильтр по поселению, страницы
import { api } from './api.js';
import { onSectionShow } from './router.js';
import { esc, fullName, formatNumber } from './utils.js';
import { loadSettlements, settlementOptions } from './settlements.js';
import { openRecordForm } from './record-form.js';

const filterForm      = document.getElementById('records-filter');
const searchInput      = document.getElementById('records-q');
const settlementSelect = document.getElementById('records-settlement');
const tableBox         = document.getElementById('records-table');
const paginationBox    = document.getElementById('records-pagination');
const addButton        = document.getElementById('records-add');

const state = {
  q: '',
  settlement: '',
  limit: 50,
  offset: 0,
  total: 0,
};

function showError(error) {
  tableBox.innerHTML = `<p class="error table-note">Не удалось загрузить записи: ${esc(error.message)}</p>`;
  paginationBox.innerHTML = '';
}

async function loadRecords() {
  tableBox.innerHTML = '<p class="muted table-note">Загрузка…</p>';
  const params = new URLSearchParams({
    q: state.q,
    settlement: state.settlement,
    limit: state.limit,
    offset: state.offset,
  });
  try {
    const data = await api(`/api/admin/records?${params}`);
    state.total = data.total;
    renderRecordsTable(data.items);
    renderPagination();
  } catch (error) {
    showError(error);
  }
}

// сервер отдаёт поля в snake_case
function recordRow(record) {
  return `
    <tr>
      <td>${esc(record.id)}</td>
      <td>${esc(record.num)}</td>
      <td>${esc(fullName(record)) || '<span class="muted">-</span>'}</td>
      <td>${esc(record.settlement)}</td>
      <td class="street">${esc(record.street)}</td>
      <td class="num">${esc(formatNumber(record.area_sazh))}</td>
      <td class="num">${esc(record.plot_id ?? '-')}</td>
      <td class="actions">
        <button type="button" class="btn btn--small" data-edit="${esc(record.id)}">Изменить</button>
      </td>
    </tr>`;
}

function renderRecordsTable(items) {
  if (items.length === 0) {
    tableBox.innerHTML = '<p class="muted table-note">Ничего не найдено</p>';
    return;
  }
  tableBox.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th>ID</th>
          <th>№</th>
          <th>Владелец</th>
          <th>Поселение</th>
          <th>Улица</th>
          <th class="num">Площадь, кв. саж.</th>
          <th class="num">Контур</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${items.map(recordRow).join('')}</tbody>
    </table>`;
}

function renderPagination() {
  if (state.total === 0) {
    paginationBox.innerHTML = '';
    return;
  }
  const pages = Math.ceil(state.total / state.limit);
  const page = Math.floor(state.offset / state.limit) + 1;
  const from = state.offset + 1;
  const to = Math.min(state.offset + state.limit, state.total);

  paginationBox.innerHTML = `
    <button type="button" class="btn" data-go="prev" ${page <= 1 ? 'disabled' : ''}>Назад</button>
    <span class="muted">Стр. ${page} из ${pages} · записи ${from}-${to} из ${formatNumber(state.total)}</span>
    <button type="button" class="btn" data-go="next" ${page >= pages ? 'disabled' : ''}>Вперёд</button>`;
}

// после поиска или смены поселения начинаем с первой страницы
function applyFilters(event) {
  if (event) event.preventDefault();
  state.q = searchInput.value.trim();
  state.settlement = settlementSelect.value;
  state.offset = 0;
  loadRecords();
}

async function showRecords() {
  tableBox.innerHTML = '<p class="muted table-note">Загрузка…</p>';
  paginationBox.innerHTML = '';
  try {
    await loadSettlements();
  } catch (error) {
    showError(error);
    return;
  }
  settlementSelect.innerHTML = settlementOptions(state.settlement, 'Все поселения');
  await loadRecords();
}

filterForm.addEventListener('submit', applyFilters);
settlementSelect.addEventListener('change', applyFilters);

// кнопки пересоздаются при каждой отрисовке, поэтому слушаем клики на родителе
paginationBox.addEventListener('click', event => {
  const button = event.target.closest('button[data-go]');
  if (!button) return;
  state.offset += button.dataset.go === 'next' ? state.limit : -state.limit;
  loadRecords();
});

tableBox.addEventListener('click', async event => {
  const button = event.target.closest('button[data-edit]');
  if (!button) return;
  try {
    await openRecordForm(Number(button.dataset.edit), loadRecords);
  } catch (error) {
    alert(`Не удалось открыть запись: ${error.message}`);
  }
});

// новую запись сразу показываем в таблице, поэтому фильтр поселения сбрасываем
function showNewRecord(id) {
  searchInput.value = String(id);
  settlementSelect.value = '';
  applyFilters();
}

addButton.addEventListener('click', async () => {
  try {
    await openRecordForm(null, showNewRecord);
  } catch (error) {
    alert(`Не удалось открыть форму: ${error.message}`);
  }
});

onSectionShow('records', showRecords);
