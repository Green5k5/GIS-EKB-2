<?php
declare(strict_types=1);

const FILTER_FIELDS = ['settlement','num','street','buildingType','surname','name','patronymic',
    'soslovie','familyStatus','sex','serviceType','rank','position','servicePlace','registrationPlace'];
const TABLE_FIELDS = [...FILTER_FIELDS,'owner','area_sazh','source','scanUrl','notes','extra','sourceData','lat','lng','id'];
const GLOSSARY_ICONS = [
    ['book','Книга'], ['people','Люди','Сословно-профессиональные группы'],
    ['map','Карта','Городская среда и топонимика'], ['factory','Завод','Производство'],
    ['medal','Медаль','Чины'], ['ruler','Линейка','Метрология'], ['landmark','Учреждение','Учреждения'],
    ['briefcase','Ремесло','Занятия'], ['document','Документ','Документы'], ['house','Дом'],
    ['pin','Метка'], ['bridge','Мост'], ['coins','Монеты'], ['tools','Инструменты'], ['tree','Дерево'],
];

function siteDefaults(): array
{
    static $defaults;
    return $defaults ??= decode(file_get_contents(GIS_ROOT . '/server/site-defaults.json'));
}

function siteConfiguration(array $snapshot): array
{
    $defaults = siteDefaults();
    $content = (array) ($snapshot['content'] ?? []);
    if (!isset($content['glossary'])) {
        $terms = array_column($defaults['glossary'], null, 'term');
        foreach ($snapshot['glossary'] ?? [] as $row) {
            $original = $terms[$row['term']] ?? [];
            $row['filterKey'] = $row['filterValue'] ? $row['filterKey'] : ($original['filterKey'] ?? '');
            $row['filterValue'] = $row['filterValue'] ?: ($original['filterValue'] ?? '');
            $terms[$row['term']] = $row;
        }
        $content['glossary'] = array_values($terms);
    }
    return [
        'glossary'=>$content['glossary'],
        'glossaryIcons'=>array_map(static fn(array $icon) => count($icon) === 3
            ? array_combine(['id','label','category'], $icon) : array_combine(['id','label'], $icon), GLOSSARY_ICONS),
        'filters'=>$content['filters'] ?? $defaults['filters'],
        'areaFilter'=>$content['areaFilter'] ?? $defaults['areaFilter'],
        'areaFilterTitle'=>$content['areaFilterTitle'] ?? 'Площадь усадьбы',
        'tableFilters'=>$content['tableFilters'] ?? TABLE_FIELDS,
        'tableFields'=>TABLE_FIELDS, 'filterFields'=>FILTER_FIELDS,
        'texts'=>array_replace($defaults['texts'], $content['texts'] ?? []),
    ];
}

function validGlossaryIcon(mixed $icon): bool
{
    if ($icon === null || in_array($icon, ['', 'none', ...array_column(GLOSSARY_ICONS, 0)], true)) return true;
    if (!is_string($icon) || strlen($icon) > 56000 || !preg_match('~\Adata:image/png;base64,([\w+/]+={0,2})\z~', $icon, $match)) return false;
    $bytes = base64_decode($match[1], true);
    return $bytes && strlen($bytes) >= 45 && substr($bytes, 0, 24) === hex2bin('89504e470d0a1a0a0000000d494844520000006000000060')
        && substr($bytes, -12, 8) === hex2bin('0000000049454e44');
}

function validateSiteSection(string $key, mixed $value): mixed
{
    $text = static fn($item) => is_string($item) && mb_strlen($item, 'UTF-8') <= 12000;
    $name = static fn($item) => $text($item) && trim($item) !== '';
    $list = is_array($value) && array_is_list($value);
    $strings = static fn($items) => is_array($items) && array_is_list($items) && array_all_compat($items, $text);
    $unique = static fn($items) => count(array_unique($items)) === count($items);
    if ($key === 'glossary' && $list) {
        $terms = [];
        foreach ($value as $term) {
            if (!validGlossaryIcon($term['icon'] ?? null)) throw new InvalidArgumentException('Глоссарий. Выберите значок из набора или загрузите изображение через редактор.');
            $field = $term['filterKey'] ?? '';
            $filter = $term['filterValue'] ?? '';
            $validFilter = (!$field && !$filter) || (in_array($field, FILTER_FIELDS, true)
                && ($name($filter) || ($strings($filter) && $filter && array_all_compat($filter, $name))));
            if (!$name($term['term'] ?? null) || !$name($term['category'] ?? null) ||
                !$name($term['description'] ?? null) || !$strings($term['aliases'] ?? null) || !$validFilter) break;
            $terms[] = mb_strtolower(trim($term['term']), 'UTF-8');
        }
        if (count($terms) === count($value) && $unique($terms)) return $value;
    }
    if ($key === 'filters' && $list) {
        $valid = static fn($row) => in_array($row['key'] ?? null, FILTER_FIELDS, true)
            && $name($row['title'] ?? null) && in_array($row['sort'] ?? null, ['alpha','count'], true)
            && is_int($row['limit'] ?? null) && $row['limit'] >= 0 && $row['limit'] <= 1000
            && is_bool($row['inline'] ?? null) && $strings($row['hiddenValues'] ?? null);
        if (array_all_compat($value, $valid) && $unique(array_column($value, 'key'))) return $value;
    }
    if ($key === 'areaFilter' && is_bool($value)) return $value;
    if ($key === 'areaFilterTitle' && $name($value)) return trim($value);
    if ($key === 'tableFilters' && $strings($value) && $unique($value) && !array_diff($value, TABLE_FIELDS)) return $value;
    if ($key === 'texts' && is_array($value)) {
        $keys = array_keys(siteDefaults()['texts']);
        if (array_all_compat($keys, static fn($k) => $text($value[$k] ?? null))) return array_intersect_key($value, array_flip($keys));
    }
    throw new InvalidArgumentException('Проверьте обязательные поля, настройки и отсутствие повторов.');
}

function array_all_compat(array $items, callable $predicate): bool
{
    foreach ($items as $item) {
        if (!$predicate($item)) return false;
    }
    return true;
}
