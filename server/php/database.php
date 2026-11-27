<?php
declare(strict_types=1);

const GIS_ROOT = __DIR__ . '/../..';
const RECORD_FIELDS = [
    'num'=>'num', 'settlementId'=>'settlement_id', 'street'=>'street', 'buildingType'=>'building_type',
    'surname'=>'surname', 'name'=>'name', 'patronymic'=>'patronymic', 'soslovie'=>'soslovie',
    'familyStatus'=>'family_status', 'sex'=>'sex', 'serviceType'=>'service_type', 'rank'=>'rank',
    'position'=>'position', 'servicePlace'=>'service_place', 'registrationPlace'=>'registration_place',
    'area_sazh'=>'area_sazh', 'source'=>'source', 'scanUrl'=>'scan_url', 'lat'=>'lat', 'lng'=>'lng',
    'plotId'=>'plot_id', 'notes'=>'notes', 'extra'=>'extra_json', 'sourceData'=>'source_data_json',
    'sourceKey'=>'source_key', 'localEdit'=>'local_edit', 'issues'=>'issues_json',
];
const NUMBER_FIELDS = ['area_sazh', 'lat', 'lng', 'plotId'];

function settings(): array
{
    static $values;
    if ($values !== null) return $values;
    $values = is_file(GIS_ROOT . '/.env') ? parse_ini_file(GIS_ROOT . '/.env', false, INI_SCANNER_RAW) : [];
    foreach (['ADMIN_KEY', 'NODE_ENV', 'APP_ENV', 'DB_PATH', 'GIS_DATA_DIR', 'SESSION_TTL_HOURS'] as $key) {
        if (getenv($key) !== false) $values[$key] = getenv($key);
    }
    return $values;
}

function encode(mixed $value): string
{
    return json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

function decode(string $value): mixed
{
    return json_decode($value, true, 512, JSON_THROW_ON_ERROR);
}

function directory(string $name): string
{
    if (!is_dir($name) && !@mkdir($name, 0700, true) && !is_dir($name)) {
        throw new RuntimeException('Не удалось создать каталог данных.');
    }
    return $name;
}

function projectPath(string $path): string
{
    return str_starts_with($path, '/') ? $path : GIS_ROOT . '/' . $path;
}

function dataPath(string $relative): string
{
    return projectPath((settings()['GIS_DATA_DIR'] ?? '') ?: 'data') . '/' . $relative;
}

function db(): PDO
{
    static $connection;
    if ($connection !== null) return $connection;
    $file = projectPath((settings()['DB_PATH'] ?? '') ?: 'server/gis-ekb.sqlite');
    $connection = new PDO('sqlite:' . $file, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_TIMEOUT => 10,
    ]);
    $connection->exec('PRAGMA foreign_keys=ON');
    return $connection;
}

function query(string $sql, array $parameters = []): PDOStatement
{
    $statement = db()->prepare($sql);
    foreach (array_values($parameters) as $index => $value) {
        $type = match (true) {
            $value === null => PDO::PARAM_NULL,
            is_int($value), is_bool($value) => PDO::PARAM_INT,
            default => PDO::PARAM_STR,
        };
        $statement->bindValue($index + 1, $value, $type);
    }
    $statement->execute();
    return $statement;
}

function all(string $sql, array $parameters = []): array
{
    return query($sql, $parameters)->fetchAll();
}

function one(string $sql, array $parameters = []): ?array
{
    return query($sql, $parameters)->fetch() ?: null;
}

function insert(string $sql, array $parameters = []): int
{
    query($sql, $parameters);
    return (int) db()->lastInsertId();
}

function transaction(callable $operation): mixed
{
    db()->exec('BEGIN IMMEDIATE');
    try {
        $result = $operation();
        db()->exec('COMMIT');
        return $result;
    } catch (Throwable $error) {
        db()->exec('ROLLBACK');
        throw $error;
    }
}

function record(array $row): array
{
    $result = ['id'=>$row['id'], 'status'=>$row['status']];
    foreach (RECORD_FIELDS as $key => $column) {
        $result[$key] = match ($key) {
            'extra', 'sourceData' => (object) decode($row[$column] ?: '{}'),
            'issues' => decode($row[$column] ?: '[]'),
            default => $row[$column],
        };
    }
    return $result;
}

function saveRecord(array $row, ?int $id, bool $localEdit): int
{
    $values = [];
    foreach (RECORD_FIELDS as $key => $column) {
        $values[] = match ($key) {
            'extra', 'sourceData' => encode((object) ($row[$key] ?? [])),
            'issues' => encode(array_values($row[$key] ?? [])),
            'localEdit' => (int) $localEdit,
            default => $row[$key] ?? (in_array($key, NUMBER_FIELDS, true) ? null : ''),
        };
    }
    $columns = array_values(RECORD_FIELDS);
    if ($id !== null) {
        $set = implode('=?,', $columns) . '=?';
        query("UPDATE records SET $set,status='active',updated_at=CURRENT_TIMESTAMP WHERE id=?", [...$values, $id]);
        return $id;
    }
    return insert('INSERT INTO records(' . implode(',', $columns) . ') VALUES(' .
        implode(',', array_fill(0, count($values), '?')) . ')', $values);
}

function snapshot(): array
{
    $settlements = all('SELECT id,slug,name,color,bounds_json AS bounds,sort_order AS sortOrder FROM settlements WHERE active=1 ORDER BY sort_order');
    foreach ($settlements as &$settlement) $settlement['bounds'] = decode($settlement['bounds'] ?? 'null');
    unset($settlement);

    $plots = all("SELECT id,settlement_id AS settlementId,legacy_key AS legacyKey,geometry_json AS geometry,focus_lat AS focusLat,focus_lng AS focusLng FROM plots WHERE status='active' ORDER BY id");
    foreach ($plots as &$plot) $plot['geometry'] = decode($plot['geometry']);
    unset($plot);

    $features = all('SELECT id,type,name,geometry_json AS geometry,visible,sort_order AS sortOrder FROM historical_features ORDER BY sort_order');
    foreach ($features as &$feature) {
        $feature['geometry'] = decode($feature['geometry']);
        $feature['visible'] = (bool) $feature['visible'];
    }
    unset($feature);

    $overlays = all('SELECT id,file_url AS fileUrl,settlement_id AS settlementId,name,bounds_json AS bounds,sort_order AS sortOrder,opacity,visible,rotation,crop_json FROM historical_overlays ORDER BY sort_order');
    foreach ($overlays as &$overlay) {
        $overlay['bounds'] = decode($overlay['bounds']);
        $overlay['crop'] = decode($overlay['crop_json']);
        $overlay['visible'] = (bool) $overlay['visible'];
    }
    unset($overlay);

    $glossary = all('SELECT id,term,category,description,aliases_json AS aliases,filter_key AS filterKey,filter_value AS filterValue,sort_order AS sortOrder FROM glossary_terms ORDER BY sort_order');
    foreach ($glossary as &$term) $term['aliases'] = decode($term['aliases']);
    unset($term);

    $content = [];
    foreach (all('SELECT key,value_json FROM site_content') as $item) $content[$item['key']] = decode($item['value_json']);
    return [
        'schemaVersion'=>1, 'releaseId'=>null, 'settlements'=>$settlements,
        'records'=>array_map('record', all("SELECT * FROM records WHERE status='active' ORDER BY id")),
        'plots'=>$plots, 'historicalFeatures'=>$features, 'overlays'=>$overlays,
        'glossary'=>$glossary, 'content'=>(object) $content, 'settings'=>(object) [],
        'warnings'=>all('SELECT id,settlement_id AS settlementId,message FROM workspace_warnings WHERE resolved=0 ORDER BY id'),
    ];
}

function revision(): string
{
    return hash('sha256', encode([
        all('SELECT * FROM records ORDER BY id'), all('SELECT * FROM plots ORDER BY id'),
        all('SELECT * FROM site_content ORDER BY key'), all('SELECT * FROM historical_overlays ORDER BY id'),
    ]));
}

function publish(string $note): int
{
    return insert('INSERT INTO releases(snapshot_json,note) VALUES(?,?)', [encode(snapshot()), $note]);
}

function backup(): string
{
    $filename = gmdate('Y-m-d\TH-i-s') . '-' . bin2hex(random_bytes(6)) . '.sqlite';
    $path = directory(dataPath('backups')) . '/' . $filename;
    $temporary = $path . '.tmp';
    try {
        $version = (string) db()->query('SELECT sqlite_version()')->fetchColumn();
        if (version_compare($version, '3.27.0', '>=')) {
            db()->exec('VACUUM INTO ' . db()->quote($temporary));
        } else {
            copyLegacyDatabase($temporary);
        }
        if (!rename($temporary, $path)) throw new RuntimeException('Не удалось сохранить резервную копию SQLite.');
    } finally {
        if (is_file($temporary)) unlink($temporary);
    }
    return $filename;
}

function copyLegacyDatabase(string $destination): void
{
    query('ATTACH DATABASE ? AS backup', [$destination]);
    try {
        db()->exec('PRAGMA foreign_keys=OFF');
        transaction(static function () {
            // Tables precede indexes, views and triggers so inserts only copy data.
            $schema = all("SELECT type,name,sql FROM main.sqlite_master WHERE sql IS NOT NULL
                AND name NOT GLOB 'sqlite_*' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END,rowid");
            foreach ($schema as $object) {
                $sql = preg_replace('~\ACREATE (?:UNIQUE )?(?:TABLE|INDEX|VIEW|TRIGGER) (?:IF NOT EXISTS )?~i',
                    '$0backup.', $object['sql'], 1, $matched);
                if (!$matched) throw new RuntimeException('Не удалось скопировать схему SQLite: ' . $object['name']);
                db()->exec($sql);
                if ($object['type'] === 'table') {
                    $name = '"' . str_replace('"', '""', $object['name']) . '"';
                    db()->exec("INSERT INTO backup.$name SELECT * FROM main.$name");
                }
            }
            if (one("SELECT 1 FROM main.sqlite_master WHERE name='sqlite_sequence'")) {
                db()->exec('DELETE FROM backup.sqlite_sequence');
                db()->exec('INSERT INTO backup.sqlite_sequence SELECT * FROM main.sqlite_sequence');
            }
            foreach (['user_version', 'application_id'] as $pragma) {
                $value = (int) db()->query("PRAGMA main.$pragma")->fetchColumn();
                db()->exec("PRAGMA backup.$pragma=$value");
            }
        });
    } finally {
        db()->exec('PRAGMA foreign_keys=ON');
        db()->exec('DETACH DATABASE backup');
    }
}

function saveSiteContent(string $key, mixed $value): void
{
    query('INSERT INTO site_content(key,value_json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json', [$key, encode($value)]);
}

function restoreSnapshot(array $source, bool $seed = false): void
{
    if (!$seed) {
        db()->exec("UPDATE records SET status='archived'; UPDATE plots SET status='archived';
            UPDATE settlements SET active=0; DELETE FROM historical_overlays; DELETE FROM historical_features;
            DELETE FROM workspace_warnings; DELETE FROM site_content; DELETE FROM glossary_terms");
    }
    foreach ($source['settlements'] as $s) {
        query('INSERT INTO settlements(id,slug,name,color,bounds_json,sort_order,active) VALUES(?,?,?,?,?,?,1)
            ON CONFLICT(id) DO UPDATE SET slug=excluded.slug,name=excluded.name,color=excluded.color,
            active=1,bounds_json=excluded.bounds_json,sort_order=excluded.sort_order',
            [$s['id'], $s['slug'] ?? $s['id'], $s['name'], $s['color'] ?? null, encode($s['bounds']), $s['sortOrder'] ?? 0]);
    }
    foreach ($source['plots'] as $p) {
        query("INSERT INTO plots(id,settlement_id,legacy_key,geometry_json,focus_lat,focus_lng) VALUES(?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET geometry_json=excluded.geometry_json,focus_lat=excluded.focus_lat,
            focus_lng=excluded.focus_lng,status='active'",
            [$p['id'], $p['settlementId'], $p['legacyKey'], encode($p['geometry']), $p['focusLat'], $p['focusLng']]);
    }
    foreach ($source['records'] as $row) {
        query('INSERT OR IGNORE INTO records(id,num,settlement_id) VALUES(?,?,?)', [$row['id'], $row['num'], $row['settlementId']]);
        saveRecord($row, $row['id'], (bool) ($row['localEdit'] ?? false));
    }
    foreach ($source['overlays'] ?? [] as $o) {
        query('INSERT INTO historical_overlays(id,file_url,settlement_id,name,bounds_json,opacity,visible,sort_order,rotation,crop_json) VALUES(?,?,?,?,?,?,?,?,?,?)',
            [$o['id'], $o['fileUrl'], $o['settlementId'] ?? null, $o['name'], encode($o['bounds']),
                $o['opacity'], (int) $o['visible'], $o['sortOrder'] ?? 0, $o['rotation'] ?? 0, encode($o['crop'] ?? [0,0,0,0])]);
    }
    foreach ($source['historicalFeatures'] ?? [] as $f) {
        query('INSERT INTO historical_features(id,type,name,geometry_json,visible,sort_order) VALUES(?,?,?,?,?,?)',
            [$f['id'], $f['type'], $f['name'], encode($f['geometry']), (int) $f['visible'], $f['sortOrder'] ?? 0]);
    }
    foreach ($source['glossary'] ?? [] as $g) {
        query('INSERT INTO glossary_terms(id,term,category,description,aliases_json,filter_key,filter_value,sort_order) VALUES(?,?,?,?,?,?,?,?)',
            [$g['id'], $g['term'], $g['category'], $g['description'], encode($g['aliases']),
                $g['filterKey'], $g['filterValue'], $g['sortOrder'] ?? 0]);
    }
    foreach ($source['content'] ?? [] as $key => $value) saveSiteContent($key, $value);
    foreach ($source['warnings'] ?? [] as $w) {
        query('INSERT INTO workspace_warnings(settlement_id,batch_id,message) VALUES(?,?,?)', [$w['settlementId'] ?? null, 'restore', $w['message']]);
    }
}

function migrate(): bool
{
    directory(dirname(projectPath((settings()['DB_PATH'] ?? '') ?: 'server/gis-ekb.sqlite')));
    directory(dataPath('uploads'));
    directory(dataPath('backups'));
    db()->exec('PRAGMA journal_mode=WAL');
    return transaction(function () {
        db()->exec(file_get_contents(__DIR__ . '/schema.sql'));
        $additions = [
            'records'=>['notes'=>"TEXT NOT NULL DEFAULT ''", 'extra_json'=>"TEXT NOT NULL DEFAULT '{}'",
                'source_data_json'=>"TEXT NOT NULL DEFAULT '{}'", 'source_key'=>"TEXT NOT NULL DEFAULT ''",
                'local_edit'=>'INTEGER NOT NULL DEFAULT 0', 'issues_json'=>"TEXT NOT NULL DEFAULT '[]'"],
            'historical_overlays'=>['rotation'=>'REAL NOT NULL DEFAULT 0', 'crop_json'=>"TEXT NOT NULL DEFAULT '[0,0,0,0]'"],
        ];
        foreach ($additions as $table => $columns) {
            $existing = array_column(all("PRAGMA table_info($table)"), 'name');
            foreach ($columns as $name => $definition) {
                if (!in_array($name, $existing, true)) db()->exec("ALTER TABLE $table ADD COLUMN $name $definition");
            }
        }
        foreach (['records', 'plots', 'historical_overlays', 'historical_features', 'glossary_terms', 'releases'] as $table) {
            if (one("SELECT 1 FROM $table LIMIT 1")) return false;
        }
        restoreSnapshot(decode(gzdecode(file_get_contents(__DIR__ . '/seed.json.gz'))), true);
        publish('Первичная миграция из исходного набора ГИС');
        return true;
    });
}
