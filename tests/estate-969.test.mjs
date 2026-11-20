import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { estate969, repairEstate969 } from '../server/estate-969.js';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE records(id INTEGER PRIMARY KEY,settlement_id TEXT,num TEXT,status TEXT,lat REAL,lng REAL,plot_id INTEGER,surname TEXT);
    CREATE TABLE plots(id INTEGER PRIMARY KEY,settlement_id TEXT,legacy_key TEXT,geometry_json TEXT,focus_lat REAL,focus_lng REAL);
    CREATE TABLE releases(id INTEGER PRIMARY KEY,snapshot_json TEXT,note TEXT);
    INSERT INTO records VALUES(978,'ekb','969','active',56.8389,60.6057,NULL,'Изменённый владелец');`);
  const published = { records: [{ id: 978, settlementId: 'ekb', num: '969', lat: 56.8389, lng: 60.6057, plotId: null, surname: 'Щипицын' }, { id: 1, surname: 'Другой владелец' }], plots: [] };
  db.prepare('INSERT INTO releases VALUES(1,?,?)').run(JSON.stringify(published), 'Исходная версия');
  return db;
}

test('repairs 969 in workspace and published map without publishing pending edits or rewriting history', () => {
  const db = fixture();
  try {
    const original = db.prepare('SELECT snapshot_json FROM releases WHERE id=1').get().snapshot_json;
    assert.equal(repairEstate969(db), true);
    const record = db.prepare('SELECT * FROM records WHERE id=978').get();
    assert.equal(record.lat, estate969.lat);
    assert.equal(record.lng, estate969.lng);
    assert.ok(record.plot_id);
    assert.equal(record.surname, 'Изменённый владелец');
    const published = JSON.parse(db.prepare('SELECT snapshot_json FROM releases ORDER BY id DESC LIMIT 1').get().snapshot_json);
    assert.equal(published.records[0].surname, 'Щипицын');
    assert.equal(published.records[0].plotId, record.plot_id);
    assert.deepEqual(published.plots[0].geometry, estate969.geometry);
    assert.equal(db.prepare('SELECT snapshot_json FROM releases WHERE id=1').get().snapshot_json, original);
    assert.equal(repairEstate969(db), false);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM releases').get().n, 2);
  } finally { db.close(); }
});

test('preserves manual placement and does not resurrect an intentionally cleared map', () => {
  const db = fixture();
  try {
    db.prepare('UPDATE records SET lat=57 WHERE id=978').run();
    db.exec('DELETE FROM releases');
    assert.equal(repairEstate969(db), false);
    assert.equal(db.prepare('SELECT lat FROM records').get().lat, 57);
    db.exec('DELETE FROM records');
    assert.equal(repairEstate969(db), false);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM plots').get().n, 0);
  } finally { db.close(); }
});
