export const FIELD_GROUPS = ['Участок', 'Владелец', 'Служба', 'Источник'];

// Из этого списка строится форма: одна строка - одно поле
export const RECORD_FIELDS = [
  { key: 'num',          label: 'Номер усадьбы', type: 'text', group: 'Участок', required: true },
  { key: 'settlementId', column: 'settlement_id', label: 'Поселение', type: 'settlement', group: 'Участок', required: true },
  { key: 'street',       label: 'Улица', type: 'text', group: 'Участок', wide: true },
  { key: 'buildingType', column: 'building_type', label: 'Тип постройки', type: 'text', group: 'Участок' },
  { key: 'area_sazh',    label: 'Площадь, кв. саж.', type: 'number', group: 'Участок' },
  { key: 'plotId',       column: 'plot_id', label: 'ID контура', type: 'number', group: 'Участок' },
  { key: 'lat',          label: 'Широта', type: 'number', group: 'Участок' },
  { key: 'lng',          label: 'Долгота', type: 'number', group: 'Участок' },

  { key: 'surname',      label: 'Фамилия', type: 'text', group: 'Владелец' },
  { key: 'name',         label: 'Имя', type: 'text', group: 'Владелец' },
  { key: 'patronymic',   label: 'Отчество', type: 'text', group: 'Владелец' },
  { key: 'sex',          label: 'Пол', type: 'select', group: 'Владелец', options: ['Мужчины', 'Женщины', 'Не определено'] },
  { key: 'familyStatus', column: 'family_status', label: 'Семейное положение', type: 'text', group: 'Владелец' },
  { key: 'soslovie',     label: 'Сословие', type: 'text', group: 'Владелец' },

  { key: 'serviceType',  column: 'service_type', label: 'Род службы', type: 'select', group: 'Служба', options: ['Военная', 'Гражданская', 'Горная'] },
  { key: 'rank',         label: 'Чин', type: 'text', group: 'Служба' },
  { key: 'position',     label: 'Должность', type: 'text', group: 'Служба' },
  { key: 'servicePlace', column: 'service_place', label: 'Место службы', type: 'text', group: 'Служба' },
  { key: 'registrationPlace', column: 'registration_place', label: 'Место приписки', type: 'text', group: 'Служба' },

  { key: 'source',       label: 'Архивный источник', type: 'text', group: 'Источник', wide: true },
  { key: 'scanUrl',      column: 'scan_url', label: 'Ссылка на скан', type: 'text', group: 'Источник', wide: true },
];

// без этого перевода поля не находятся по имени и стираются при сохранении
export function fromServerRecord(row) {
  const record = { id: row.id };
  for (const field of RECORD_FIELDS) {
    record[field.key] = row[field.column || field.key];
  }
  return record;
}

export function toServerRecord(formData) {
  const data = {};
  for (const field of RECORD_FIELDS) {
    const raw = String(formData.get(field.key) ?? '').trim();
    if (field.type === 'number') {
      // запятую в числах тоже принимаем
      data[field.key] = raw === '' ? null : Number(raw.replace(',', '.'));
    } else {
      data[field.key] = raw;
    }
  }
  return data;
}

export function validateRecord(data) {
  const errors = {};

  for (const field of RECORD_FIELDS) {
    const value = data[field.key];
    if (field.required && (value === '' || value === null)) {
      errors[field.key] = 'Обязательное поле';
    } else if (field.type === 'number' && value !== null && !Number.isFinite(value)) {
      errors[field.key] = 'Нужно число';
    }
  }

  if (!errors.area_sazh && data.area_sazh !== null && data.area_sazh <= 0) {
    errors.area_sazh = 'Площадь должна быть больше нуля';
  }
  if (!errors.plotId && data.plotId !== null && (!Number.isInteger(data.plotId) || data.plotId <= 0)) {
    errors.plotId = 'ID контура должен быть целым положительным числом';
  }
  // все усадьбы лежат в окрестностях Екатеринбурга
  if (!errors.lat && data.lat !== null && (data.lat < 56 || data.lat > 57.5)) {
    errors.lat = 'Широта Екатеринбурга около 56.8';
  }
  if (!errors.lng && data.lng !== null && (data.lng < 60 || data.lng > 61.5)) {
    errors.lng = 'Долгота Екатеринбурга около 60.6';
  }
  if ((data.lat === null) !== (data.lng === null)) {
    errors.lat = errors.lat || 'Заполните широту и долготу вместе';
    errors.lng = errors.lng || 'Заполните широту и долготу вместе';
  }
  // скан может лежать и на самом сайте, в assets/scans/
  if (data.scanUrl && !/^(https?:\/\/|assets\/)/.test(data.scanUrl)) {
    errors.scanUrl = 'Ссылка должна начинаться с http://, https:// или assets/';
  }

  return errors;
}
