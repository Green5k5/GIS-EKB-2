// Поселения. Загружаем один раз и запоминаем
import { api } from './api.js';
import { esc } from './utils.js';

let cache = null;

export async function loadSettlements() {
  if (!cache) cache = await api('/api/admin/settlements');
  return cache;
}

export function settlementOptions(selectedId = '', emptyLabel = '') {
  const empty = emptyLabel ? `<option value="">${esc(emptyLabel)}</option>` : '';
  const items = (cache || []).map(item => {
    const selected = item.id === selectedId ? 'selected' : '';
    return `<option value="${esc(item.id)}" ${selected}>${esc(item.name)}</option>`;
  });
  return empty + items.join('');
}
