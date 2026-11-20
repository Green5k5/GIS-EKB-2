import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { loadEnv } from './env.js';
loadEnv();
import { db, initDb } from './db.js';
import { initWorkspace } from './workspace.js';
import { snapshot as makeSnapshot } from './snapshot.js';
import { repairEstate969 } from './estate-969.js';

const root = path.resolve('.');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
function evalJsFile(file, names) {
  const code = read(file);
  const sandbox = { window: {}, document: { readyState: 'complete', addEventListener() {}, getElementById() { return null; } }, console, setTimeout() {}, clearTimeout() {}, requestAnimationFrame() {} };
  vm.createContext(sandbox);
  vm.runInContext(`${code}\n;globalThis.__out = {${names.map(n => `${n}: typeof ${n} !== 'undefined' ? ${n} : undefined`).join(',')}};`, sandbox, { timeout: 10000 });
  return sandbox.__out;
}

initDb();
initWorkspace(db);
if (repairEstate969(db)) console.log('Estate 969: source coordinates and contour restored.');
// Never replace an existing workspace or resurrect an intentionally cleared map.
if (['records', 'plots', 'historical_overlays', 'historical_features', 'glossary_terms', 'releases'].some(table => db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n > 0)) {
  console.log('Existing workspace preserved; seed skipped.');
  process.exit(0);
}
const records = evalJsFile('js/data-records.js', ['allData']).allData;
const polys = evalJsFile('js/data-polygons.js', ['ekbPolygons', 'niPolygons', 'uktPolygons']);
const layers = evalJsFile('js/layers.js', ['vectorLayersData']).vectorLayersData;
const data = evalJsFile('js/data.js', ['COLORS']).COLORS || {};
const glossary = evalJsFile('js/glossary.js', ['GLOSSARY_ADDITIONS', 'GLOSSARY_TERM_ALIASES']);
const glossaryMap = evalJsFile('js/glossary-map.js', ['GLOSSARY_FILTER_MAP']).GLOSSARY_FILTER_MAP || {};

const mapText = read('js/map.js');
const boundsStart = mapText.indexOf('const SETTLEMENT_BOUNDS = ');
const boundsEnd = mapText.indexOf(';', boundsStart);
const bounds = vm.runInNewContext('({' + mapText.slice(boundsStart + 'const SETTLEMENT_BOUNDS = '.length, boundsEnd).replace(/^\s*\{/, '').replace(/\}\s*$/, '') + '})');

const settlements = [...new Set(records.map(r => r.settlement))].map((name, i) => ({
  id: name === 'Екатеринбург' ? 'ekb' : name === 'Нижне-Исетск' ? 'ni' : 'uktus',
  slug: name === 'Екатеринбург' ? 'ekb' : name === 'Нижне-Исетск' ? 'ni' : 'uktus',
  name, color: data[name] || null, bounds: bounds[name] || null, sortOrder: i
}));

const settlementByName = Object.fromEntries(settlements.map(s => [s.name, s.id]));
const plotGroups = [
  ['ekb', polys.ekbPolygons || {}], ['ni', polys.niPolygons || {}], ['uktus', polys.uktPolygons || {}]
];

const tx = (...args) => db.prepare(...args);
db.exec('BEGIN');
try {

  const insSettlement = tx('INSERT OR IGNORE INTO settlements(id,slug,name,color,bounds_json,sort_order) VALUES(?,?,?,?,?,?)');
  for (const s of settlements) insSettlement.run(s.id, s.slug, s.name, s.color, JSON.stringify(s.bounds), s.sortOrder);

  const insPlot = tx('INSERT INTO plots(settlement_id,legacy_key,geometry_json,focus_lat,focus_lng) VALUES(?,?,?,?,?)');
  const plotIdByKey = new Map();
  for (const [sid, group] of plotGroups) for (const [legacyKey, p] of Object.entries(group)) {
    const result = insPlot.run(sid, legacyKey, JSON.stringify({ type: 'Polygon', coordinates: [p.coords] }), p.clat ?? null, p.clng ?? null);
    plotIdByKey.set(`${sid}:${legacyKey}`, Number(result.lastInsertRowid));
  }

  const insRecord = tx(`INSERT INTO records(id,num,settlement_id,street,building_type,surname,name,patronymic,soslovie,family_status,sex,service_type,rank,position,service_place,registration_place,area_sazh,source,scan_url,lat,lng,plot_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const r of records) {
    const sid = settlementByName[r.settlement];
    const key = String(Math.round(parseFloat(r.num)));
    const plotId = plotIdByKey.get(`${sid}:${key}`) ?? null;
    insRecord.run(r.id, String(r.num ?? ''), sid, r.street ?? '', r.buildingType ?? '', r.surname ?? '', r.name ?? '', r.patronymic ?? '', r.soslovie ?? '', r.familyStatus ?? '', r.sex ?? '', r.serviceType ?? '', r.rank ?? '', r.position ?? '', r.servicePlace ?? '', r.registrationPlace ?? '', r.area_sazh ?? null, r.source ?? '', r.scanUrl ?? '', r.lat ?? null, r.lng ?? null, plotId);
  }

  const insFeature = tx('INSERT INTO historical_features(type,name,geometry_json,sort_order) VALUES(?,?,?,?)');
  let featureOrder = 0;
  for (const [type, items] of Object.entries(layers || {})) for (const item of items || []) {
    insFeature.run(type, item.name || '', JSON.stringify({ type: 'MultiLineString', coordinates: item.lines || [] }), featureOrder++);
  }

  const overlayText = mapText.slice(mapText.indexOf('const HISTORICAL_OVERLAYS = '));
  const overlayStart = overlayText.indexOf('[');
  const overlayEnd = overlayText.indexOf('];', overlayStart) + 1;
  let overlayLiteral = overlayText.slice(overlayStart, overlayEnd).replace(/overlayUrl\("([^"]+)"\)/g, '"assets/overlays-lite/$1"');
  const overlays = vm.runInNewContext(overlayLiteral);
  const insOverlay = tx('INSERT INTO historical_overlays(file_url,settlement_id,name,bounds_json,sort_order) VALUES(?,?,?,?,?)');
  for (let i=0;i<overlays.length;i++) {
    const o = overlays[i];
    const file = String(o.url || '').split('/').pop();
    const sid = file.startsWith('ekb-') ? 'ekb' : file.startsWith('ni-') ? 'ni' : file.startsWith('uktus-') ? 'uktus' : null;
    insOverlay.run(o.url, sid, file, JSON.stringify(o.bounds), i);
  }

  const insGlossary = tx('INSERT INTO glossary_terms(term,category,description,aliases_json,filter_key,filter_value,sort_order) VALUES(?,?,?,?,?,?,?)');
  const additions = glossary.GLOSSARY_ADDITIONS || [];
  for (let i=0;i<additions.length;i++) {
    const g = additions[i]; const map = glossaryMap[g.term] || {};
    const aliases = Object.entries(glossary.GLOSSARY_TERM_ALIASES || {}).filter(([,v]) => v === g.term).map(([k]) => k);
    const filterKey = typeof map.filterKey === 'string' ? map.filterKey : null; const filterValue = (typeof map.filterValue === 'string' || typeof map.filterValue === 'number') ? String(map.filterValue) : null; insGlossary.run(g.term, g.category || '', g.description || '', JSON.stringify(aliases), filterKey, filterValue, i);
  }

  const snapshot = makeSnapshot(db);
  db.prepare('INSERT INTO releases(snapshot_json,note) VALUES(?,?)').run(JSON.stringify(snapshot), 'Первичная миграция из статических JS-данных');
  db.exec('COMMIT');
  console.log(JSON.stringify({ ok:true, records: records.length, plots: plotGroups.reduce((n,[,g])=>n+Object.keys(g).length,0), features: Object.values(layers||{}).reduce((n,a)=>n+(a?.length||0),0), overlays: overlays.length, glossary: additions.length }, null, 2));
} catch (e) { db.exec('ROLLBACK'); throw e; }
