// Link historic street labels to explicit registry values, never to nearby estates.
function historicStreetName(value) {
  return String(value || '').trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')
    .replace(/^(?:ул\.?|улица)\s+/u, '').replace(/\s+улица$/u, '').replace(/\s+/g, ' ');
}

function historicStreetStem(value) {
  return historicStreetName(value).replace(/(?:ая|а)$/u, '');
}

function resolveHistoricStreet(name, records = allData) {
  const groups = new Map();
  records.forEach(record => {
    if (record.settlement !== 'Екатеринбург' || !record.street || record.street === 'Нет данных') return;
    const key = historicStreetName(record.street);
    if (!groups.has(key)) groups.set(key, { name: record.street, values: new Set(), ids: [] });
    const group = groups.get(key); group.values.add(record.street); group.ids.push(Number(record.id));
  });
  const key = historicStreetName(name), stem = historicStreetStem(name);
  const exact = [...groups].filter(([value]) => value === key || historicStreetStem(value) === stem).map(([, group]) => group);
  // These spellings are offered for confirmation, not silently treated as synonyms.
  const suggestions = {
    'береговая': ['Береговая улица', 'Улица Береговая подле пруда'],
    'берегова': ['Береговая улица', 'Улица Береговая подле пруда'],
    'коротка': ['Короткая односторонняя улица', 'Коротинькая улица'],
    'зыряновска': ['Зырянова улица'],
    'семенова': ['Семеновская улица'],
    'казанцова': ['Казанцева улица'],
    'волчья': ['Волчий порядок улица'],
    'лягушья': ['Лягуший порядок улица'],
    'уктуска': ['Уктусская улица']
  };
  const candidates = new Map(exact.map(group => [historicStreetName(group.name), group]));
  (suggestions[key] || []).forEach(value => {
    const group = groups.get(historicStreetName(value)); if (group) candidates.set(historicStreetName(group.name), group);
  });
  return { direct: exact.length === 1 && candidates.size === 1 ? exact[0] : null, candidates: [...candidates.values()] };
}

function selectHistoricStreet(feature, event) {
  if (feature.kind !== 'street') return false;
  const label = feature.streetName || feature.label.replace(/^ул\.\s*/u, '');
  const match = resolveHistoricStreet(label);
  const apply = group => {
    applyDatabaseMapFilter(group.ids, [...group.values].join(' / '), 'Подпись на историческом плане: ' + label, { kind: 'street', streetId: feature.id });
    map.closePopup(); map.hideTooltip();
  };
  if (match.direct) { apply(match.direct); return true; }
  const html = `<div class="street-choice"><strong>${esc(feature.label)}</strong><p>${match.candidates.length ? 'Выберите название из реестра усадеб:' : 'Для этой подписи не найдено однозначного соответствия в поле «Улица» реестра. Выборка не изменена.'}</p>${match.candidates.map((group, index) => `<button type="button" data-street-choice="${index}"><span>${esc([...group.values].join(' / '))}</span><b>${group.ids.length} ↗</b></button>`).join('')}</div>`;
  map.closePopup(); map.hideTooltip();
  map.openPopup(event.latlng, html, { className: 'custom-popup', maxWidth: 320 });
  map.container.querySelectorAll('[data-street-choice]').forEach(button => {
    button.addEventListener('click', () => apply(match.candidates[Number(button.dataset.streetChoice)]));
  });
  return true;
}
