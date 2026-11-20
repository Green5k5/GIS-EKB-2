import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function setup() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { hidden: false, value: '', innerHTML: '', textContent: '', classList: { toggle() {}, remove() {} }, setAttribute() {} });
    return elements.get(id);
  };
  const context = vm.createContext({
    Intl, Set, Map, console,
    allData: [
      { id: 1, num: '969', surname: 'Пётров', name: 'Иван', settlement: 'Уктус', street: 'Береговая', area_sazh: 100 },
      { id: 2, num: '12', surname: 'Петров', name: 'Павел', settlement: 'Екатеринбург', area_sazh: 200 },
      { id: 3, num: '13', surname: 'Иванов', settlement: 'Уктус', area_sazh: 300 },
    ],
    FILTERS: [{ key: 'settlement' }], window: {},
    document: { addEventListener() {}, getElementById: element, querySelectorAll: () => [] },
    update() {}, esc: String, formatNum: String, formatArchiveSource: String,
  });
  for (const file of ['utils', 'filters', 'table-model', 'table', 'map-table']) vm.runInContext(fs.readFileSync(`js/${file}.js`, 'utf8'), context);
  vm.runInContext('initFiltersState(); mapTableOpen = true;', context);
  return { context, element, run: code => vm.runInContext(code, context) };
}

test('map table uses the exact search and sidebar selection, including zero results', () => {
  const { run, element } = setup();
  run("searchQuery = 'петров'; state.settlement.add('Уктус'); renderMapTable(getFiltered());");
  assert.match(element('mapTableBody').innerHTML, /data-id="1"/);
  assert.doesNotMatch(element('mapTableBody').innerHTML, /data-id="2"/);
  run("searchQuery = 'несуществующий'; renderMapTable(getFiltered());");
  assert.match(element('mapTableBody').innerHTML, /Усадьбы не найдены/);
});

test('transferred IDs reset stale map filters and remain the base of further searches', () => {
  const { run } = setup();
  run("searchQuery = 'Иванов'; state.settlement.add('Уктус'); applyDatabaseMapFilter([1, 2], 'Из данных', 'Запрос');");
  assert.deepEqual(Array.from(run('getFiltered().map(r => r.id)')), [1, 2]);
  run("searchQuery = 'Павел';");
  assert.deepEqual(Array.from(run('getFiltered().map(r => r.id)')), [2]);
  run('clearDatabaseMapFilter();');
  assert.deepEqual(Array.from(run('getFiltered().map(r => r.id)')), [2]);
});

test('map search supports estate numbers, streets, mixed owner tokens and е/ё', () => {
  const { run } = setup();
  for (const query of ['969', 'береговая', 'Иван петров', 'Уктус Пётров']) {
    assert.equal(run(`matchesSearch(allData[0], ${JSON.stringify(query)})`), true);
  }
});

test('map table shares data columns and formatting without adding its own filters', () => {
  const { run, element } = setup();
  run("allData[0].sex = 'Мужчины'; allData[0].familyStatus = 'Женат'; allData[0].notes = 'Сведения из реестра'; renderMapTable(allData);");
  assert.match(element('mapTableHead').innerHTML, />Пол</);
  assert.match(element('mapTableBody').innerHTML, /Мужчины/);
  assert.doesNotMatch(element('mapTableHead').innerHTML, /data-filter-column/);
  run('tableState.visible = new Set(EstateTable.columns.map(c => c.key)); renderMapTable(allData);');
  assert.equal((element('mapTableHead').innerHTML.match(/scope="col"/g) || []).length, 25);
  assert.match(element('mapTableBody').innerHTML, /Женат/);
  assert.match(element('mapTableBody').innerHTML, /Сведения из реестра/);
  assert.match(element('mapTableColumnChoices').innerHTML, /Скан источника/);
});
