import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

test('fresh workspace includes the source map; subsequent starts preserve edits and cleared maps', () => {
  const directory = fs.mkdtempSync(path.resolve('data/test-seed-'));
  const file = path.join(directory, 'seed.sqlite');
  const migrate = () => {
    const run = spawnSync(process.execPath, ['server/migrate.js'], {
      env: { ...process.env, DB_PATH: file }, encoding: 'utf8', windowsHide: true,
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);
  };
  let db;
  try {
    migrate();
    db = new DatabaseSync(file);
    const count = table => db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
    assert.equal(count('records'), 2569);
    assert.equal(count('plots'), 2571);
    assert.equal(count('historical_overlays'), 21);
    assert.equal(count('historical_features'), 56);
    assert.ok(count('glossary_terms') >= 75);
    assert.equal(count('settlements'), 3);
    for (const row of db.prepare('SELECT file_url FROM historical_overlays').all()) {
      assert.ok(fs.existsSync(row.file_url), row.file_url);
    }
    const release = JSON.parse(db.prepare('SELECT snapshot_json FROM releases').get().snapshot_json);
    assert.equal(release.records.length, 2569);
    assert.deepEqual(release.overlays[0].crop, [0, 0, 0, 0]);
    assert.ok('notes' in release.records[0]);
    db.prepare('UPDATE records SET surname=? WHERE id=1').run('Edited owner');
    migrate();
    assert.equal(db.prepare('SELECT surname FROM records WHERE id=1').get().surname, 'Edited owner');
    assert.equal(count('releases'), 1);
    db.exec('DELETE FROM records; DELETE FROM plots; DELETE FROM historical_overlays; DELETE FROM historical_features; DELETE FROM glossary_terms;');
    migrate();
    assert.equal(count('records'), 0);
    assert.equal(count('plots'), 0);
  } finally {
    db?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
