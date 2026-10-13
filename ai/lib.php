<?php
declare(strict_types=1);

function ai_json_response(array $payload, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function ai_lower(string $value): string {
    if (function_exists('mb_strtolower')) return mb_strtolower($value, 'UTF-8');
    return strtr(strtolower($value), array_combine(
        preg_split('//u', 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ', -1, PREG_SPLIT_NO_EMPTY),
        preg_split('//u', 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя', -1, PREG_SPLIT_NO_EMPTY)
    ));
}

function ai_records(array $files): array {
    $records = [];
    foreach ($files as $file) {
        $raw = @file_get_contents($file);
        if ($raw === false || !preg_match('/\bvar\s+allData\s*=\s*(\[.*\])\s*;\s*$/su', $raw, $match)) continue;
        $decoded = json_decode($match[1], true, 64, JSON_INVALID_UTF8_SUBSTITUTE);
        if (is_array($decoded)) $records = array_merge($records, $decoded);
    }
    return $records;
}

function ai_tokens(string $text): array {
    $text = ai_lower(str_replace('ё', 'е', $text));
    preg_match_all('/[а-яa-z0-9]+/u', $text, $matches);
    $stop = array_flip(['кто','что','где','как','какой','какая','какие','сколько','был','была','были','есть','это','и','в','во','на','по','у','из','для','самый','самая','всего','участок','усадьба','усадеб','база','данные']);
    $tokens = [];
    foreach ($matches[0] as $token) {
        if (isset($stop[$token]) || strlen($token) < 3) continue;
        $stem = preg_replace('/(иями|ями|ами|ого|ему|ому|ыми|ими|иях|ах|ях|ой|ий|ый|ая|ое|ые|ов|ев|ам|ям|ом|ем|ы|и|а|я|у|ю|е)$/u', '', $token);
        if ($stem !== '' && !in_array($stem, $tokens, true)) $tokens[] = $stem;
    }
    return $tokens;
}

function ai_record_text(array $record): string {
    $fields = ['num','settlement','street','buildingType','surname','name','patronymic','soslovie','rank','familyStatus','serviceType','registrationPlace','servicePlace','source'];
    $parts = [];
    foreach ($fields as $field) if (!empty($record[$field])) $parts[] = (string)$record[$field];
    return ai_lower(str_replace('ё', 'е', implode(' ', $parts)));
}

function ai_rank_records(array $records, string $question): array {
    $tokens = ai_tokens($question);
    $ranked = [];
    foreach ($records as $record) {
        $text = ai_record_text($record); $score = 0;
        foreach ($tokens as $token) { $hits = substr_count($text, $token); if ($hits) $score += 2 + min(3, $hits); }
        if ($score > 0) $ranked[] = ['score' => $score, 'record' => $record];
    }
    usort($ranked, fn($a, $b) => $b['score'] <=> $a['score']);
    if ($ranked) {
        $threshold = max(3, $ranked[0]['score'] - 2);
        $ranked = array_values(array_filter($ranked, fn($item) => $item['score'] >= $threshold));
    }
    return array_column($ranked, 'record');
}

function ai_scope_records(array $records, string $question): array {
    $q = ai_lower(str_replace('ё', 'е', $question));
    $fields = ['settlement', 'soslovie'];
    if (preg_match('/фамил|где\s+(жил|жила)|кто\s+(такой|такая)|что\s+известно\s+о/u', $q)) array_unshift($fields, 'surname');
    foreach ($fields as $field) {
        $values = [];
        foreach ($records as $r) if (!empty($r[$field])) $values[(string)$r[$field]] = true;
        foreach (array_keys($values) as $value) {
            $parts = ai_tokens($value);
            $needle = $field === 'surname' ? ai_lower(str_replace('ё', 'е', $value)) : ($parts[0] ?? '');
            if (strlen($needle) >= 6 && str_contains($q, $needle)) {
                $records = array_values(array_filter($records, fn($r) => ($r[$field] ?? '') === $value));
                break;
            }
        }
    }
    return $records;
}

function ai_area(array $record): float {
    foreach (['area_sazh', 'area', 'areaSazh'] as $key) if (isset($record[$key]) && is_numeric($record[$key])) return (float)$record[$key];
    return 0.0;
}

function ai_person(array $r): string {
    $name = trim(implode(' ', array_filter([$r['surname'] ?? '', $r['name'] ?? '', $r['patronymic'] ?? ''])));
    return $name !== '' ? $name : 'владелец не указан';
}

function ai_source(array $r): array {
    $number = preg_replace('/\.0$/', '', (string)($r['num'] ?? '—'));
    return ['id' => $r['id'] ?? null, 'title' => ai_person($r) . ' · усадьба №' . $number, 'meta' => implode(' · ', array_filter([$r['settlement'] ?? '', $r['street'] ?? '', $r['soslovie'] ?? '', ai_area($r) > 0 ? number_format(ai_area($r), 0, ',', ' ') . ' саж²' : ''])), 'source' => (string)($r['source'] ?? '')];
}

function ai_direct_answer(array $records, array $matched, string $question): ?array {
    $q = ai_lower(str_replace('ё', 'е', $question)); $pool = $matched ?: $records;
    if (preg_match('/(сам(ый|ая)|наибольш|максимальн).*(площад|участ)|((площад|участ).*(сам(ый|ая)|наибольш|максимальн))/u', $q)) {
        $withArea = array_values(array_filter($pool, fn($r) => ai_area($r) > 0));
        usort($withArea, fn($a, $b) => ai_area($b) <=> ai_area($a));
        if ($withArea) { $r = $withArea[0]; return ['answer' => sprintf('Самый большой подходящий участок — %s саж². Владелец: %s, усадьба №%s, %s.', number_format(ai_area($r), 0, ',', ' '), ai_person($r), $r['num'] ?? '—', $r['settlement'] ?? 'место не указано'), 'records' => [$r]]; }
    }
    if (preg_match('/(част|чащ|распростран).*(фамил)|фамил.*(част|чащ|распростран)/u', $q)) {
        $counts = []; foreach ($pool as $r) if (!empty($r['surname'])) $counts[$r['surname']] = ($counts[$r['surname']] ?? 0) + 1;
        arsort($counts);
        if ($counts) { $surname = array_key_first($counts); $count = $counts[$surname]; $found = array_values(array_filter($pool, fn($r) => ($r['surname'] ?? '') === $surname)); return ['answer' => "Чаще всего встречается фамилия «{$surname}» — {$count} записи в базе.", 'records' => array_slice($found, 0, 8)]; }
    }
    if (str_contains($q, 'сколько') && $matched) return ['answer' => 'По условиям вопроса найдено записей: ' . count($matched) . '.', 'records' => array_slice($matched, 0, 8)];
    if (preg_match('/(средн).*(площад|размер)|(площад|размер).*(средн)/u', $q)) {
        $areas = array_values(array_filter(array_map('ai_area', $pool), fn($v) => $v > 0));
        if ($areas) return ['answer' => 'Средняя площадь в найденной выборке — ' . number_format(array_sum($areas) / count($areas), 1, ',', ' ') . ' саж² (учтено участков: ' . count($areas) . ').', 'records' => array_slice($pool, 0, 8)];
    }
    return null;
}

function ai_model_intent(array $config, string $question): ?string {
    if (!function_exists('curl_init')) return null;
    $payload = ['model'=>$config['model_name'],'temperature'=>0,'max_tokens'=>24,'stream'=>false,'response_format'=>['type'=>'json_object','schema'=>['type'=>'object','properties'=>['intent'=>['type'=>'string','enum'=>['where','who','list','summary']]],'required'=>['intent'],'additionalProperties'=>false]],'messages'=>[
        ['role'=>'system','content'=>'Определи намерение вопроса к исторической базе. where — спрашивают где; who — кто или кем были; list — какие записи; summary — общее описание. Верни только JSON.'],
        ['role'=>'user','content'=>$question]]];
    $ch = curl_init($config['model_url']);
    curl_setopt_array($ch, [CURLOPT_POST=>true,CURLOPT_RETURNTRANSFER=>true,CURLOPT_HTTPHEADER=>['Content-Type: application/json'],CURLOPT_POSTFIELDS=>json_encode($payload, JSON_UNESCAPED_UNICODE),CURLOPT_TIMEOUT=>$config['model_timeout'],CURLOPT_CONNECTTIMEOUT=>2]);
    $raw = curl_exec($ch); $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE); curl_close($ch);
    if ($raw === false || $status < 200 || $status >= 300) return null;
    $json = json_decode($raw, true); $content = json_decode((string)($json['choices'][0]['message']['content'] ?? ''), true);
    $intent = $content['intent'] ?? null;
    return in_array($intent, ['where','who','list','summary'], true) ? $intent : null;
}

function ai_join_ru(array $values): string {
    $values = array_values(array_unique(array_filter(array_map('strval', $values))));
    if (count($values) < 2) return $values[0] ?? '';
    $last = array_pop($values);
    return implode(', ', $values).' и '.$last;
}

function ai_factual_answer(array $records, int $total, string $intent, string $question): string {
    $shown = array_slice($records, 0, 8);
    $places = []; $placesBySettlement = []; $groups = []; $people = []; $buildings = [];
    foreach ($shown as $r) {
        $place = implode(', ', array_filter([$r['settlement'] ?? '', $r['street'] ?? '']));
        if ($place !== '') $places[] = $place;
        if (!empty($r['settlement']) && !empty($r['street'])) $placesBySettlement[$r['settlement']][] = $r['street'];
        if (!empty($r['soslovie'])) $groups[] = $r['soslovie'];
        if (ai_person($r) !== 'владелец не указан') $people[] = ai_person($r);
        if (!empty($r['buildingType'])) $buildings[] = $r['buildingType'];
    }
    $prefix = 'В базе найдено '.number_format($total, 0, ',', ' ').' подходящих записей.';
    $q = ai_lower($question);
    $wantsWhere = $intent === 'where' || preg_match('/\bгде\b/u', $q);
    $wantsWho = $intent === 'who' || preg_match('/\b(кто|кем)\b/u', $q);
    if ($wantsWhere || $wantsWho) {
        $parts = [];
        if ($wantsWhere && $places) {
            $placeGroups = [];
            foreach ($placesBySettlement as $settlement => $streets) $placeGroups[] = $settlement.': '.ai_join_ru($streets);
            $parts[] = 'Указанные места: '.($placeGroups ? implode('; ', $placeGroups) : ai_join_ru($places)).'.';
        }
        if ($wantsWho && $people) $parts[] = 'Владельцы: '.ai_join_ru($people).'.';
        if ($wantsWho && $groups) $parts[] = 'Сословно-профессиональные группы: '.ai_join_ru($groups).'.';
        if ($parts) return $prefix.' '.implode(' ', $parts);
    }
    if ($intent === 'list') {
        $items = [];
        foreach ($shown as $r) $items[] = ai_person($r).' — '.implode(', ', array_filter([$r['buildingType'] ?? '', $r['street'] ?? '', $r['settlement'] ?? '']));
        return $prefix.' Первые найденные записи: '.implode('; ', $items).'.';
    }
    $parts = [];
    if ($people) $parts[] = 'владельцы: '.ai_join_ru($people);
    if ($places) $parts[] = 'места: '.ai_join_ru($places);
    if ($groups) $parts[] = 'группы: '.ai_join_ru($groups);
    if ($buildings) $parts[] = 'строения: '.ai_join_ru($buildings);
    return $prefix.($parts ? ' '.ucfirst(implode('; ', $parts)).'.' : ' Откройте найденные записи ниже.');
}

function ai_model_answer(array $config, string $question, array $records): ?string {
    if (!$records || !function_exists('curl_init')) return null;
    $intent = ai_model_intent($config, $question);
    return $intent ? ai_factual_answer($records, count($records), $intent, $question) : null;
}
