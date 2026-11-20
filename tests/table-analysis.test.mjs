import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({ Intl });
vm.runInContext(fs.readFileSync('js/table-model.js', 'utf8'), context);
const model = vm.runInContext('EstateTable', context);
const state = () => ({ scope: null, city: '', query: '', filters: new Map(), sort: null });
const filter = overrides => ({ values: null, text: '', min: '', max: '', ...overrides });
const rows = [
  { id: 1, num: '2a', settlement: 'Уктус', surname: 'Пётров', sex: 'Мужчины', area_sazh: 100 },
  { id: 2, num: '10', settlement: 'Уктус', surname: 'Иванов', sex: 'Мужчины', area_sazh: 200 },
  { id: 3, num: '2', settlement: 'Екатеринбург', surname: 'Петрова', sex: 'Женщины', area_sazh: null },
  { id: 4, num: '0', settlement: 'Уктус', surname: '=SUM(1;2)', sex: '', area_sazh: 0 },
];
const ids = result => Array.from(result, r => r.id);

test('AI scope, table search, checklists and inclusive numeric ranges compose without losing zero results', () => {
  const s = state();
  s.scope = new Set([1, 2, 3]); s.city = 'Уктус';
  s.filters.set('area_sazh', filter({ min: '100', max: '200' }));
  assert.deepEqual(ids(model.select(rows, s)), [1, 2]);
  s.query = 'петров'; assert.deepEqual(ids(model.select(rows, s)), [1]);
  s.query = ''; s.filters.set('sex', filter({ values: new Set() }));
  assert.deepEqual(ids(model.select(rows, s)), []);
  s.filters.clear(); s.scope = new Set(); assert.deepEqual(ids(model.select(rows, s)), []);
  s.scope = null; s.city = ''; assert.equal(model.select(rows, s).length, 4);
});

test('numeric sorting keeps empty values last, estate identifiers stay textual and sorting is stable', () => {
  const s = state(); s.sort = { key: 'area_sazh', direction: 'desc' };
  assert.deepEqual(ids(model.select(rows, s)), [2, 1, 4, 3]);
  s.sort.direction = 'asc'; assert.deepEqual(ids(model.select(rows, s)), [4, 1, 2, 3]);
  s.sort = { key: 'num', direction: 'asc' };
  assert.deepEqual(Array.from(model.select(rows, s), r => r.num), ['0', '2', '2a', '10']);
  assert.equal(model.number('12,5'), 12.5); assert.equal(model.number(''), null);
});

test('facets respect other filters, preserve blank values, and include selected zero-count values', () => {
  const s = state(); s.city = 'Уктус';
  s.filters.set('sex', filter({ values: new Set(['Женщины']) }));
  const values = new Map(model.facets(rows, s, 'sex'));
  assert.equal(values.get('Мужчины'), 2); assert.equal(values.get(''), 1);
  assert.equal(values.get('Женщины'), 0);
});

test('statistics exclude nonpositive/missing areas and CSV exports every selected row and field safely', () => {
  const stats = model.statistics(rows);
  assert.equal(stats.count, 4); assert.equal(stats.sum, 300);
  assert.equal(stats.mean, 150); assert.equal(stats.missing, 2);
  const records = Array.from({ length: 251 }, (_, i) => ({ ...rows[i % 4], id: i + 1, notes: 'Text; "quoted"\nnext line' }));
  const csv = model.csv(records);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"2a"')); assert.ok(csv.includes("\"'=SUM(1;2)\""));
  assert.ok(csv.includes('"Text; ""quoted""\nnext line"'));
  assert.equal(csv.match(/next line"/g).length, 251);
  assert.ok(csv.includes('"Широта"')); assert.ok(csv.includes('"Примечания"'));
  assert.ok(model.csv([{ area_sazh: 12.5 }]).includes('"12,5"'));
});

test('real published source: all merchants are available and maximum candidates stay distinct from the focus', () => {
  vm.runInContext(fs.readFileSync('js/data-records.js', 'utf8'), context);
  const source = vm.runInContext('allData', context);
  const merchants = source.filter(r => r.soslovie === 'Купцы');
  const s = state(); s.scope = new Set(merchants.map(r => r.id));
  assert.equal(model.select(source, s).length, 122);
  s.scope = new Set(source.filter(r => r.settlement === 'Уктус').map(r => r.id));
  s.sort = { key: 'area_sazh', direction: 'desc' };
  const selected = model.select(source, s);
  assert.equal(selected.length, 224); assert.equal(selected[0].area_sazh, 815);
});

test('a new AI answer clears previous table conditions; an empty answer stays empty until explicitly reset', () => {
  const inputs = new Map();
  context.document = {
    getElementById(id) { if (!inputs.has(id)) inputs.set(id, { value: '' }); return inputs.get(id); },
    querySelectorAll() { return []; },
  };
  vm.runInContext(fs.readFileSync('js/table.js', 'utf8'), context);
  vm.runInContext('renderEstateTable = () => {}; tableState.city = "Уктус"; tableState.query = "previous";', context);
  context.setTableAIScope([1], 'One estate', 'New question', [1]);
  assert.deepEqual(ids(vm.runInContext('tableRows', context)), [1]);
  assert.equal(vm.runInContext('tableState.city', context), '');
  assert.equal(vm.runInContext('tableState.query', context), '');
  context.setTableAIScope([], 'No results', 'Empty question');
  assert.equal(vm.runInContext('tableRows.length', context), 0);
  context.clearTableAIScope();
  assert.equal(vm.runInContext('tableRows.length', context), 2569);
});
