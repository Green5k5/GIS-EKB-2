const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const cameraCalls = [];
const context = {
  window: {map: {fitBounds(b, o) {cameraCalls.push('fit' + (o && o.maxZoom ? ':' + o.maxZoom : ''));}, invalidateSize() {}}, matchMedia() {return {matches: false};}},
  document: {addEventListener() {}, getElementById() {return null;}},
  estateLayer: {getLayers() {return [{}];}, getBounds() {return {isValid() {return true;}};}},
  flyToSettlement(name) {cameraCalls.push(name);},
  matchesSearch() {return true;}, closeSelected() {}
};
vm.createContext(context);
for (const path of ['js/data-records.js', 'js/data.js', 'js/filters.js', 'js/app.js']) vm.runInContext(fs.readFileSync(path, 'utf8'), context);
for (const name of ['renderFilters', 'renderActiveTags', 'renderMap', 'updateStats', 'renderDatabaseMapFilter', 'renderInfographics']) context[name] = () => {};
context.initFiltersState();
// Фильтр сословия/пола приближает карту к выборке
context.toggle('soslovie', 'Купцы');
assert.equal(context.getFiltered().length, 122); assert.deepEqual(cameraCalls, ['fit:18']);
context.toggle('sex', 'Женщины');
assert.equal(context.getFiltered().length, 18); assert.deepEqual(cameraCalls, ['fit:18', 'fit:18']);
context.toggle('sex', 'Женщины');
assert.deepEqual(cameraCalls, ['fit:18', 'fit:18', 'fit:18']);
// Выбор поселения по-прежнему летит к границам поселения (без доп. fit)
context.toggle('settlement', 'Екатеринбург');
assert.deepEqual(cameraCalls.slice(3), ['Екатеринбург']);
// Снятие поселения — снова приближение к выборке
context.toggle('settlement', 'Екатеринбург');
assert.deepEqual(cameraCalls.slice(3), ['Екатеринбург', 'fit:18']);
// Сброс и выбор по улице/базе камеру сами не двигают
const before = cameraCalls.length;
context.resetAllFilters();
assert.equal(context.getFiltered().length, 2569); assert.equal(cameraCalls.length, before);
context.applyDatabaseMapFilter([1, 2], 'test', 'test');
assert.equal(context.getFiltered().length, 2); assert.equal(cameraCalls.length, before);
context.clearDatabaseMapFilter();
assert.equal(cameraCalls.length, before);
context.fitToEstates(16, true);
assert.equal(cameraCalls.length, before + 1, 'Explicit show-all action still changes camera');
// Данные после правок из таблицы
const places = new Set(context.allData.map(d => d.servicePlace));
assert.ok(!places.has('Екатеринбургская штатная команда'), 'штатная команда заменена на горную');
assert.ok(!places.has('Казенные заводы'), 'в усадьбе 565 убраны лишние казённые заводы');
assert.equal(context.allData.filter(d => d.servicePlace === 'Екатеринбургская горная команда').length, 152 + 27 - 7);
for (const id of [22, 33, 52, 56, 88, 998, 1815]) assert.equal(context.allData.find(d => d.id === id).servicePlace, 'Екатеринбургская заводская команда');
// Алфавитный порядок для списков фильтров
for (const key of ['soslovie', 'buildingType', 'familyStatus', 'registrationPlace', 'servicePlace']) assert.equal(context.FILTERS.find(f => f.key === key).sort, 'alpha');
const sorted = ['Шарташский участок', 'Березовский', 'Екатеринбургская волость', 'Арамашевская волость'].sort((a, b) => vm.runInContext('RU_COLLATOR', context).compare(a, b));
assert.deepEqual(sorted, ['Арамашевская волость', 'Березовский', 'Екатеринбургская волость', 'Шарташский участок']);
console.log('PASS zoom-to-selection on filters, settlement fly, resets keep camera, data fixes, alphabetical sort.');
