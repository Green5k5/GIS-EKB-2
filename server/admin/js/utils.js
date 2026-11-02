// Общие функции для разных разделов

const ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// всё, что пришло с сервера и идёт в innerHTML, пропускаем через esc()
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, char => ESCAPE[char]);
}

export function fullName(record) {
  return [record.surname, record.name, record.patronymic].filter(Boolean).join(' ');
}

export function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '-';
  return Number(value).toLocaleString('ru-RU');
}
