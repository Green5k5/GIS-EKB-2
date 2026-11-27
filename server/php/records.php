<?php
declare(strict_types=1);

function finite(mixed $value): bool
{
    return (is_float($value) || is_int($value)) && is_finite($value);
}

function geometryBounds(array $geometry): array
{
    $polygons = match ($geometry['type'] ?? null) {
        'Polygon' => [$geometry['coordinates'] ?? []],
        'MultiPolygon' => $geometry['coordinates'] ?? [],
        default => throw new InvalidArgumentException('Нужен контур участка.'),
    };
    if (!is_array($polygons) || !$polygons) throw new InvalidArgumentException('Контур пуст.');
    $bounds = [[90, 180], [-90, -180]];
    foreach ($polygons as $polygon) {
        if (!is_array($polygon) || !$polygon) throw new InvalidArgumentException('Контур пуст.');
        foreach ($polygon as $ring) {
            if (!is_array($ring) || !array_is_list($ring) || count($ring) < 4) throw new InvalidArgumentException('Укажите минимум три вершины.');
            foreach ($ring as $point) {
                if (!is_array($point) || !array_is_list($point) || count($point) !== 2 ||
                    !finite($point[0]) || !finite($point[1]) || abs($point[0]) > 180 || abs($point[1]) > 90) {
                    throw new InvalidArgumentException('Некорректные координаты контура.');
                }
                [$lng, $lat] = $point;
                $bounds = [[min($bounds[0][0], $lat), min($bounds[0][1], $lng)],
                    [max($bounds[1][0], $lat), max($bounds[1][1], $lng)]];
            }
            if ($ring[0] != $ring[count($ring) - 1]) throw new InvalidArgumentException('Контур не замкнут.');
        }
    }
    return $bounds;
}

function placePlot(array $row, array $geometry, ?int $plotId = null): array
{
    [$sw, $ne] = geometryBounds($geometry);
    $row['lat'] = ($sw[0] + $ne[0]) / 2;
    $row['lng'] = ($sw[1] + $ne[1]) / 2;
    if ($plotId !== null) {
        query('UPDATE plots SET geometry_json=?,focus_lat=?,focus_lng=? WHERE id=?',
            [encode($geometry), $row['lat'], $row['lng'], $plotId]);
        return $row;
    }
    query("INSERT INTO plots(settlement_id,legacy_key,geometry_json,focus_lat,focus_lng,status)
        VALUES(?,?,?,?,?,'active') ON CONFLICT(settlement_id,legacy_key) DO UPDATE SET
        geometry_json=excluded.geometry_json,focus_lat=excluded.focus_lat,focus_lng=excluded.focus_lng,status='active'",
        [$row['settlementId'], $row['num'], encode($geometry), $row['lat'], $row['lng']]);
    $row['plotId'] = (int) one('SELECT id FROM plots WHERE settlement_id=? AND legacy_key=?',
        [$row['settlementId'], $row['num']])['id'];
    return $row;
}

function editRecord(?int $id, array $changes, bool $activeOnly = false): int
{
    $old = $id ? one('SELECT * FROM records WHERE id=?', [$id]) : null;
    if ($id && (!$old || ($activeOnly && $old['status'] !== 'active'))) throw new InvalidArgumentException('Усадьба не найдена.');
    $previous = $old ? record($old) : [];
    $row = array_replace($previous, $changes);
    if (!is_string($row['num'] ?? null) || trim($row['num']) === '' ||
        !is_string($row['settlementId'] ?? null) || !one('SELECT id FROM settlements WHERE id=?', [$row['settlementId']])) {
        throw new InvalidArgumentException('Укажите номер и поселение.');
    }
    if (one("SELECT 1 FROM records WHERE settlement_id=? AND num=? AND status='active' AND id<>?", [$row['settlementId'], $row['num'], $id ?? -1])) {
        throw new InvalidArgumentException('Такой номер уже есть в этом поселении.');
    }
    foreach (['lat','lng','area_sazh'] as $field) {
        $value = $row[$field] ?? null;
        if ($value !== null && $value !== '' && (!is_numeric($value) || !is_finite((float) $value))) {
            throw new InvalidArgumentException('Проверьте площадь и положение на карте.');
        }
        $row[$field] = $value === null || $value === '' ? null : (float) $value;
    }
    if (($row['lat'] === null) !== ($row['lng'] === null) || abs($row['lat'] ?? 0) > 90 ||
        abs($row['lng'] ?? 0) > 180 || ($row['area_sazh'] ?? 0) < 0) {
        throw new InvalidArgumentException('Проверьте площадь и положение на карте.');
    }
    $row['issues'] = array_values(array_filter($previous['issues'] ?? [], static function (array $issue) use ($previous, $changes) {
        $field = $issue['field'] ?? '';
        if ($field === 'geometry' && !empty($changes['geometry'])) return false;
        return !isset($changes[$field]) || $changes[$field] === '' || $changes[$field] == ($previous[$field] ?? '');
    }));
    $row['plotId'] = $previous['plotId'] ?? null;
    if (!empty($changes['geometry'])) $row = placePlot($row, $changes['geometry'], $row['plotId']);
    return saveRecord($row, $id, true);
}

function applyRecordEdits(mixed $rows): void
{
    if (!is_array($rows) || !array_is_list($rows) || !$rows) throw new InvalidArgumentException('Нет правок таблицы для сохранения.');
    foreach ($rows as $row) {
        $id = $row['id'] ?? null;
        $changes = $row['changes'] ?? null;
        if (!is_int($id) || $id < 1 || !is_array($changes) || array_is_list($changes)) {
            throw new InvalidArgumentException('Некорректные поля таблицы.');
        }
        foreach ($changes as $field => $value) {
            if (!isset(RECORD_FIELDS[$field]) || in_array($field, ['localEdit','sourceKey','issues','plotId'], true)) {
                throw new InvalidArgumentException('Некорректные поля таблицы.');
            }
            $valid = in_array($field, ['extra','sourceData'], true)
                ? is_array($value) && (!$value || !array_is_list($value))
                : is_string($value) || (in_array($field, NUMBER_FIELDS, true) && ($value === null || finite($value)));
            if (!$valid) throw new InvalidArgumentException('Некорректные поля таблицы.');
        }
        try {
            editRecord($id, $changes, true);
        } catch (InvalidArgumentException $error) {
            throw new InvalidArgumentException("Усадьба ID $id. " . $error->getMessage());
        }
    }
}
