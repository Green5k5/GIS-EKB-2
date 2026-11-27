<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit(1);
}

require_once __DIR__ . '/database.php';

try {
    if (PHP_VERSION_ID < 80300) throw new RuntimeException('Нужен PHP 8.3 или новее.');
    foreach (['pdo_sqlite', 'session', 'zip', 'zlib', 'mbstring', 'gd'] as $extension) {
        if (!extension_loaded($extension)) throw new RuntimeException("В PHP не включено расширение $extension.");
    }
    if (!function_exists('imagewebp')) throw new RuntimeException('В PHP GD не включена поддержка WebP.');
    umask(0077);
    if (empty(settings()['ADMIN_KEY'])) {
        $file = GIS_ROOT . '/.env';
        $key = bin2hex(random_bytes(32));
        if (is_file($file) && !chmod($file, 0600)) throw new RuntimeException('Не удалось ограничить доступ к .env.');
        if (file_put_contents($file, "\nADMIN_KEY=$key\n", FILE_APPEND | LOCK_EX) === false) {
            throw new RuntimeException('Не удалось создать ключ администратора.');
        }
        echo "Создан ключ администратора в .env (ADMIN_KEY).\n";
    }
    echo migrate() ? "Исходные данные загружены в SQLite.\n" : "База SQLite готова. Существующие данные сохранены.\n";
} catch (Throwable $error) {
    fwrite(STDERR, $error->getMessage() . PHP_EOL);
    exit(1);
}
