<?php
declare(strict_types=1);

function uuid(): string
{
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
}

function batchDirectory(string $id): string
{
    return dataPath('uploads/batch-' . $id);
}

function batchScope(): string
{
    $row = array_column(all('PRAGMA database_list'), 'file', 'name');
    return hash('sha256', $row['main'] ?: 'main');
}

function fileKind(string $name): ?array
{
    [$kind, $label] = match (extension($name)) {
        'xlsx','xls','csv' => ['table','Таблица усадеб'],
        'shp','dbf','prj','cpg','shx' => ['shape','Комплект контуров'],
        'qgz' => ['project','Проект QGIS'],
        'tif','tiff' => ['raster','План с привязкой'],
        'jpg','jpeg','png','webp' => ['image','Изображение · размещение вручную'],
        'zip' => ['archive','Архив файлов'],
        default => [null,null],
    };
    return $kind === null ? null : ['kind'=>$kind, 'label'=>$label];
}

function loadBatch(string $id): ?array
{
    $manifest = batchDirectory($id) . '/manifest.json';
    if (!is_file($manifest)) return null;
    $batch = decode(file_get_contents($manifest));
    if (isset($batch['scope']) && $batch['scope'] !== batchScope()) return null;
    if ($batch['status'] === 'analyzing' && empty($batch['analysisToken'])) {
        $batch['status'] = 'uploading';
        $batch['progress'] = 'Проверка прервана. Можно запустить её снова.';
    }
    return $batch;
}

function storeBatch(array $batch): void
{
    $directory = batchDirectory($batch['id']);
    $temp = tempnam($directory, 'manifest-');
    try {
        if (file_put_contents($temp, encode($batch)) === false || !rename($temp, $directory . '/manifest.json')) {
            throw new RuntimeException('Не удалось сохранить набор файлов.');
        }
    } finally {
        if (is_file($temp)) unlink($temp);
    }
}

function batchInfo(array $batch): array
{
    $batch['files'] = array_map(static fn($file) => [
        'id'=>$file['id'], 'name'=>$file['name'], 'size'=>$file['size'],
        ...(fileKind($file['name']) ?? []),
    ], $batch['files']);
    unset($batch['scope'], $batch['directory'], $batch['analysisToken']);
    return $batch;
}

function batchFile(array $batch, string $id): array
{
    foreach ($batch['files'] as $file) {
        if ($file['id'] === $id) return $file;
    }
    fail('Файл не найден.', 404);
}

function fileLocation(string $directory, array $file): string
{
    $id = $file['id'];
    $candidates = glob($directory . '/' . $id . '.*');
    foreach ($candidates ?: [] as $candidate) {
        if (is_file($candidate) && extension($candidate) === extension($file['name'])) return $candidate;
    }
    return $directory . '/' . $id . '.' . extension($file['name']);
}

function replaceBatchFiles(array &$batch, array $entries): array
{
    $replaced = [];
    foreach ($entries as $entry) {
        foreach ($batch['files'] as $index => $previous) {
            if (strcasecmp($previous['name'], $entry['name']) === 0) {
                $replaced[] = $previous;
                unset($batch['files'][$index]);
                break;
            }
        }
        $batch['files'][] = $entry;
    }
    $batch['files'] = array_values($batch['files']);
    return $replaced;
}

function deleteBatchFiles(string $dir, array $files): void
{
    foreach ($files as $file) {
        foreach ([fileLocation($dir, $file), "$dir/" . $file['id'] . '-preview.webp'] as $path) {
            if (is_file($path)) @unlink($path);
        }
    }
}

function saveBatchUpload(array &$batch, string $name): void
{
    if (!fileKind($name) || strlen($name) > 1000 || str_contains($name, "\0")) {
        throw new InvalidArgumentException('Некорректное имя или неподдерживаемый формат файла.');
    }
    $dir = batchDirectory($batch['id']);
    $file = ['id'=>uuid(), 'name'=>$name];
    $path = "$dir/" . $file['id'] . '.' . extension($name);
    $entries = [];
    try {
        uploadTo($path);
        if (extension($name) !== 'zip') {
            $entries = [$file + ['size'=>filesize($path)]];
        } else {
            $archive = new ZipArchive();
            if ($archive->open($path, ZipArchive::RDONLY) !== true) throw new InvalidArgumentException('Не удалось открыть ZIP.');
            try {
                for ($i = 0; $i < $archive->numFiles; $i++) {
                    $item = $archive->statIndex($i);
                    $name = $item['name'];
                    if (str_ends_with($name, '/')) continue;
                    $kind = fileKind($name);
                    if (!$kind || $kind['kind'] === 'archive') {
                        $batch['ignored'][] = ['name'=>$name, 'reason'=>'Этот формат загрузчик не обрабатывает'];
                        continue;
                    }
                    $entry = ['id'=>uuid(), 'name'=>$name, 'size'=>$item['size']];
                    $entries[] = $entry;
                    $source = $archive->getStreamIndex($i);
                    if (!$source) throw new InvalidArgumentException('Не удалось прочитать файл из ZIP.');
                    $target = fopen("$dir/" . $entry['id'] . '.' . extension($name), 'xb');
                    try {
                        if (stream_copy_to_stream($source, $target) !== $entry['size']) {
                            throw new InvalidArgumentException('Архив повреждён: не все файлы распакованы.');
                        }
                    } finally {
                        fclose($source);
                        fclose($target);
                    }
                }
            } finally {
                $archive->close();
                unlink($path);
            }
        }
        $previous = replaceBatchFiles($batch, $entries);
        storeBatch($batch);
        deleteBatchFiles($dir, $previous);
    } catch (Throwable $error) {
        if (is_file($path)) unlink($path);
        deleteBatchFiles($dir, $entries);
        throw $error;
    }
}

function editBatch(string $id, callable $operation): mixed
{
    $dir = batchDirectory($id);
    if (!is_dir($dir)) fail('Загрузка не найдена. Начните заново.', 404);
    $lock = fopen($dir . '/manifest.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX)) throw new RuntimeException('Не удалось открыть набор файлов.');
    try {
        $batch = loadBatch($id);
        if (!$batch) fail('Загрузка не найдена. Начните заново.', 404);
        return $operation($batch);
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

function startAnalysis(array &$batch, array $settings): array
{
    if (!in_array($batch['status'], ['uploading','analyzing','error'], true) || !$batch['files']) {
        throw new InvalidArgumentException('Сначала загрузите файлы.');
    }
    $batch['settlementName'] = (string) ($settings['settlementName'] ?? $batch['settlementName']);
    $batch['baseRevision'] = revision();
    $batch['status'] = 'analyzing';
    $batch['progress'] = 'Проверяем состав папки';
    $batch['error'] = null;
    $batch['result'] = null;
    $batch['analysisToken'] = bin2hex(random_bytes(24));
    storeBatch($batch);
    return ['ok'=>true, 'analysisToken'=>$batch['analysisToken'], 'batch'=>batchInfo($batch)];
}

function checkAnalysis(array $batch, string $token): void
{
    if ($batch['status'] !== 'analyzing' || !$token || !hash_equals($batch['analysisToken'] ?? '', $token)) {
        fail('Проверка этого набора уже изменилась. Запустите её ещё раз.', 409);
    }
}

function savePreview(array $batch, string $fileId): array
{
    checkAnalysis($batch, $_SERVER['HTTP_X_GIS_ANALYSIS'] ?? '');
    batchFile($batch, $fileId);
    $name = $fileId . '-preview.webp';
    $dest = batchDirectory($batch['id']) . '/' . $name;
    $temporary = $dest . '.' . uuid() . '.tmp';
    try {
        uploadTo($temporary);
        $info = @getimagesize($temporary);
        if (!$info || $info[2] !== IMAGETYPE_WEBP || max($info[0], $info[1]) > 4096) {
            throw new InvalidArgumentException('Не удалось подготовить превью WebP.');
        }
        if (!rename($temporary, $dest)) throw new RuntimeException('Не удалось сохранить превью.');
        return ['width'=>$info[0], 'height'=>$info[1], 'fileUrl'=>'/data/uploads/batch-' . $batch['id'] . '/' . $name];
    } finally {
        if (is_file($temporary)) unlink($temporary);
    }
}

function saveAnalysis(array &$batch, array $body): void
{
    checkAnalysis($batch, (string) ($body['analysisToken'] ?? ''));
    $result = $body['result'] ?? null;
    if (isset($body['error']) && is_string($body['error'])) {
        $batch['status'] = 'error';
        $batch['error'] = mb_substr($body['error'], 0, 12000, 'UTF-8');
    } else {
        foreach (['records','plots','overlays','settlements','warnings'] as $field) {
            if (!is_array($result[$field] ?? null) || !array_is_list($result[$field])) {
                throw new InvalidArgumentException('Некорректный предпросмотр набора.');
            }
        }
        $settlements = array_column($result['settlements'], null, 'id');
        $records = [];
        foreach ($result['settlements'] as $s) {
            if (!preg_match('~\A[a-z0-9-]+\z~', $s['id'] ?? '') || !is_string($s['name'] ?? null) ||
                !is_string($s['color'] ?? null)) throw new InvalidArgumentException('Некорректное поселение.');
        }
        foreach ($result['records'] as $row) {
            if (!is_string($row['num'] ?? null) || !isset($settlements[$row['settlementId'] ?? ''])) {
                throw new InvalidArgumentException('Номер или поселение не найдены.');
            }
            $records[$row['settlementId'] . ':' . $row['num']] = true;
        }
        foreach ($result['plots'] as $plot) {
            if (empty($records[$plot['recordKey'] ?? ''])) throw new InvalidArgumentException('Контур не связан с усадьбой.');
            geometryBounds($plot['geometry']);
        }
        foreach ($result['overlays'] as $plan) {
            $id = batchFile($batch, $plan['sourceFileId'])['id'];
            $expected = '/data/uploads/batch-' . $batch['id'] . '/' . $id . '-preview.webp';
            if ($plan['fileUrl'] !== $expected || !is_string($plan['name'] ?? null)) {
                throw new InvalidArgumentException('План не найден в этом наборе.');
            }
            imagePath($plan['fileUrl']);
            validatePlan($plan);
        }
        $result['conflicts'] = array_values(array_filter(
            all("SELECT settlement_id,num FROM records WHERE status='active' AND local_edit=1"),
            static fn($row) => isset($records[$row['settlement_id'] . ':' . $row['num']]),
        ));
        $batch['result'] = $result;
        $batch['status'] = 'ready';
        $batch['progress'] = 'Готово к добавлению';
    }
    unset($batch['analysisToken']);
    storeBatch($batch);
}

function applyBatch(array &$batch, array $options): array
{
    if ($batch['status'] !== 'ready') throw new InvalidArgumentException('Дождитесь проверки файлов.');
    if ($batch['baseRevision'] !== revision()) fail('Данные изменились после проверки. Загрузите набор заново.', 409);
    $copy = backup();
    $data = $batch['result'];
    $out = transaction(function () use ($batch, $data, $options) {
        if ($batch['baseRevision'] !== revision()) fail('Данные изменились после проверки. Загрузите набор заново.', 409);
        foreach ($data['settlements'] as $s) {
            query('INSERT INTO settlements(id,slug,name,color,bounds_json,active) VALUES(?,?,?,?,?,1)
                ON CONFLICT(id) DO UPDATE SET name=excluded.name,bounds_json=excluded.bounds_json,active=1',
                [$s['id'], $s['id'], $s['name'], $s['color'], encode($s['bounds'])]);
            if (($options['mode'] ?? '') === 'replace') {
                $present = array_fill_keys(array_column(array_filter($data['records'],
                    static fn($r) => $r['settlementId'] === $s['id']), 'num'), true);
                foreach (all("SELECT id,num,local_edit FROM records WHERE settlement_id=? AND status='active'", [$s['id']]) as $row) {
                    if (!isset($present[$row['num']]) && (!$row['local_edit'] || !empty($options['overwrite']))) {
                        query("UPDATE records SET status='archived' WHERE id=?", [$row['id']]);
                    }
                }
            }
            query('DELETE FROM workspace_warnings WHERE settlement_id=?', [$s['id']]);
        }
        $counts = ['created'=>0, 'updated'=>0, 'kept'=>0];
        $plots = array_column($data['plots'], 'geometry', 'recordKey');
        foreach ($data['records'] as $row) {
            $old = one("SELECT * FROM records WHERE settlement_id=? AND num=?
                ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,id LIMIT 1", [$row['settlementId'], $row['num']]);
            if (($old['status'] ?? '') === 'active' && $old['local_edit'] && empty($options['overwrite'])) {
                $counts['kept']++;
                continue;
            }
            unset($row['plotId']);
            $geometry = $plots[$row['settlementId'] . ':' . $row['num']] ?? null;
            if ($geometry) $row = placePlot($row, $geometry);
            saveRecord($row, $old['id'] ?? null, false);
            $counts[$old ? 'updated' : 'created']++;
        }
        foreach ($data['warnings'] as $warning) {
            if (($warning['severity'] ?? '') === 'warning' && empty($warning['recordNum'])) {
                query('INSERT INTO workspace_warnings(settlement_id,batch_id,message) VALUES(?,?,?)',
                    [$data['settlements'][0]['id'] ?? null, $batch['id'], $warning['message']]);
            }
        }
        $defaults = array_column(array_filter($data['overlays'], static fn($o) => $o['included'] ?? true), 'sourceFileId');
        $selected = $options['planIds'] ?? $defaults;
        foreach ($data['overlays'] as $order => $plan) {
            if (!in_array($plan['sourceFileId'], $selected, true)) continue;
            $existing = one('SELECT id FROM historical_overlays WHERE settlement_id IS ? AND name=?', [$plan['settlementId'], $plan['name']]);
            $id = saveOverlay($existing['id'] ?? null, $plan);
            query('UPDATE historical_overlays SET settlement_id=?,sort_order=? WHERE id=?', [$plan['settlementId'], $order, $id]);
        }
        return $counts;
    });
    $batch['status'] = 'applied';
    storeBatch($batch);
    return ['ok'=>true, ...$out, 'backup'=>$copy];
}
