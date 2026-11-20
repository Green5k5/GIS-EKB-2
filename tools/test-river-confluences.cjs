const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const K = {
  project(lat, lng) {
    const sin = Math.sin(lat * Math.PI / 180);
    return { x: (lng + 180) / 360, y: .5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI) };
  },
  Emitter: class {},
};
const context = { window: { Kartograf: K }, Kartograf: K,
  document: { readyState: 'loading', addEventListener() {} } };
vm.createContext(context);
for (const file of ['js/kartograf/layers.js', 'js/layers.js']) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), context);
}
const source = JSON.stringify(context.vectorLayersData);
const layer = context.window.createHistoricalLayer(context.vectorLayersData);
const receiving = layer.features.filter(f => f.name === 'Исеть');
let checked = 0;
for (const tributary of layer.features.filter(f => f.joinTo)) {
  const line = tributary.lines[0];
  const px = line[line.length - 2], py = line[line.length - 1];
  let distance = Infinity;
  for (const main of receiving) for (const points of main.lines) {
    for (let i = 2; i < points.length; i += 2) {
      const ax = points[i - 2], ay = points[i - 1];
      const dx = points[i] - ax, dy = points[i + 1] - ay;
      if (!dx && !dy) continue;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
      distance = Math.min(distance, Math.hypot(px - ax - t * dx, py - ay - t * dy));
    }
  }
  assert.ok(distance < 1e-12, `${tributary.name}: mouth must touch the smoothed Iset`);
  assert.ok(px >= tributary.bbox[0] && px <= tributary.bbox[2]);
  assert.ok(py >= tributary.bbox[1] && py <= tributary.bbox[3]);
  const head = K.project(...context.vectorLayersData.rivers.find(r => r.name === tributary.name).lines[0][0]);
  assert.equal(line[0], head.x);
  assert.equal(line[1], head.y);
  checked++;
}
assert.equal(checked, 4);
assert.equal(JSON.stringify(context.vectorLayersData), source, 'Source and published geometries must remain unchanged');
const isolated = context.window.createHistoricalLayer({ rivers: [context.vectorLayersData.rivers[0]], streets: [], fortress: [] });
assert.ok(isolated.features[0].lines[0].every(Number.isFinite));
console.log('PASS All four tributaries meet the smoothed Iset; bounds, headwaters and source data are preserved.');
