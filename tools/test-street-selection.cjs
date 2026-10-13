const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const context = { window: {addEventListener() {}}, document: {readyState: 'loading', addEventListener() {}} };
vm.createContext(context);
for (const file of ['js/data-records.js', 'js/street-selection.js', 'js/layers.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), context);
let checked = 0;
for (const [label, expected] of [['Ломаевска', 210], ['Богоявленска', 8], ['Коробковска', 68], ['Большая', 152], ['Проломская', 70], ['Студена', 36], ['Нова', 113]]) {
  const match = context.resolveHistoricStreet(label);
  assert.equal(match.direct.ids.length, expected, label);
  assert.equal(new Set(match.direct.ids).size, expected);
  for (const id of match.direct.ids) assert.equal(context.allData.find(row => row.id === id).settlement, 'Екатеринбург');
  checked++;
}
const ambiguous = context.resolveHistoricStreet('Береговая');
assert.equal(ambiguous.direct, null);
assert.deepEqual(Array.from(ambiguous.candidates, group => group.ids.length), [28, 40]); checked++;
const spelling = context.resolveHistoricStreet('Зыряновска');
assert.equal(spelling.direct, null); assert.equal(spelling.candidates[0].ids.length, 63); checked++;
const unknown = context.resolveHistoricStreet('Вознесенская');
assert.equal(unknown.direct, null); assert.equal(unknown.candidates.length, 0); checked++;
for (const street of context.vectorLayersData.streets) {
  const match = context.resolveHistoricStreet(street.name);
  for (const group of match.candidates) {
    for (const id of group.ids) {
      const row = context.allData.find(row => row.id === id);
      assert.ok(group.values.has(row.street));
    }
  }
}
context.window.Kartograf = {project(lat, lng) {return {x: lng, y: lat};}, Emitter: class {}};
vm.runInContext(fs.readFileSync('js/kartograf/layers.js', 'utf8'), context);
let clicked = null, renders = 0;
const layer = new context.window.Kartograf.HistoricLayer([
  {kind: 'street', streetName: 'Ломаевска', label: 'ул. Ломаевска', lines: [[[0, 0], [0, 1]]]}
], {spec: {street: {widthM: 0, minPx: [[10, 3]], maxPx: 10}}, palettes: {light: {}, dark: {}}, onFeatureClick(feature) {clicked = feature; return true;}});
layer._map = {requestRender() {renders++;}};
const hit = layer.hitTest(100, 100, 5, {cx: .5, cy: 0, ws: 100, W: 200, H: 200, zoom: 17});
assert.equal(hit.streetName, 'Ломаевска');
layer.onHit(hit, {point: {x: 100, y: 100}, latlng: {lat: 0, lng: .5}});
assert.equal(clicked, hit);
layer.setSelectedStreet(hit.id); assert.equal(layer.selectedStreetId, hit.id);
layer.setSelectedStreet(null); assert.equal(layer.selectedStreetId, null); assert.equal(renders, 2);
console.log(`PASS ${checked} representative mappings, all ${context.vectorLayersData.streets.length} street geometries, line hit testing, click dispatch and selection clearing.`);
