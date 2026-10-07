import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : fileURLToPath(new URL('./gis-ekb.sqlite', import.meta.url));

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);

db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settlements (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT UNIQUE NOT NULL,
      color TEXT,
      bounds_json TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY,
      num TEXT NOT NULL,
      settlement_id TEXT NOT NULL,
      street TEXT NOT NULL DEFAULT '',
      building_type TEXT NOT NULL DEFAULT '',
      surname TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      patronymic TEXT NOT NULL DEFAULT '',
      soslovie TEXT NOT NULL DEFAULT '',
      family_status TEXT NOT NULL DEFAULT '',
      sex TEXT NOT NULL DEFAULT '',
      service_type TEXT NOT NULL DEFAULT '',
      rank TEXT NOT NULL DEFAULT '',
      position TEXT NOT NULL DEFAULT '',
      service_place TEXT NOT NULL DEFAULT '',
      registration_place TEXT NOT NULL DEFAULT '',
      area_sazh REAL,
      source TEXT NOT NULL DEFAULT '',
      scan_url TEXT NOT NULL DEFAULT '',
      lat REAL,
      lng REAL,
      plot_id INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (settlement_id) REFERENCES settlements(id),
      FOREIGN KEY (plot_id) REFERENCES plots(id)
    );

    CREATE TABLE IF NOT EXISTS plots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      settlement_id TEXT NOT NULL,
      legacy_key TEXT NOT NULL,
      geometry_json TEXT NOT NULL,
      focus_lat REAL,
      focus_lng REAL,
      status TEXT NOT NULL DEFAULT 'active',
      UNIQUE(settlement_id, legacy_key),
      FOREIGN KEY (settlement_id) REFERENCES settlements(id)
    );

    CREATE TABLE IF NOT EXISTS historical_features (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      geometry_json TEXT NOT NULL,
      visible INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS historical_overlays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_url TEXT NOT NULL,
      settlement_id TEXT,
      name TEXT NOT NULL DEFAULT '',
      bounds_json TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      opacity REAL NOT NULL DEFAULT 1,
      visible INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (settlement_id) REFERENCES settlements(id)
    );

    CREATE TABLE IF NOT EXISTS glossary_terms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      term TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      aliases_json TEXT NOT NULL DEFAULT '[]',
      filter_key TEXT,
      filter_value TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS site_content (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS releases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      snapshot_json TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      kind TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      report_json TEXT NOT NULL DEFAULT '{}',
      payload_json TEXT NOT NULL DEFAULT '{}'
    );
  `);
}





