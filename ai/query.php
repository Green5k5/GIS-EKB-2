<?php
declare(strict_types=1);

// A query is a read-only plan. All predicates are applied to named columns;
// no generated SQL, JavaScript or model-produced factual text is executed.
function aq_norm(string $s): string {
    return trim(preg_replace('/\s+/u', ' ', str_replace('ё', 'е', ai_lower($s))));
}

function aq_word(string $haystack, string $needle): bool {
    return preg_match('/(?<![а-яa-z0-9])'.preg_quote($needle, '/').'(?![а-яa-z0-9])/u', $haystack) === 1;
}

function aq_form(string $value, string $word): bool {
    $value = aq_norm($value); $word = aq_norm($word);
    if ($value === $word) return true;
    // Case endings only: never strip surname/patronymic suffixes (-ов/-ев).
    foreach (['а','у','ом','е','ы','и','ов','ам','ами','ах'] as $ending) {
        if ($word === $value.$ending) return true;
    }
    if (preg_match('/[ая]$/u', $value)) {
        $base = preg_replace('/[ая]$/u', '', $value);
        foreach (['ы','и','е','у','ой','ою','ам','ах'] as $ending) if ($word === $base.$ending) return true;
    }
    return false;
}

function aq_dictionary(array $records): array {
    $fields = ['surname','name','patronymic','settlement','street','soslovie','buildingType','sex','familyStatus','serviceType','servicePlace','registrationPlace','rank'];
    $dict = [];
    foreach ($fields as $field) {
        $dict[$field] = [];
        foreach ($records as $r) {
            $value = trim((string)($r[$field] ?? ''));
            if ($value !== '' && $value !== 'Нет данных') $dict[$field][aq_norm($value)] = $value;
        }
    }
    return $dict;
}

function aq_plan(string $question, array $records): array {
    $q = aq_norm($question);
    $plan = ['operation'=>'lookup','filters'=>[],'field'=>null,'group'=>null,'question'=>$question,'clarification'=>null,'recognized'=>false];
    if (preg_match('/сколько|количеств|число\s+(усад|участ|запис|владел|людей)|общее\s+число/u', $q)) $plan['operation'] = 'count';
    if (preg_match('/средн.*(площад|размер)|(площад|размер).*средн/u', $q)) $plan['operation'] = 'mean';
    if (preg_match('/медиан/u', $q)) $plan['operation'] = 'median';
    if (preg_match('/(суммарн|общая|вся|сумма).*(площад|земл)|(площад|земл).*(суммарн|общая|сумма)/u', $q)) $plan['operation'] = 'sum';
    if (preg_match('/сам\w*\s+(больш|крупн)|наибольш|максимальн/u', $q)) $plan['operation'] = 'max';
    if (preg_match('/сам\w*\s+(мал|мелк)|наименьш|минимальн/u', $q)) $plan['operation'] = 'min';
    if (preg_match('/чаще|частая|частое|частый|распростран|популярн/u', $q)) $plan['operation'] = 'frequency';
    $labels = ['patronymic'=>'отчеств','surname'=>'фамил','name'=>'(?<![а-я])имен[иа]|(?<![а-я])имя','rank'=>'чин','street'=>'улиц','soslovie'=>'сослов|групп','settlement'=>'поселен'];
    foreach ($labels as $field => $pattern) if (preg_match('/'.$pattern.'/u', $q)) { $plan['field'] = $field; break; }
    if ($plan['operation'] === 'frequency') $plan['field'] ??= 'surname';
    if (preg_match('/по\s+(поселен|город)|в\s+каждом\s+поселен|кажд\w*\s+поселен/u', $q)) $plan['group'] = 'settlement';
    if (preg_match('/по\s+сослов|по\s+групп|кажд\w*\s+сослов/u', $q)) $plan['group'] = 'soslovie';
    if (preg_match('/сравн|больше\s+усадеб|меньше\s+усадеб/u', $q) && !preg_match('/площад/u', $q)) { $plan['operation']='count'; $plan['group']='settlement'; }
    $dict = aq_dictionary($records);
    $explicit = false;
    $personPattern = '/(?<![а-я])(фамили(?:я|и|ей|ю)|отчеств(?:ом|о|а|у)|имен(?:и|ем)|имя)(?![а-я])\s+(?:[—:=]\s*)?(?:[«"\x{201c}])?([а-я-]+)/u';
    if (preg_match_all($personPattern, $q, $matches, PREG_SET_ORDER)) {
        foreach ($matches as $m) {
            $field = str_starts_with($m[1], 'фамил') ? 'surname' : (str_starts_with($m[1], 'отчеств') ? 'patronymic' : 'name');
            if (in_array($m[2], ['у','в','владельца','владельцев','самое','самая','чаще','встречается','встречаются','популярнее','есть','было','был'], true)) continue;
            $values = [];
            foreach ($dict[$field] as $value) if (aq_form($value, $m[2])) $values[] = $value;
            // Even absent values remain an explicit predicate and return zero.
            $plan['filters'][] = ['field'=>$field,'values'=>$values ?: [$m[2]],'label'=>$m[1].' «'.$m[2].'»'];
            $plan['recognized'] = true; $explicit = true;
        }
    }
    $aliases = [
        'settlement'=>['Екатеринбург'=>'екатеринбург\w*','Уктус'=>'уктус\w*','Нижне-Исетск'=>'нижне[ -]?исет\w*'],
        'soslovie'=>['Купцы'=>'купц\w*|купеч\w*','Дворяне'=>'дворян\w*','Мастеровые'=>'мастеров\w*','Мещане'=>'мещан\w*','Солдаты'=>'солдат\w*','Крестьяне'=>'крестьян\w*','Непременные работники'=>'непременн\w*\s+работник\w*'],
        'sex'=>['Женщины'=>'женщин\w*|владелиц\w*','Мужчины'=>'мужчин\w*'],
        'buildingType'=>['Дом деревянный'=>'деревянн\w*','Дом каменный'=>'каменн\w*'],
    ];
    foreach ($aliases as $field => $items) {
        $values = [];
        foreach ($items as $value => $pattern) if (preg_match('/(?<![а-я])(?:'.$pattern.')(?![а-я])/u', $q)) $values[] = $value;
        if ($values) { $plan['filters'][] = ['field'=>$field,'values'=>$values,'label'=>implode(' / ', $values)]; $plan['recognized'] = true; }
    }
    // Street names are matched on meaningful words, with Russian adjective cases.
    foreach (['street','soslovie','familyStatus','serviceType','rank','servicePlace','registrationPlace'] as $field) {
        if (array_filter($plan['filters'], fn($f) => $f['field'] === $field)) continue;
        $values = [];
        foreach ($dict[$field] as $value) {
            $normalized = aq_norm($value);
            if (aq_word($q, $normalized)) { $values[] = $value; continue; }
            if ($field === 'street' && str_contains($q, 'улиц')) {
                $name = preg_replace('/\s+улица$/u', '', $normalized);
                if (preg_match('/^(.*?)(ская|ная|вая|шая)$/u', $name, $m)) {
                    $stem = $m[1].preg_replace('/ая$/u', '', $m[2]);
                    if (preg_match('/(?<![а-я])'.preg_quote($stem, '/').'(?:ая|ой|ую|ою)(?![а-я])/u', $q)) $values[] = $value;
                }
            }
        }
        if ($values) { $plan['filters'][] = ['field'=>$field,'values'=>array_values(array_unique($values)),'label'=>implode(' / ', $values)]; $plan['recognized'] = true; }
    }
    if (!$explicit) {
        preg_match_all('/[а-я-]+/u', $q, $words);
        $skip = ['в','на','у','по','и','кто','что','как','где','какие','сколько','жил','жила','был','были','есть','всего','усадеб','усадьбы','усадьба','владельцы','владельцев','площадь','средняя','имя','фамилия','отчество'];
        $candidates = [];
        foreach ($words[0] as $word) {
            if (in_array($word, $skip, true)) continue;
            foreach (['surname','name','patronymic'] as $field) {
                foreach ($dict[$field] as $value) if (aq_form($value, $word)) $candidates[$word][$field][] = $value;
            }
        }
        foreach ($candidates as $word => $fields) {
            // A requested output column is different from a filter: "отчество Петрова".
            if ($plan['field'] === 'patronymic' && isset($fields['surname'])) $fields = ['surname'=>$fields['surname']];
            elseif ($plan['field'] === 'surname' && isset($fields['name'])) $fields = ['name'=>$fields['name']];
            if (count($fields) > 1) {
                $plan['clarification'] = '«'.$word.'» встречается в нескольких полях. Уточните: «фамилия '.$word.'», «имя '.$word.'» или «отчество '.$word.'».';
                break;
            }
            $field = array_key_first($fields);
            $plan['filters'][] = ['field'=>$field,'values'=>array_values(array_unique($fields[$field])),'label'=> $field.' «'.$word.'»'];
            $plan['recognized'] = true;
        }
    }
    if (preg_match('/(?:усадьб\w*|участ\w*)\s*(?:№|номер(?:ом|а)?)\s*(\d+)/u', $q, $m)) {
        $plan['filters'][] = ['field'=>'num','values'=>[$m[1]],'label'=>'усадьба №'.$m[1]]; $plan['recognized'] = true;
    }
    if (preg_match('/(?:площад\w*|участ\w*).*?(больше|более|свыше|меньше|менее)\s*(\d+(?:[.,]\d+)?)/u', $q, $m)) {
        $plan['filters'][] = ['field'=>'area_sazh','compare'=>in_array($m[1], ['меньше','менее'], true)?'lt':'gt','number'=>(float)str_replace(',', '.', $m[2]),'label'=>'площадь '.$m[1].' '.$m[2].' саж²']; $plan['recognized'] = true;
    }
    if (preg_match('/(?:площад\w*|участ\w*).*?от\s*(\d+(?:[.,]\d+)?)\s*до\s*(\d+(?:[.,]\d+)?)/u', $q, $m)) {
        $plan['filters'][]=['field'=>'area_sazh','compare'=>'range','number'=>(float)str_replace(',', '.',$m[1]),'upper'=>(float)str_replace(',', '.',$m[2]),'label'=>'площадь от '.$m[1].' до '.$m[2].' саж²']; $plan['recognized']=true;
    }
    // Negation must be interpreted as a predicate, never silently discarded.
    foreach ($plan['filters'] as &$filter) {
        if (isset($filter['values']) && count($filter['values'])===1) {
            $value=aq_norm($filter['values'][0]); $words=explode(' ', $value); $head=$words[0];
            $stem=preg_replace('/(ы|и|а|я)$/u','',$head);
            if (preg_match('/(?:кроме|исключая|не)\s+'.preg_quote($stem,'/').'[а-я]*(?![а-я])/u',$q)) {
                $filter['exclude']=true; $filter['label']='кроме '.$filter['label'];
            }
        }
    }
    unset($filter);
    // Unrecognized names after a geographic preposition cannot mean "all data".
    if (preg_match('/(?<![а-я])(?:в|на)\s+([а-я-]+)(?:\s+улице)?/u',$q,$placeMatch)) {
        $place=$placeMatch[1];
        $generic=['базе','проекте','данных','каждом','целом','городе','поселении','выборке','среднем','ведомости','ведомостях'];
        $hasPlace=array_filter($plan['filters'], fn($f)=>in_array($f['field'],['settlement','street'],true));
        if (!$hasPlace && !in_array($place,$generic,true)) $plan['clarification']='Место «'.$place.'» не распознано в базе. Укажите Екатеринбург, Нижне-Исетск, Уктус или историческую улицу из данных проекта.';
    }
    if (preg_match('/о\s+проекте|что\s+за\s+(проект|база)|какие\s+данные|о\s+чем\s+(проект|база)|что\s+изучает/u', $q)) $plan['operation'] = 'project';
    return $plan;
}

function aq_select(array $records, array $plan): array {
    return array_values(array_filter($records, function($r) use ($plan) {
        foreach ($plan['filters'] as $f) {
            if (isset($f['compare'])) {
                $area = ai_area($r);
                if ($area <= 0) return false;
                if ($f['compare']==='range' && ($area<$f['number'] || $area>$f['upper'])) return false;
                if ($f['compare']==='gt' && $area<=$f['number']) return false;
                if ($f['compare']==='lt' && $area>=$f['number']) return false;
            } else {
                $value = aq_norm((string)($r[$f['field']] ?? ''));
                $matches=in_array($value, array_map('aq_norm', $f['values']), true);
                if (!empty($f['exclude']) ? $matches : !$matches) return false;
            }
        }
        return true;
    }));
}

function aq_number(float $n): string { return number_format($n, abs($n-round($n)) < 0.001 ? 0 : 1, ',', ' '); }

function aq_estates(int $n): string {
    $tail=$n%100; $last=$n%10;
    return aq_number($n).' '.($tail>=11 && $tail<=14 ? 'усадеб' : ($last===1?'усадьба':($last>=2 && $last<=4?'усадьбы':'усадеб')));
}

function aq_measure(array $areas, string $operation): float {
    sort($areas); $n=count($areas);
    if(!$n) return 0;
    return $operation==='sum'?array_sum($areas):($operation==='mean'?array_sum($areas)/$n:($n%2?$areas[intdiv($n,2)]:($areas[$n/2-1]+$areas[$n/2])/2));
}

function aq_answer(string $question, array $records, array $config, string $previousQuestion = ''): array {
    $plan = aq_plan($question, $records);
    if ($previousQuestion !== '' && preg_match('/^(а\s|и\s|тогда\s|а\s+теперь\s)/u', aq_norm($question))) {
        $previous = aq_plan($previousQuestion, $records);
        if (!$previous['clarification'] && !$plan['clarification']) {
            if ($plan['operation']==='lookup' && !preg_match('/кто|где|какие|отчеств|фамил|имя/u',aq_norm($question))) $plan['operation']=$previous['operation'];
            $newFields=array_column($plan['filters'],'field');
            foreach($previous['filters'] as $filter) if(!in_array($filter['field'],$newFields,true)) $plan['filters'][]=$filter;
            $plan['recognized']=$plan['recognized'] || $previous['recognized'];
        }
    }
    $base = ['answer'=>'','sources'=>[],'model_used'=>false,'matches_label'=>'','count'=>0];
    if ($plan['clarification']) return array_merge($base, ['answer'=>$plan['clarification'],'matches_label'=>'Нужно уточнение']);
    $rows = aq_select($records, $plan); $n = count($rows); $op = $plan['operation'];
    $scope = $plan['filters'] ? implode('; ', array_column($plan['filters'], 'label')) : 'вся база проекта';
    $base['matches_label'] = 'Выборка: '.$scope.' · записей: '.aq_number($n); $base['count'] = $n;
    $sourceRows = array_slice($rows, 0, $config['max_sources']);
    if ($op === 'project') {
        $base['answer'] = 'Проект реконструирует усадьбы Екатеринбургской агломерации по ведомостям 1809–1810 годов. База содержит '.aq_number(count($records)).' записей об усадьбах Екатеринбурга, Нижне-Исетска и Уктуса: владельцы, исторические улицы, сословно-профессиональные группы, строения, площади в квадратных саженях и архивные ссылки. Одна запись — усадьба; один владелец может встречаться несколько раз.';
        return $base;
    }
    if (!$plan['recognized'] && $op === 'lookup') {
        return array_merge($base, ['answer'=>'Я могу искать владельцев по фамилии, имени и отчеству, считать усадьбы и анализировать площади, поселения и сословия. Уточните вопрос, например: «Сколько усадеб в Уктусе?» или «У кого отчество Петров?»','matches_label'=>'Условия поиска не распознаны','count'=>0]);
    }
    if (!$n) { $base['answer'] = 'По указанным условиям в базе найдено 0 усадеб. '.($plan['filters'] ? 'Проверены поля: '.$scope.'.' : ''); return $base; }
    if ($op === 'count') {
        $distinctField=null;
        if(preg_match('/сколько\s+(?:различных\s+|уникальных\s+|разных\s+)?(улиц|фамилий|имен|отчеств|поселений|сословий)/u',aq_norm($question),$entity)) $distinctField=['улиц'=>'street','фамилий'=>'surname','имен'=>'name','отчеств'=>'patronymic','поселений'=>'settlement','сословий'=>'soslovie'][$entity[1]];
        if($distinctField) {
            $values=[]; foreach($rows as $r) if(!empty($r[$distinctField]) && $r[$distinctField]!=='Нет данных') $values[aq_norm($r[$distinctField])]=true;
            $base['answer']='Различных заполненных значений поля «'.$entity[1].'» — '.count($values).'. Подсчёт по '.$n.' записям усадеб.';
        } elseif (!preg_match('/усад|участ|запис/u',aq_norm($question)) && preg_match('/владельц|людей|человек/u', aq_norm($question))) {
            $owners = []; $missing = 0;
            foreach ($rows as $r) { if (empty($r['surname']) && empty($r['name'])) { $missing++; continue; } $owners[aq_norm(ai_person($r))] = true; }
            $base['answer'] = 'В выборке '.aq_number($n).' усадеб и '.aq_number(count($owners)).' различных записанных ФИО владельцев. Совпадающие ФИО не доказывают, что это один и тот же человек.'.($missing ? ' В '.$missing.' записях имя владельца не указано.' : '');
        } else $base['answer'] = 'В '.($plan['filters'] ? 'указанной выборке' : 'базе проекта').' '.aq_estates($n).'.';
        if (!$distinctField && ($plan['group'] || !$plan['filters'])) {
            $groups = []; $field = $plan['group'] ?? 'settlement';
            foreach ($rows as $r) { $v = $r[$field] ?: 'Не указано'; $groups[$v] = ($groups[$v] ?? 0)+1; }
            arsort($groups); $parts = []; foreach ($groups as $v=>$count) $parts[] = $v.' — '.aq_number($count);
            $base['answer'] .= '\n'.implode('; ', $parts).'.';
        }
    } elseif (in_array($op, ['mean','median','sum','max','min'], true)) {
        $known = array_values(array_filter($rows, fn($r)=>ai_area($r)>0)); $areas = array_map('ai_area', $known); sort($areas); $k=count($areas);
        if (!$k) $base['answer'] = 'В найденных записях площадь не указана; вычислить показатель нельзя.';
        elseif ($op === 'max' || $op === 'min') {
            $v = $op === 'max' ? max($areas) : min($areas); $sourceRows = array_values(array_filter($known, fn($r)=>ai_area($r)===$v));
            $parts=[]; foreach (array_slice($sourceRows,0,8) as $r) $parts[]=ai_person($r).' (№'.$r['num'].', '.$r['settlement'].')';
            $base['answer'] = ($op==='max'?'Наибольшая':'Наименьшая').' площадь — '.aq_number($v).' саж². '.implode('; ', $parts).'.';
        } else {
            $v = aq_measure($areas,$op);
            $base['answer'] = ['sum'=>'Суммарная','mean'=>'Средняя','median'=>'Медианная'][$op].' площадь — '.aq_number($v).' саж². Учтено '.$k.' усадеб с известной положительной площадью'.($n>$k?'; исключено без площади: '.($n-$k):'').'.';
            if($plan['group']) {
                $groups=[]; foreach($known as $r) $groups[$r[$plan['group']] ?: 'Не указано'][]=ai_area($r);
                $parts=[]; foreach($groups as $name=>$values) $parts[]=$name.' — '.aq_number(aq_measure($values,$op)).' саж² (участков: '.count($values).')';
                $base['answer'].="\n".implode('; ',$parts).'.';
            }
        }
    } elseif ($op === 'frequency') {
        $field=$plan['field']; $groups=[];
        foreach ($rows as $r) if (!empty($r[$field])) $groups[$r[$field]]=($groups[$r[$field]]??0)+1;
        arsort($groups);
        if (!$groups) $base['answer']='Это поле в найденных записях не заполнено.';
        else { $top=reset($groups); $values=array_keys(array_filter($groups, fn($v)=>$v===$top)); $base['answer']='Чаще всего встречается: '.ai_join_ru($values).' — по '.$top.' записям усадеб. Подсчёт выполнен по всем '.$n.' записям выборки.'; $sourceRows=array_values(array_filter($rows,fn($r)=>in_array($r[$field]??'', $values,true))); }
    } else {
        $field = $plan['field']; $q=aq_norm($question);
        $fieldIsFilter = $field && array_filter($plan['filters'], fn($f)=>$f['field']===$field);
        if ($field && !$fieldIsFilter && in_array($field,['name','surname','patronymic','rank','soslovie','street','settlement'],true)) {
            $values=[]; $missing=0; foreach($rows as $r) { if(empty($r[$field])) $missing++; else $values[$r[$field]]=($values[$r[$field]]??0)+1; }
            arsort($values); $parts=[]; foreach(array_slice($values,0,15,true) as $v=>$count) $parts[]=$v.' — '.$count;
            $label=['name'=>'Имена','surname'=>'Фамилии','patronymic'=>'Отчества','rank'=>'Чины','soslovie'=>'Сословно-профессиональные группы','street'=>'Улицы','settlement'=>'Поселения'][$field];
            $base['answer']=$label.' в найденных '.$n.' записях: '.($parts?implode('; ', $parts).'.':'не указаны.').($missing?' Поле не заполнено в '.$missing.' записях.':'');
        } else {
            $intent= preg_match('/где|улиц|адрес/u',$q)?'where':(preg_match('/кем|кто|у кого|сослов/u',$q)?'who':'summary');
            $modelIntent = ai_model_intent($config, $question);
            if ($modelIntent !== null) { $base['model_used']=true; if($intent==='summary') $intent=$modelIntent; }
            $base['answer']=ai_factual_answer($rows,$n,$intent,$question);
            $personFilters=array_values(array_filter($plan['filters'],fn($f)=>in_array($f['field'],['name','surname','patronymic'],true)));
            if(count($personFilters)===1 && $intent==='who') {
                $f=$personFilters[0]; $label=['name'=>'Имя','surname'=>'Фамилия','patronymic'=>'Отчество'][$f['field']];
                $base['answer']=$label.' «'.implode(' / ',$f['values']).'» '.(!empty($f['exclude'])?'исключено из выборки':'найдено в '.$n.' записях усадеб').'.\n'.ai_factual_answer($rows,$n,$intent,$question);
            }
            if($n>8) $base['answer'].=' Описание включает первые 8 записей; всего найдено '.$n.'.';
        }
    }
    $base['answer']=str_replace('\\n', "\n", $base['answer']);
    $base['sources']=array_map('ai_source',array_slice($sourceRows,0,$config['max_sources']));
    return $base;
}
