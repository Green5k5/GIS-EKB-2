<?php
declare(strict_types=1);

function currentWorkspace(): array
{
    $current = snapshot();
    $latest = one('SELECT snapshot_json FROM releases ORDER BY id DESC LIMIT 1');
    return [
        ...$current,
        'hasChanges'=>!$latest || decode($latest['snapshot_json']) != decode(encode($current)),
        'revision'=>revision(),
        'site'=>siteConfiguration($current),
        'releases'=>all('SELECT id,created_at AS createdAt,note FROM releases ORDER BY id DESC LIMIT 30'),
        'importProcessor'=>'browser',
    ];
}

function saveEditorChanges(string $route): void
{
    $body = jsonBody();
    $section = $body['section'] ?? '';
    $content = match ($route) {
        '/site' => [$section => $body['value'] ?? null] + ($section === 'filters' && isset($body['areaFilter']) ? ['areaFilter'=>$body['areaFilter']] : []),
        '/editor' => $body['site'] ?? [],
        default => [],
    };
    if (!is_array($content) || ($content && array_is_list($content))) fail('Проверьте настройки редактора.', 422);
    $rows = $route === '/records/bulk' ? ($body['rows'] ?? null) : ($body['records'] ?? null);
    $update = $route === '/records/bulk' || ($route === '/editor' && array_key_exists('records', $body));
    if (!$content && !$update) fail('Нет правок для сохранения.', 422);
    foreach ($content as $key => &$value) $value = validateSiteSection($key, $value);
    unset($value);
    transaction(function () use ($body, $content, $rows, $update) {
        if (($body['revision'] ?? '') !== revision()) fail('Данные изменились. Откройте актуальную версию и повторите правки.', 409);
        if ($update) applyRecordEdits($rows);
        foreach ($content as $key => $value) saveSiteContent($key, $value);
    });
}

function batchOperation(string $id, string $action, string $file, string $method): never
{
    if ($method === 'GET') {
        $batch = loadBatch($id);
        if (!$batch) fail('Загрузка не найдена. Начните заново.', 404);
        if ($action === 'source' && $file) {
            $item = batchFile($batch, $file);
            $path = fileLocation(batchDirectory($id), $item);
            if (!is_file($path)) fail('Файл не найден.', 404);
            sendFile($path, MIME[extension($path)] ?? 'application/octet-stream', 'private, no-store', true);
        }
        if ($action === '') respond(batchInfo($batch));
        fail('Действие не найдено.', 404);
    }
    [$result, $status] = editBatch($id, function (array $batch) use ($id, $action, $file, $method) {
        $state = $batch['status'];
        if ($action === 'files' && $method === 'POST' && !$file) {
            if ($state !== 'uploading') fail('Сначала вернитесь к списку файлов.', 422);
            saveBatchUpload($batch, rawurldecode($_SERVER['HTTP_X_FILE_NAME'] ?? ''));
            return [batchInfo($batch), 201];
        }
        if ($action === 'analyze' && $method === 'POST') return [startAnalysis($batch, jsonBody()), 202];
        if ($action === 'analysis' && $method === 'POST') {
            saveAnalysis($batch, jsonBody(64_000_000));
            return [batchInfo($batch), 200];
        }
        if ($action === 'preview' && $method === 'POST' && $file) return [savePreview($batch, $file), 201];
        if ($action === 'apply' && $method === 'POST') return [applyBatch($batch, jsonBody()), 200];
        if ($action === 'reopen' && $method === 'POST') {
            if ($state === 'applied') fail('Набор сейчас недоступен.', 422);
            $batch['status'] = 'uploading';
            $batch['error'] = $batch['result'] = null;
            unset($batch['analysisToken']);
        } elseif ($action === 'selection' && $method === 'PATCH' && $state === 'ready') {
            $known = array_column($batch['result']['overlays'], 'sourceFileId');
            $batch['result']['selectedPlanIds'] = array_values(array_intersect(array_unique(jsonBody()['planIds'] ?? []), $known));
            storeBatch($batch);
            return [['ok'=>true], 200];
        } elseif ($action === 'plan-image' && $method === 'PATCH' && $state === 'ready') {
            $plan = array_search($file, array_column($batch['result']['overlays'], 'sourceFileId'), true);
            if ($plan === false) fail('План не найден.', 404);
            $batch['result']['overlays'][$plan]['fileUrl'] = copyImage(jsonBody()['fileUrl'] ?? '')['fileUrl'];
        } elseif ($file && in_array($action, ['files','plans'], true) && $method === 'DELETE') {
            if (in_array($state, ['analyzing','applied'], true) || ($action === 'plans' && $state !== 'ready')) {
                fail('Этот набор сейчас нельзя изменить.', 422);
            }
            $item = batchFile($batch, $file);
            $batch['files'] = array_values(array_filter($batch['files'], static fn($r) => $r['id'] !== $file));
            if ($action === 'plans') {
                $batch['result']['overlays'] = array_values(array_filter($batch['result']['overlays'], static fn($r) => $r['sourceFileId'] !== $file));
                $batch['result']['summary']['overlays'] = count($batch['result']['overlays']);
                $batch['result']['selectedPlanIds'] = array_values(array_diff($batch['result']['selectedPlanIds'] ?? [], [$file]));
            } else {
                $batch['status'] = 'uploading';
                $batch['error'] = $batch['result'] = null;
            }
        } else fail('Действие не найдено.', 404);
        storeBatch($batch);
        if (isset($item)) deleteBatchFiles(batchDirectory($id), [$item]);
        return [batchInfo($batch), 200];
    });
    respond($result, $status);
}

function workspace(string $route, string $method): never
{
    if ($route === '' && $method === 'GET') respond(currentWorkspace());
    if ($route === '/image.png' && $method === 'GET') downloadImage($_GET['fileUrl'] ?? '', $_GET['name'] ?? 'План');
    if ($route === '/images/copy' && $method === 'POST') respond(copyImage(jsonBody()['fileUrl'] ?? ''), 201);
    if ($route === '/image' && $method === 'POST') respond(newImage(), 201);
    if ($route === '/batches' && $method === 'GET') {
        $saved = [];
        foreach (glob(dataPath('uploads/batch-*'), GLOB_ONLYDIR) ?: [] as $directory) {
            $id = substr(basename($directory), 6);
            if (!preg_match('~\A[a-f0-9-]+\z~', $id)) continue;
            $batch = loadBatch($id);
            if ($batch && $batch['status'] !== 'applied') {
                $saved[] = ['id'=>$id, 'status'=>$batch['status'], 'created'=>$batch['created'],
                    'files'=>count($batch['files']), 'summary'=>$batch['result']['summary'] ?? null];
            }
        }
        usort($saved, static fn($a, $b) => $b['created'] <=> $a['created']);
        respond(array_slice($saved, 0, 10));
    }
    if ($route === '/batches' && $method === 'POST') {
        $id = uuid();
        $body = jsonBody();
        directory(batchDirectory($id));
        storeBatch(['id'=>$id, 'scope'=>batchScope(), 'files'=>[], 'status'=>'uploading',
            'settlementName'=>(string) ($body['settlementName'] ?? ''), 'baseRevision'=>revision(),
            'created'=>(int) (microtime(true) * 1000)]);
        respond(['id'=>$id], 201);
    }
    $idPattern = '[a-f0-9-]{1,64}';
    if (preg_match("~^/batches/($idPattern)/plans/($idPattern)/image$~D", $route, $m)) {
        batchOperation($m[1], 'plan-image', $m[2], $method);
    }
    if (preg_match("~^/batches/($idPattern)(?:/([a-z-]+)(?:/($idPattern))?)?$~D", $route, $m)) {
        batchOperation($m[1], $m[2] ?? '', $m[3] ?? '', $method);
    }
    if (preg_match('~^/warnings/(\d+)$~D', $route, $m) && $method === 'PATCH') {
        query('UPDATE workspace_warnings SET resolved=1 WHERE id=?', [(int) $m[1]]);
        respond(['ok'=>true]);
    }
    if (in_array($route, ['/site','/editor','/records/bulk'], true) && $method === 'PATCH') {
        saveEditorChanges($route);
        respond(['ok'=>true]);
    }
    if (preg_match('~^/records(?:/(\d+))?$~D', $route, $m) && in_array($method, ['POST','PATCH','DELETE'], true)) {
        $id = isset($m[1]) ? (int) $m[1] : null;
        if ($method === 'DELETE') {
            if (!$id) fail('Не выбрана усадьба.', 422);
            query("UPDATE records SET status='archived',updated_at=CURRENT_TIMESTAMP WHERE id=?", [$id]);
            respond(['ok'=>true]);
        }
        if ($id && !one('SELECT id FROM records WHERE id=?', [$id])) fail('Усадьба не найдена.', 404);
        $body = jsonBody();
        respond(['id'=>transaction(static fn() => editRecord($id, $body))]);
    }
    if (preg_match('~^/overlays(?:/(\d+))?$~D', $route, $m) && in_array($method, ['POST','PATCH','DELETE'], true)) {
        $id = isset($m[1]) ? (int) $m[1] : null;
        if ($method === 'DELETE') {
            if (!$id) fail('Карта не найдена.', 404);
            query('DELETE FROM historical_overlays WHERE id=?', [$id]);
            respond(['ok'=>true]);
        }
        $body = jsonBody();
        respond(['id'=>transaction(static fn() => saveOverlay($id, $body))], $id ? 200 : 201);
    }
    if ($route === '/publish' && $method === 'POST') {
        $note = (string) (jsonBody()['note'] ?? 'Публикация из мастерской карты');
        respond(['id'=>transaction(static fn() => publish($note))], 201);
    }
    if ($route === '/reset' && $method === 'POST') {
        $copy = backup();
        transaction(static function () {
            db()->exec("UPDATE records SET status='archived'; UPDATE plots SET status='archived';
                DELETE FROM historical_overlays; DELETE FROM historical_features; DELETE FROM workspace_warnings");
            publish('Чистая карта перед загрузкой нового набора');
        });
        respond(['ok'=>true, 'backup'=>$copy]);
    }
    if (preg_match('~^/restore/(\d+)$~D', $route, $m) && $method === 'POST') {
        $release = one('SELECT id,snapshot_json FROM releases WHERE id=?', [(int) $m[1]]);
        if (!$release) fail('Версия не найдена.', 422);
        $copy = backup();
        transaction(static function () use ($release) {
            restoreSnapshot(decode($release['snapshot_json']));
            publish('Восстановлена версия №' . $release['id']);
        });
        respond(['ok'=>true, 'backup'=>$copy]);
    }
    fail('Действие не найдено.', 404);
}
