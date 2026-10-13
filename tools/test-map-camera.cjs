const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const cameraCalls = [];
const context = {
  window: {map: {fitBounds() {cameraCalls.push('fit');}}, matchMedia() {return {matches: false};}},
  document: {addEventListener() {}, getElementById() {return null;}},
  estateLayer: {getLayers() {return [{}];}, getBounds() {return {isValid() {return true;}};}},
  flyToSettlement(name) {cameraCalls.push(name);},
  matchesSearch() {return true;}, closeSelected() {}
};
vm.createContext(context);
for (const path of ['js/data-records.js', 'js/data.js', 'js/filters.js', 'js/app.js']) vm.runInContext(fs.readFileSync(path, 'utf8'), context);
for (const name of ['renderFilters', 'renderActiveTags', 'renderMap', 'updateStats', 'renderDatabaseMapFilter', 'renderInfographics']) context[name] = () => {};
context.initFiltersState();
context.toggle('soslovie', 'Купцы');
assert.equal(context.getFiltered().length, 122); assert.deepEqual(cameraCalls, []);
context.toggle('sex', 'Женщины');
assert.equal(context.getFiltered().length, 18); assert.deepEqual(cameraCalls, []);
context.toggle('sex', 'Женщины');
context.toggle('settlement', 'Екатеринбург');
assert.deepEqual(cameraCalls, ['Екатеринбург']);
context.toggle('settlement', 'Екатеринбург');
assert.deepEqual(cameraCalls, ['Екатеринбург'], 'Removing settlement must preserve camera');
context.resetAllFilters();
assert.equal(context.getFiltered().length, 2569); assert.deepEqual(cameraCalls, ['Екатеринбург']);
context.applyDatabaseMapFilter([1, 2], 'test', 'test');
assert.equal(context.getFiltered().length, 2); assert.deepEqual(cameraCalls, ['Екатеринбург']);
context.clearDatabaseMapFilter();
assert.deepEqual(cameraCalls, ['Екатеринбург']);
context.fitToEstates(16, true);
assert.deepEqual(cameraCalls, ['Екатеринбург', 'fit'], 'Explicit show-all action still changes camera');
console.log('PASS camera is preserved for class/sex filters, resets and selection changes; settlement selection and explicit fit still work.');
