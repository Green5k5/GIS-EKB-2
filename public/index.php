<?php
declare(strict_types=1);

require_once __DIR__ . '/../server/php/database.php';
require_once __DIR__ . '/../server/php/site.php';
require_once __DIR__ . '/../server/php/records.php';
require_once __DIR__ . '/../server/php/media.php';
require_once __DIR__ . '/../server/php/batches.php';
require_once __DIR__ . '/../server/php/workspace.php';

final class HttpError extends RuntimeException {}

function fail(string $message, int $status): never
{
    throw new HttpError($message, $status);
}

function respond(mixed $value, int $status = 200): never
{
    $body = encode($value);
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo $body;
    exit;
}

function jsonBody(int $limit = 15_000_000): array
{
    $raw = file_get_contents('php://input', false, null, 0, $limit + 1);
    if (strlen($raw) > $limit) fail('Слишком большой запрос.', 413);
    $decoded = $raw !== '' ? decode($raw) : [];
    if (!is_array($decoded) || ($decoded && array_is_list($decoded))) fail('Некорректный запрос.', 422);
    return $decoded;
}

function sendFile(string $file, string $type, string $cache, bool $range = false): never
{
    $size = filesize($file);
    $start = 0;
    $end = max(0, $size - 1);
    $hasRange = $range && isset($_SERVER['HTTP_RANGE']);
    if ($range) header('Accept-Ranges: bytes');
    if ($hasRange) {
        if (!preg_match('/^bytes=(\d+)-(\d*)$/D', $_SERVER['HTTP_RANGE'], $m) ||
            (int) $m[1] >= $size || ($m[2] !== '' && (int) $m[2] < (int) $m[1])) {
            header("Content-Range: bytes */$size");
            fail('Недопустимый диапазон файла.', 416);
        }
        $start = (int) $m[1];
        if ($m[2] !== '') $end = min($end, (int) $m[2]);
        http_response_code(206);
        header("Content-Range: bytes $start-$end/$size");
    }
    header('Content-Type: ' . $type);
    header('Cache-Control: ' . $cache);
    header('Content-Length: ' . ($hasRange ? $end - $start + 1 : $size));
    if ($_SERVER['REQUEST_METHOD'] === 'HEAD') exit;
    if (!$hasRange) {
        readfile($file);
        exit;
    }
    $stream = fopen($file, 'rb');
    fseek($stream, $start);
    stream_copy_to_stream($stream, fopen('php://output', 'wb'), $end - $start + 1);
    fclose($stream);
    exit;
}

function cookieOptions(): array
{
    $settings = settings();
    return ['path'=>'/', 'secure'=>($settings['APP_ENV'] ?? $settings['NODE_ENV'] ?? '') === 'production' ||
        in_array(strtolower($_SERVER['HTTPS'] ?? ''), ['on', '1'], true), 'samesite'=>'Strict'];
}

function openSession(): void
{
    $options = cookieOptions();
    session_name('gis_session');
    ini_set('session.use_strict_mode', '1');
    session_cache_limiter('');
    session_set_cookie_params(['lifetime'=>0, 'httponly'=>true, ...$options]);
    $lifetime = (int) (3600 * (float) (settings()['SESSION_TTL_HOURS'] ?? 12));
    ini_set('session.gc_maxlifetime', (string) max(60, $lifetime));
    ini_set('session.save_path', directory(dataPath('sessions')));
    if (!session_start()) throw new RuntimeException('Не удалось открыть сессию.');
}

function sameOrigin(): bool
{
    $origin = parse_url($_SERVER['HTTP_ORIGIN'] ?? '');
    if (empty($origin['host'])) return false;
    $host = $origin['host'] . (isset($origin['port']) ? ':' . $origin['port'] : '');
    return strcasecmp($host, $_SERVER['HTTP_HOST'] ?? '') === 0;
}

function authenticated(): bool
{
    return ($_SESSION['expires'] ?? 0) > time() && isset($_SESSION['csrf']);
}

function admin(string $route, string $method): never
{
    openSession();
    if ($route === '/login' && $method === 'POST') {
        $key = (string) (settings()['ADMIN_KEY'] ?? '');
        if ($key === '') fail('ADMIN_KEY_NOT_CONFIGURED', 503);
        $input = jsonBody()['key'] ?? null;
        if (!is_string($input) || !hash_equals($key, $input)) fail('INVALID_KEY', 401);
        session_regenerate_id(true);
        $expires = time() + max(60, (int) (3600 * (float) (settings()['SESSION_TTL_HOURS'] ?? 12)));
        $_SESSION = ['expires'=>$expires, 'csrf'=>bin2hex(random_bytes(32))];
        setcookie('gis_csrf', $_SESSION['csrf'], ['expires'=>$expires, ...cookieOptions()]);
        session_write_close();
        respond(['ok'=>true]);
    }
    if ($route === '/session' && $method === 'GET') {
        $ok = authenticated();
        $expires = $ok ? $_SESSION['expires'] * 1000 : null;
        session_write_close();
        respond(['authenticated'=>$ok, 'expires'=>$expires]);
    }
    if (!authenticated()) {
        session_write_close();
        fail('AUTH_REQUIRED', 401);
    }
    if (in_array($method, ['POST','PATCH','DELETE'], true) &&
        (!sameOrigin() || !hash_equals($_SESSION['csrf'], $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '') ||
            !hash_equals($_SESSION['csrf'], $_COOKIE['gis_csrf'] ?? ''))) {
        fail('CSRF', 403);
    }
    if ($route === '/logout' && $method === 'POST') {
        $_SESSION = [];
        session_destroy();
        setcookie('gis_session', '', ['expires'=>1, 'httponly'=>true, ...cookieOptions()]);
        setcookie('gis_csrf', '', ['expires'=>1, ...cookieOptions()]);
        respond(['ok'=>true]);
    }
    session_write_close();
    if ($route === '/workspace' || str_starts_with($route, '/workspace/')) workspace(substr($route, 10), $method);
    if ($route === '/stats' && $method === 'GET') {
        respond([
            'records'=>one("SELECT count(*) AS n FROM records WHERE status='active'")['n'],
            'plots'=>one("SELECT count(*) AS n FROM plots WHERE status='active'")['n'],
            'settlements'=>one('SELECT count(*) AS n FROM settlements WHERE active=1')['n'],
            'releases'=>one('SELECT count(*) AS n FROM releases')['n'],
        ]);
    }
    if ($route === '/preview' && $method === 'GET') respond(snapshot());
    if ($route === '/releases' && $method === 'GET') respond(all('SELECT id,created_at AS createdAt,note FROM releases ORDER BY id DESC'));
    if ($route === '/releases' && $method === 'POST') {
        $note = (string) (jsonBody()['note'] ?? '');
        respond(['id'=>transaction(static fn() => publish($note))], 201);
    }
    fail('ADMIN_ROUTE_NOT_FOUND', 404);
}

function publicBootstrap(): never
{
    $release = one('SELECT id,snapshot_json FROM releases ORDER BY id DESC LIMIT 1');
    $value = $release ? decode($release['snapshot_json']) : snapshot();
    $value['releaseId'] = $release['id'] ?? null;
    $value['site'] = siteConfiguration($value);
    $value['content'] = (object) ($value['content'] ?? []);
    $value['settings'] = (object) ($value['settings'] ?? []);
    foreach ($value['records'] as &$record) {
        $record['extra'] = (object) ($record['extra'] ?? []);
        $record['sourceData'] = (object) ($record['sourceData'] ?? []);
    }
    unset($record);
    header('ETag: "release-' . ($value['releaseId'] ?? 0) . '"');
    respond($value);
}

function servePublic(string $route, string $method): never
{
    if (!in_array($method, ['GET','HEAD'], true)) fail('NOT_FOUND', 404);
    if ($route === '/admin/import-worker.js') {
        $worker = GIS_ROOT . '/server/admin/import-worker.js.gz';
        if (!is_file($worker)) fail('NOT_FOUND', 404);
        header('Vary: Accept-Encoding');
        if (preg_match('~(?:^|,)\s*gzip\s*(?:,|$)~i', $_SERVER['HTTP_ACCEPT_ENCODING'] ?? '')) {
            header('Content-Encoding: gzip');
            sendFile($worker, MIME['js'], 'public, max-age=3600');
        }
        header('Content-Type: ' . MIME['js']);
        header('Cache-Control: public, max-age=3600');
        if ($method !== 'HEAD') readgzfile($worker);
        exit;
    }
    if ($route === '/') $file = GIS_ROOT . '/index.html';
    elseif ($route === '/admin' || $route === '/admin/') $file = GIS_ROOT . '/server/admin/index.html';
    elseif (preg_match('~\A/admin/(?:admin\.(?:js|css)|import-policy\.js|site-editor\.(?:js|css)|editor-(?:dom|table|glossary|filters)\.js)\z~', $route)) {
        $file = GIS_ROOT . '/server' . $route;
    } elseif (preg_match('~\A/(?:js|css|assets|vendor/leaflet)/(?:[\w-]+/)*[\w-][\w.-]*\z~', $route)) {
        $file = GIS_ROOT . $route;
    } elseif (preg_match('~\A/data/uploads/(?:images/[a-f0-9-]+\.(?:webp|png|jpe?g)|batch-[a-f0-9-]+/[a-f0-9-]+-preview\.webp)\z~i', $route)) {
        try {
            $file = imagePath($route);
        } catch (InvalidArgumentException) {
            fail('NOT_FOUND', 404);
        }
    } else fail('NOT_FOUND', 404);
    $type = MIME[extension($file)] ?? null;
    if (!$type || !is_file($file)) fail('NOT_FOUND', 404);
    sendFile($file, $type, extension($file) === 'html' ? 'no-cache' : 'public, max-age=3600');
}

header('X-Content-Type-Options: nosniff');
$route = explode('?', $_SERVER['REQUEST_URI'] ?? '/', 2)[0];
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
try {
    if ($route === '/api/health' && $method === 'GET') {
        query('SELECT id FROM releases LIMIT 1');
        respond(['ok'=>true, 'service'=>'gis-ekb-admin']);
    }
    if ($route === '/api/public/bootstrap' && $method === 'GET') publicBootstrap();
    if (str_starts_with($route, '/api/admin/')) admin(substr($route, 10), $method);
    servePublic($route, $method);
} catch (HttpError $e) {
    respond(['error'=>$e->getMessage()], $e->getCode());
} catch (JsonException | InvalidArgumentException $e) {
    respond(['error'=>$e->getMessage()], 422);
} catch (Throwable $e) {
    error_log('gis-ekb: ' . $e->getMessage());
    respond(['error'=>'Не удалось выполнить действие. Проверьте журнал сервера.'], 500);
}
