import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { loadEnv } from './env.js';
loadEnv();
import { db, initDb } from './db.js';

const root = path.resolve('.');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
function evalJsFile(file, names) {
  const code = read(file);
  const sandbox = { window: {}, document: { readyState: 'complete', addEventListener() {} }, console, setTimeout() {}, clearTimeout() {}, requestAnimationFrame() {} };
  vm.createContext(sandbox);
  vm.runInContext(`${code}\n;globalThis.__out = {${names.map(n => `${n}: typeof ${n} !== 'undefined' ? ${n} : undefined`).join(',')}};`, sandbox, { timeout: 10000 });
  return sandbox.__out;
}

function extractArray(file, marker, endMarker = '];') {
  const code = read(file);
  const start = code.indexOf(marker);
  if (start < 0) throw new Error(`Не найден ${marker}`);
  const from = code.indexOf('[', start);
  const end = code.indexOf(endMarker, from) + 1;
  return code.slice(from, end);
}

initDb();
const records = evalJsFile('js/data-records.js', ['allData']).allData;
const polys = evalJsFile('js/data-polygons.js', ['ekbPolygons', 'niPolygons', 'uktPolygons']);
const layers = evalJsFile('js/layers.js', ['vectorLayersData']).vectorLayersData;
const data = evalJsFile('js/data.js', ['COLORS']).COLORS || {};
const glossary = evalJsFile('js/glossary.js', ['GLOSSARY_ADDITIONS', 'GLOSSARY_TERM_ALIASES']);
const glossaryMap = evalJsFile('js/glossary-map.js', ['GLOSSARY_FILTER_MAP']).GLOSSARY_FILTER_MAP || {};

const boundsCode = extractArray('js/map.js', 'const SETTLEMENT_BOUNDS = {').replace(/^\[/, '[');
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
  db.exec(`
  DELETE FROM records;
  DELETE FROM plots;
  DELETE FROM historical_overlays;
  DELETE FROM historical_features;
  DELETE FROM glossary_terms;
  DELETE FROM releases;
  DELETE FROM settlements;
`);
  const insSettlement = tx('INSERT INTO settlements(id,slug,name,color,bounds_json,sort_order) VALUES(?,?,?,?,?,?)');
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

  const snapshot = makeSnapshot();
  db.prepare('INSERT INTO releases(snapshot_json,note) VALUES(?,?)').run(JSON.stringify(snapshot), 'Первичная миграция из статических JS-данных');
  db.exec('COMMIT');
  console.log(JSON.stringify({ ok:true, records: records.length, plots: plotGroups.reduce((n,[,g])=>n+Object.keys(g).length,0), features: Object.values(layers||{}).reduce((n,a)=>n+(a?.length||0),0), overlays: overlays.length, glossary: additions.length }, null, 2));
} catch (e) { db.exec('ROLLBACK'); throw e; }

function makeSnapshot() {
  const settlements = db.prepare('SELECT id,slug,name,color,bounds_json as bounds,sort_order as sortOrder FROM settlements WHERE active=1 ORDER BY sort_order').all().map(x=>({...x,bounds:JSON.parse(x.bounds)}));
  const plots = db.prepare("SELECT id,settlement_id as settlementId,legacy_key as legacyKey,geometry_json as geometry,focus_lat as focusLat,focus_lng as focusLng FROM plots WHERE status='active'").all().map(x=>({...x,geometry:JSON.parse(x.geometry)}));
  const records = db.prepare(`SELECT id,num,settlement_id as settlementId,street,building_type as buildingType,surname,name,patronymic,soslovie,family_status as familyStatus,sex,service_type as serviceType,rank,position,service_place as servicePlace,registration_place as registrationPlace,area_sazh,source,scan_url as scanUrl,lat,lng,plot_id as plotId FROM records WHERE status='active'`).all();
  const features = db.prepare('SELECT id,type,name,geometry_json as geometry,visible,sort_order as sortOrder FROM historical_features ORDER BY sort_order').all().map(x=>({...x,geometry:JSON.parse(x.geometry),visible:Boolean(x.visible)}));
  const overlays = db.prepare('SELECT id,file_url as fileUrl,settlement_id as settlementId,name,bounds_json as bounds,sort_order as sortOrder,opacity,visible FROM historical_overlays ORDER BY sort_order').all().map(x=>({...x,bounds:JSON.parse(x.bounds),visible:Boolean(x.visible)}));
  const glossary = db.prepare('SELECT id,term,category,description,aliases_json as aliases,filter_key as filterKey,filter_value as filterValue,sort_order as sortOrder FROM glossary_terms ORDER BY sort_order').all().map(x=>({...x,aliases:JSON.parse(x.aliases)}));
  return { schemaVersion:1, releaseId:null, settlements, records, plots, historicalFeatures:features, overlays, glossary, content:{}, settings:{} };
}
