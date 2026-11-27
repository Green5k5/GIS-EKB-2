<?php
declare(strict_types=1);

const MIME = ['html'=>'text/html; charset=utf-8','js'=>'text/javascript; charset=utf-8',
    'css'=>'text/css; charset=utf-8','json'=>'application/json; charset=utf-8',
    'webp'=>'image/webp','png'=>'image/png','jpg'=>'image/jpeg','jpeg'=>'image/jpeg',
    'svg'=>'image/svg+xml','pbf'=>'application/x-protobuf','ico'=>'image/x-icon'];

function extension(string $name): string
{
    return strtolower(pathinfo($name, PATHINFO_EXTENSION));
}

function uploadTo(string $destination): void
{
    $input = fopen('php://input', 'rb');
    $output = fopen($destination, 'xb');
    try {
        $bytes = stream_copy_to_stream($input, $output);
        if (!$bytes || (isset($_SERVER['CONTENT_LENGTH']) && $bytes !== (int) $_SERVER['CONTENT_LENGTH'])) {
            throw new InvalidArgumentException('Файл пуст или передан не полностью.');
        }
    } finally {
        fclose($input);
        fclose($output);
    }
}

function imagePath(string $url): string
{
    $url = ltrim(rawurldecode($url), '/');
    if (preg_match('~\Adata/uploads/([a-z0-9-]+/[a-z0-9-]+\.(?:webp|png|jpe?g))\z~i', $url, $match)) {
        $root = realpath(dataPath('uploads'));
        $file = realpath(dataPath('uploads/' . $match[1]));
    } elseif (preg_match('~\Aassets/overlays-lite/[\w.-]+\.(?:webp|png|jpe?g)\z~i', $url)) {
        $root = realpath(GIS_ROOT . '/assets/overlays-lite');
        $file = realpath(GIS_ROOT . '/' . $url);
    } else {
        throw new InvalidArgumentException('Недопустимый файл изображения.');
    }
    if (!$file || !$root || !str_starts_with($file, $root . '/') || !is_file($file)) {
        throw new InvalidArgumentException('Изображение плана не найдено.');
    }
    return $file;
}

function imageFile(string $file): GdImage
{
    $info = @getimagesize($file);
    if (!$info || $info[0] * $info[1] > 150_000_000) throw new InvalidArgumentException('Проверьте формат и размер изображения.');
    $image = match ($info[2]) {
        IMAGETYPE_PNG => @imagecreatefrompng($file),
        IMAGETYPE_JPEG => @imagecreatefromjpeg($file),
        IMAGETYPE_WEBP => @imagecreatefromwebp($file),
        default => false,
    };
    if (!$image) throw new InvalidArgumentException('Выберите PNG, JPG или WebP.');
    if ($info[2] === IMAGETYPE_JPEG && function_exists('exif_read_data')) {
        $orientation = @exif_read_data($file)['Orientation'] ?? 1;
        if (in_array($orientation, [2,4,5,7], true)) imageflip($image, $orientation === 4 ? IMG_FLIP_VERTICAL : IMG_FLIP_HORIZONTAL);
        $rotation = match ($orientation) { 3=>180, 5,8=>90, 6,7=>270, default=>0 };
        if ($rotation) $image = imagerotate($image, $rotation, 0);
    }
    imagesavealpha($image, true);
    return $image;
}

function newImage(): array
{
    $id = uuid();
    $dir = directory(dataPath('uploads/images'));
    $temp = $dir . '/' . $id . '.input';
    try {
        uploadTo($temp);
        $format = (@getimagesize($temp)[2] ?? null) === IMAGETYPE_PNG ? 'png' : 'webp';
        $image = imageFile($temp);
        $name = "$id.$format";
        $written = $format === 'png' ? imagepng($image, "$dir/$name") : imagewebp($image, "$dir/$name", 95);
        if (!$written || !is_file("$dir/$name") || !filesize("$dir/$name")) {
            @unlink("$dir/$name");
            throw new RuntimeException('Не удалось сохранить изображение.');
        }
        return ['fileUrl'=>"/data/uploads/images/$name", 'width'=>imagesx($image), 'height'=>imagesy($image), 'format'=>$format];
    } finally {
        if (is_file($temp)) unlink($temp);
    }
}

function copyImage(string $url): array
{
    $source = imagePath($url);
    $name = uuid() . '.' . extension($source);
    if (!copy($source, directory(dataPath('uploads/images')) . '/' . $name)) {
        throw new RuntimeException('Не удалось скопировать изображение.');
    }
    return ['fileUrl'=>"/data/uploads/images/$name"];
}

function downloadImage(string $url, string $name): never
{
    $source = imagePath($url);
    $image = extension($source) === 'png' ? null : imageFile($source);
    header('Content-Type: image/png');
    header('Content-Disposition: attachment; filename="plan.png"; filename*=UTF-8\'\'' . rawurlencode(str_replace(["\r","\n","/","\\"], '_', $name) . '.png'));
    header('Cache-Control: no-store');
    if ($image) imagepng($image);
    else readfile($source);
    exit;
}

function validatePlan(array $plan): void
{
    $bounds = $plan['bounds'] ?? [];
    if (!is_array($bounds) || !array_is_list($bounds) || count($bounds) !== 2 ||
        !array_all_compat($bounds, static fn($p) => is_array($p) && array_is_list($p) && count($p) === 2 &&
            finite($p[0]) && finite($p[1]) && abs($p[0]) <= 90 && abs($p[1]) <= 180) ||
        $bounds[0][0] >= $bounds[1][0] || $bounds[0][1] >= $bounds[1][1]) {
        throw new InvalidArgumentException('Некорректное размещение карты.');
    }
    $opacity = $plan['opacity'] ?? 0.75;
    $crop = $plan['crop'] ?? [0,0,0,0];
    if (!finite($plan['rotation'] ?? 0) || !finite($opacity) || $opacity < 0 || $opacity > 1 ||
        !is_array($crop) || !array_is_list($crop) || count($crop) !== 4 ||
        !array_all_compat($crop, static fn($v) => finite($v) && $v >= 0 && $v <= 1) ||
        $crop[0] + $crop[2] >= 1 || $crop[1] + $crop[3] >= 1) {
        throw new InvalidArgumentException('Проверьте размер, обрезку и прозрачность.');
    }
}

function saveOverlay(?int $id, array $values): int
{
    $old = $id ? one('SELECT * FROM historical_overlays WHERE id=?', [$id]) : null;
    if ($id && !$old) throw new InvalidArgumentException('Карта не найдена.');
    $plan = [
        'bounds'=>$values['bounds'] ?? decode($old['bounds_json'] ?? 'null'),
        'rotation'=>$values['rotation'] ?? ($old['rotation'] ?? 0),
        'crop'=>$values['crop'] ?? decode($old['crop_json'] ?? '[0,0,0,0]'),
        'opacity'=>$values['opacity'] ?? ($old['opacity'] ?? 0.75),
    ];
    validatePlan($plan);
    $url = $values['fileUrl'] ?? $old['file_url'] ?? '';
    imagePath($url);
    $params = [$values['name'] ?? $old['name'] ?? 'Старая карта', $url, encode($plan['bounds']),
        $plan['opacity'], (int) ($values['visible'] ?? $old['visible'] ?? true), $plan['rotation'], encode($plan['crop'])];
    if ($id) {
        query('UPDATE historical_overlays SET name=?,file_url=?,bounds_json=?,opacity=?,visible=?,rotation=?,crop_json=? WHERE id=?', [...$params, $id]);
        return $id;
    }
    return insert('INSERT INTO historical_overlays(name,file_url,bounds_json,opacity,visible,rotation,crop_json) VALUES(?,?,?,?,?,?,?)', $params);
}
