// Shared, DOM-independent rules for the estate analysis table.
const EstateTable = (() => {
  const columns = [
    ['num', '№ усадьбы', true], ['settlement', 'Поселение', true],
    ['owner', 'Владелец · ФИО', true], ['street', 'Улица / район', true],
    ['buildingType', 'Тип постройки', true], ['soslovie', 'Сословно-профессиональная группа', true],
    ['sex', 'Пол', true], ['area_sazh', 'Площадь, саж²', true, true],
    ['rank', 'Чин', true], ['source', 'Архивный источник', true],
    ['surname', 'Фамилия'], ['name', 'Имя'], ['patronymic', 'Отчество'],
    ['familyStatus', 'Семейное положение'], ['serviceType', 'Род службы'],
    ['position', 'Должность / занятие'], ['servicePlace', 'Место службы'],
    ['registrationPlace', 'Место приписки'], ['scanUrl', 'Скан источника'],
    ['notes', 'Примечания'], ['extra', 'Дополнительные сведения'], ['sourceData', 'Исходные данные'],
    ['lat', 'Широта', false, true], ['lng', 'Долгота', false, true], ['id', 'ID записи', false, true],
  ].map(([key, label, visible = false, numeric = false]) => ({ key, label, visible, numeric }));
  const collator = new Intl.Collator('ru', { sensitivity: 'base', numeric: true });
  const normalize = value => String(value ?? '').toLocaleLowerCase('ru').replace(/ё/g, 'е').trim();
  function value(record, key) {
    if (key === 'owner') return [record.surname, record.name, record.patronymic].filter(Boolean).join(' ');
    if (key === 'extra' || key === 'sourceData') return Object.entries(record[key] || {}).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('; ');
    return record[key] ?? '';
  }
  function number(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const n = Number(String(value).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  function active(filter) {
    return Boolean(filter && (filter.values !== null || filter.text || filter.min !== '' || filter.max !== ''));
  }
  function matches(record, key, filter) {
    const v = value(record, key);
    if (filter.values !== null && !filter.values.has(String(v))) return false;
    if (filter.text && !normalize(v).includes(normalize(filter.text))) return false;
    if (filter.min !== '' || filter.max !== '') {
      const n = number(v);
      if (n === null) return false;
      if (filter.min !== '' && n < number(filter.min)) return false;
      if (filter.max !== '' && n > number(filter.max)) return false;
    }
    return true;
  }
  function select(records, state, ignoreKey = null) {
    const query = normalize(state.query);
    const rows = records.filter(record => {
      if (state.scope !== null && !state.scope.has(Number(record.id))) return false;
      if (state.city && record.settlement !== state.city) return false;
      if (query && !columns.some(c => normalize(value(record, c.key)).includes(query))) return false;
      for (const [key, filter] of state.filters) if (key !== ignoreKey && !matches(record, key, filter)) return false;
      return true;
    });
    if (state.sort) {
      const { key, direction } = state.sort;
      const column = columns.find(c => c.key === key);
      rows.sort((a, b) => {
        const av = value(a, key), bv = value(b, key);
        const an = column.numeric ? number(av) : av, bn = column.numeric ? number(bv) : bv;
        const am = an === null || av === '', bm = bn === null || bv === '';
        if (am !== bm) return am ? 1 : -1;
        const order = column.numeric ? (an ?? 0) - (bn ?? 0) : collator.compare(String(av), String(bv));
        return order * (direction === 'desc' ? -1 : 1) || Number(a.id) - Number(b.id);
      });
    }
    return rows;
  }
  function facets(records, state, key) {
    const counts = new Map();
    for (const record of select(records, state, key)) {
      const v = String(value(record, key));
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    for (const v of state.filters.get(key)?.values || []) if (!counts.has(v)) counts.set(v, 0);
    return [...counts].sort(([a], [b]) => collator.compare(a, b));
  }
  function statistics(rows) {
    const areas = rows.map(r => number(r.area_sazh)).filter(n => n !== null && n > 0);
    const sum = areas.reduce((a, b) => a + b, 0);
    return { count: rows.length, sum, mean: areas.length ? sum / areas.length : null,
      included: areas.length, missing: rows.length - areas.length };
  }
  function csv(rows) {
    const cell = v => {
      let text = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? '');
      // Keep spreadsheet applications from treating imported text as formulas.
      if (typeof v !== 'number' && /^\s*[=+\-@]/.test(text)) text = "'" + text;
      return '"' + text.replace(/"/g, '""') + '"';
    };
    return '\uFEFF' + [columns.map(c => cell(c.label)).join(';'),
      ...rows.map(r => columns.map(c => cell(value(r, c.key))).join(';'))].join('\r\n');
  }
  return { columns, normalize, value, number, active, select, facets, statistics, csv };
})();
