// Форма записи: новая и редактирование
import { api } from './api.js';
import { esc } from './utils.js';
import { loadSettlements, settlementOptions } from './settlements.js';
import { openModal, setFieldErrors } from './modal.js';
import {
  FIELD_GROUPS, RECORD_FIELDS, fromServerRecord, toServerRecord, validateRecord,
} from './record-fields.js';

// id = null - новая запись
export async function openRecordForm(id, onSaved) {
  await loadSettlements();

  let record = {};
  if (id) {
    const row = await api(`/api/admin/records/${id}`);
    record = fromServerRecord(row);
  }

  openModal({
    title: id ? `Запись #${id}` : 'Новая запись',
    html: renderRecordForm(record),
    onSave: formData => saveRecord(id, formData, onSaved),
  });
}

function renderRecordForm(record) {
  return FIELD_GROUPS.map(group => {
    const fields = RECORD_FIELDS.filter(field => field.group === group);
    return `
      <fieldset class="form-group">
        <legend>${esc(group)}</legend>
        <div class="form-grid">
          ${fields.map(field => fieldHtml(field, record[field.key])).join('')}
        </div>
      </fieldset>`;
  }).join('');
}

function fieldHtml(field, value) {
  const star = field.required ? ' <b class="required">*</b>' : '';
  return `
    <label class="field ${field.wide ? 'field--wide' : ''}">
      <span class="field__label">${esc(field.label)}${star}</span>
      ${fieldInput(field, value ?? '')}
      <span class="field__error" data-error-for="${field.key}"></span>
    </label>`;
}

function fieldInput(field, value) {
  if (field.type === 'settlement') {
    return `<select name="${field.key}">${settlementOptions(value, 'Выберите поселение')}</select>`;
  }

  if (field.type === 'select') {
    const options = ['', ...field.options];
    // значение из базы, которого нет в списке, тоже показываем, иначе оно потеряется
    if (value && !options.includes(value)) options.push(value);
    const items = options.map(option => {
      const selected = option === value ? 'selected' : '';
      return `<option value="${esc(option)}" ${selected}>${esc(option || '-')}</option>`;
    });
    return `<select name="${field.key}">${items.join('')}</select>`;
  }

  // числа тоже в type="text", чтобы можно было ввести запятую
  const inputmode = field.type === 'number' ? 'decimal' : 'text';
  return `<input name="${field.key}" type="text" inputmode="${inputmode}" value="${esc(value)}">`;
}

// на несуществующий контур сервер отвечает ошибкой 500, поэтому проверяем заранее
async function plotExists(plotId) {
  try {
    await api(`/api/admin/plots/${plotId}`);
    return true;
  } catch (error) {
    if (error.status === 404) return false;
    throw error;
  }
}

async function saveRecord(id, formData, onSaved) {
  const data = toServerRecord(formData);

  const errors = validateRecord(data);
  if (!errors.plotId && data.plotId !== null && !(await plotExists(data.plotId))) {
    errors.plotId = 'Такого контура нет';
  }
  setFieldErrors(errors);
  if (Object.keys(errors).length > 0) return false;

  let savedId = id;
  if (id) {
    await api(`/api/admin/records/${id}`, { method: 'PATCH', body: data });
  } else {
    const created = await api('/api/admin/records', { method: 'POST', body: data });
    savedId = created.id;
  }

  if (onSaved) await onSaved(savedId);
  return true;
}
