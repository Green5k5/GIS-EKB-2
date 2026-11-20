<?php
declare(strict_types=1);
require_once __DIR__.'/query.php';
require_once __DIR__.'/agent.php';
require_once __DIR__.'/scope-guard.php';
require_once __DIR__.'/request-control.php';

function hybrid_labels(): array {
    return ['surname'=>'Фамилия','name'=>'Имя','patronymic'=>'Отчество','settlement'=>'Поселение','street'=>'Историческое местоположение / улица','soslovie'=>'Сословие','buildingType'=>'Строение','sex'=>'Пол владельца','familyStatus'=>'Семейное положение','rank'=>'Чин','position'=>'Должность','serviceType'=>'Вид службы','servicePlace'=>'Место службы','registrationPlace'=>'Место приписки','area_sazh'=>'Площадь','num'=>'Номер усадьбы'];
}

function hybrid_aliases(): array {
    return ['settlement'=>['Екатеринбург'=>'екатеринбург(?:а|е|у|ом)?','Уктус'=>'уктус(?:а|е|у|ом)?','Нижне-Исетск'=>'нижне[ -]?исетск(?:а|е|у|ом)?'], 'soslovie'=>['Купцы'=>'купц(?:ы|ов|ам|ами|ах|а|у|ом)|купеч(?:еские|еских|еским|ескими|еская|еской|ескую)','Мещане'=>'мещан(?:е|ам|ами|ах|ин|ина|ину|ином)?','Дворяне'=>'дворян(?:е|ам|ами|ах|ин|ина|ину|ином)?','Крестьяне'=>'крестьян(?:е|ам|ами|ах|ин|ина|ину|ином)?','Солдаты'=>'солдат(?:ы|ам|ами|ах|а|у|ом)?','Мастеровые'=>'мастеров(?:ые|ых|ым|ыми|ой|ого)'], 'sex'=>['Мужчины'=>'мужчин(?:ы|ам|ами|ах|а|у|ой)?','Женщины'=>'женщин(?:ы|ам|ами|ах|а|у|ой)?']];
}

function hybrid_alias_question(string $q): string {
    return preg_replace('/(?:фамилией|фамилии|отчеством|именем|имени)\s+[«"]?[а-я-]+[»"]?/u',' ',$q);
}

function hybrid_intent(string $question): ?string {
    $q=aq_norm($question);
    if(preg_match('/(?:наибольш|максимальн|сам[а-я]*\s+(?:больш|крупн)).*(?:площад|участ)|(?:площад|участ).*(?:наибольш|максимальн)/u',$q)) return 'max';
    if(preg_match('/(?:наименьш|минимальн|сам[а-я]*\s+(?:мал|мелк)).*(?:площад|участ)|(?:площад|участ).*(?:наименьш|минимальн)/u',$q)) return 'min';
    if(preg_match('/медиан/u',$q))return 'median';
    if(preg_match('/средн[а-я]*\s+площад/u',$q))return 'mean';
    if(preg_match('/суммарн[а-я]*\s+площад|сумма\s+площад/u',$q))return 'sum';
    return null;
}

function hybrid_constraints(string $question, array $rows): array {
    $q=aq_norm($question); $filters=[]; $dict=aq_dictionary($rows);
    $aliasQuestion=hybrid_alias_question($q);
    foreach(hybrid_aliases() as $field=>$values) foreach($values as $value=>$pattern) if(preg_match('/(?<![а-я])(?:'.$pattern.')(?![а-я])/u',$aliasQuestion)) {
        $negative=preg_match('/(?:не\s+(?:принадлежал[а-я]*\s+)?|кроме\s+|исключая\s+)(?:'.$pattern.')/u',$q);
        $filters[]=['field'=>$field,'operator'=>$negative?'ne':'eq','value'=>$value];
    }
    if(preg_match_all('/(фамилией|фамилии|отчеством|именем|имени)\s+[«"]?([а-я-]+)[»"]?/u',$q,$people,PREG_SET_ORDER)) foreach($people as $p) {
        $field=str_starts_with($p[1],'фамил')?'surname':(str_starts_with($p[1],'отчеств')?'patronymic':'name');
        $values=[];foreach($dict[$field] as $value)if(aq_form($value,$p[2]))$values[]=$value;
        if(count($values)>1)continue;
        $filters[]=['field'=>$field,'operator'=>'eq','value'=>$values[0] ?? $p[2]];
    }
    if(preg_match('/от\s+(\d+(?:[.,]\d+)?)\s+до\s+(\d+(?:[.,]\d+)?)/u',$q,$range) && str_contains($q,'площад')) foreach(['gte'=>$range[1],'lte'=>$range[2]] as $op=>$number)$filters[]=['field'=>'area_sazh','operator'=>$op,'value'=>str_replace(',','.',$number)];
    if(str_contains($q,'площад') && preg_match('/(не меньше|не менее|не больше|не более|больше|более|свыше|меньше|менее)\s*(\d+(?:[.,]\d+)?)/u',$q,$limit)) {
        $ops=['не меньше'=>'gte','не менее'=>'gte','не больше'=>'lte','не более'=>'lte','больше'=>'gt','более'=>'gt','свыше'=>'gt','меньше'=>'lt','менее'=>'lt'];
        $filters[]=['field'=>'area_sazh','operator'=>$ops[$limit[1]],'value'=>str_replace(',','.',$limit[2])];
    }
    return $filters;
}

// Only completely consumed, simple questions use the fast route.
function hybrid_fast(string $question, array $rows): ?array {
    $q=aq_norm($question); $rest=$q; $filters=[];
    if(preg_match('/сравн|процент|доля|отношен|уникальн.*(люд|человек|владел)|\bили\b|\bне\b|кроме|исключая|по\s+(?:сослов|поселен|полу)/u',$q)) return null;
    $aliases=hybrid_aliases();
    foreach($aliases as $field=>$values) foreach($values as $value=>$pattern) {
        $pattern='/(?<![а-я])(?:'.$pattern.')(?![а-я])/u';
        if(preg_match($pattern,hybrid_alias_question($rest))) { $filters[]=['field'=>$field,'operator'=>'eq','value'=>$value]; $rest=preg_replace($pattern,' ',$rest); }
    }
    // Two values in one column need an explicit logical interpretation.
    if(count(array_unique(array_column($filters,'field')))!==count($filters)) return null;
    if(preg_match_all('/(?:с\s+)?(фамили[а-я]*|отчеств[а-я]*|именем|имени)\s+[«"]?([а-я-]+)[»"]?/u',$rest,$people,PREG_SET_ORDER)) foreach($people as $m) {
        if(in_array($m[2],['встречается','встречаются','у','есть','было','чаще','самая','какая','в','на'],true))continue;
        $field=str_starts_with($m[1],'фамил')?'surname':(str_starts_with($m[1],'отчеств')?'patronymic':'name');
        $found=[]; foreach(aq_dictionary($rows)[$field] as $value) if(aq_form($value,$m[2])) $found[]=$value;
        if(count($found)>1) return null;
        $filters[]=['field'=>$field,'operator'=>'eq','value'=>$found[0] ?? $m[2]];
        $rest=str_replace($m[0],' ',$rest);
    }
    if(str_contains($q,'площад') && preg_match('/от\s+(\d+(?:[.,]\d+)?)\s+до\s+(\d+(?:[.,]\d+)?)/u',$rest,$range)) {
        if((float)str_replace(',','.',$range[1])>(float)str_replace(',','.',$range[2]))return null;
        foreach(['gte'=>$range[1],'lte'=>$range[2]] as $operator=>$number)$filters[]=['field'=>'area_sazh','operator'=>$operator,'value'=>str_replace(',','.',$number)];
        $rest=str_replace($range[0],' ',$rest);
    }
    $op=null; $field='area_sazh';
    if(preg_match('/сколько|посчитай|количество|число/u',$rest)) $op='count';
    if(preg_match('/какие|перечисли|список/u',$rest)) $op='distinct';
    foreach(['mean'=>'средн[а-я]*','median'=>'медиан[а-я]*','sum'=>'суммарн[а-я]*|сумма','max'=>'сам[а-я]*\s+(?:больш[а-я]*|крупн[а-я]*)|максимальн[а-я]*','min'=>'сам[а-я]*\s+(?:мал[а-я]*|маленьк[а-я]*)|минимальн[а-я]*'] as $operation=>$pattern) if(preg_match('/'.$pattern.'/u',$rest)) $op=$operation;
    if(preg_match('/чаще|частая|распространенная/u',$rest)) $op='group';
    $op=hybrid_intent($q) ?? $op;
    foreach(['street'=>'улиц[а-я]*','surname'=>'фамил[а-я]*','patronymic'=>'отчеств[а-я]*','name'=>'имена|имен','settlement'=>'поселени[а-я]*','soslovie'=>'сослови[а-я]*'] as $f=>$pattern) if(preg_match('/(?<![а-я])(?:'.$pattern.')(?![а-я])/u',$rest)) { $field=$f; break; }
    if($op==='count' && $field!=='area_sazh') $op='distinct';
    if($op===null || ($op==='distinct' && $field==='area_sazh')) return null;
    $rest=preg_replace('/(?<![а-я])(?:какая|какой|какое|у\s+кого|была|большой|самого)(?![а-я])/u',' ',$rest);
    if(in_array($op,['mean','median','sum','min','max'],true) && !preg_match('/площад|участ/u',$q)) return null;
    $rest=preg_replace('/(?<![а-я])(?:сколько|посчитай|количество|число|какие|перечисли|список|чаще|частая|распространенная|сам[а-я]*|больш[а-я]*|крупн[а-я]*|маленьк[а-я]*|мал[а-я]*|средн[а-я]*|медиан[а-я]*|суммарн[а-я]*|сумма|максимальн[а-я]*|минимальн[а-я]*|площад[а-я]*|размер[а-я]*|усад[а-я]*|участ[а-я]*|запис[а-я]*|улиц[а-я]*|фамил[а-я]*|отчеств[а-я]*|имена|имен|поселени[а-я]*|сослови[а-я]*|встречается|встречаются|принадлежало|принадлежали|владельцев|владельца|владельцы|человек|людей|разных|различных|есть|было|был|были|всего|базе|база|проекте|проект|по|у|в|на|и|с|из|для|во|это)(?![а-я])/u',' ',$rest);
    if(preg_match('/[а-яa-z0-9]/u',$rest)) return null;
    return ['operation'=>$op,'field'=>$field,'filters'=>$filters,'clarification'=>''];
}

function hybrid_model(string $question, array $rows, array $config): array {
    $filter=['type'=>'object','properties'=>['field'=>['type'=>'string','enum'=>agent_fields()],'operator'=>['type'=>'string','enum'=>['eq','ne','gt','gte','lt','lte']],'value'=>['type'=>'string']], 'required'=>['field','operator','value'],'additionalProperties'=>false];
    $schema=['type'=>'object','properties'=>['operation'=>['type'=>'string','enum'=>['count','search','distinct','group','sum','mean','median','min','max']],'field'=>['type'=>'string','enum'=>agent_fields()],'filters'=>['type'=>'array','items'=>$filter,'maxItems'=>8],'clarification'=>['type'=>'string']], 'required'=>['operation','field','filters','clarification'],'additionalProperties'=>false];
    $dictionary=aq_dictionary($rows); $hints=[];
    foreach(['settlement','sex','soslovie','buildingType','serviceType','familyStatus'] as $f) $hints[$f]=array_values($dictionary[$f]);
    $prompt='Переведи русский вопрос в один запрос к реестру усадеб. Только JSON. Поля: '.json_encode(hybrid_labels(),JSON_UNESCAPED_UNICODE).'. Значения: '.json_encode($hints,JSON_UNESCAPED_UNICODE).'. Одна запись — усадьба, не уникальный человек. count считает записи; distinct перечисляет разные значения поля; group группирует по полю; min/max/mean/median/sum только area_sazh. Для count/search field=area_sazh. filters соединены И; eq равно, ne исключить, gt/gte/lt/lte площадь. value всегда строка. Фамилия, имя, отчество — разные поля. Только условия из вопроса. Склонения приводи к исторической форме, не исправляй ФИО. Если вопрос неоднозначен, требует ИЛИ, сравнения, процента, уникальных людей или фактов вне базы — заполни clarification коротким уточнением, filters=[]. Не игнорируй непонятные условия. Для списка улиц operation=distinct field=street. Не отвечай на вопрос, не считай.';
    $intent=hybrid_intent($question); $constraints=hybrid_constraints($question,$rows);
    $payload=['model'=>$config['model_name'],'messages'=>[['role'=>'system','content'=>$prompt],['role'=>'user','content'=>$question.($intent?"\nОперация определена сервером: $intent; field=area_sazh. Сохрани её.":'').($constraints?"\nУже проверенные обязательные фильтры: ".json_encode($constraints,JSON_UNESCAPED_UNICODE):'')]],'temperature'=>0,'max_tokens'=>320,'stream'=>false,'chat_template_kwargs'=>['enable_thinking'=>false],'response_format'=>['type'=>'json_object','schema'=>$schema]];
    $id=$config['request_id'] ?? bin2hex(random_bytes(32));
    if(ai_request_cancelled($id))throw new AiSearchCancelled('Поиск отменён');
    $payload['stream']=true;
    $buffer=''; $content=''; $finish=null; $done=false;
    $ch=curl_init($config['model_url']);
    curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_PROXY=>'',CURLOPT_HTTPHEADER=>['Content-Type: application/json','X-Conversation-Id: kh-way-'.$id],CURLOPT_POSTFIELDS=>json_encode($payload,JSON_UNESCAPED_UNICODE),CURLOPT_TIMEOUT=>60,CURLOPT_CONNECTTIMEOUT=>2,CURLOPT_NOPROGRESS=>false,
        CURLOPT_XFERINFOFUNCTION=>static function() use($id):int {return ai_request_cancelled($id)?1:0;},
        CURLOPT_WRITEFUNCTION=>static function($handle,string $chunk) use($id,&$buffer,&$content,&$finish,&$done):int {
            if(ai_request_cancelled($id) || strlen($buffer)+strlen($content)+strlen($chunk)>65536)return 0;
            ai_stream_consume($buffer,$chunk,$content,$finish,$done); return strlen($chunk);
        }]);
    try { $ok=curl_exec($ch); $status=curl_getinfo($ch,CURLINFO_RESPONSE_CODE); }
    finally {curl_close($ch); ai_stop_model_request($config,$id);}
    if(ai_request_cancelled($id))throw new AiSearchCancelled('Поиск отменён');
    if($ok===false || $status!==200) throw new RuntimeException('Модель пока недоступна. Простые вопросы работают без неё; для сложных запустите локальную модель.');
    $plan=json_decode($content,true);
    if(!is_array($plan) || !$done || $finish!=='stop') throw new RuntimeException('Не удалось разобрать вопрос полностью. Попробуйте указать условия короче.');
    return $plan;
}

function hybrid_run(string $question, array $rows, array $config, array $history=[]): array {
    $started=microtime(true); $effective=$question;
    if(preg_match('/\bили\b/u',aq_norm($question))) return ['answer'=>'Сформулируйте условия одной выборки. Например, спросите отдельно про купцов и мещан: объединение через «или» пока не поддерживается.','sources'=>[],'tool_calls'=>[],'model_used'=>false,'route'=>'clarification','count'=>0,'matches_label'=>'Нужно уточнение'];
    if(preg_match('/(?:в|за|на)\s+(\d{4})\s*(?:год|г\b)/u',aq_norm($question),$year) && !in_array($year[1],['1809','1810'],true)) return ['answer'=>'Реестр составлен по ведомостям 1809–1810 годов. Данных за указанный год в нём нет.','sources'=>[],'tool_calls'=>[],'model_used'=>false,'route'=>'clarification','count'=>0,'matches_label'=>'За пределами реестра'];
    if(preg_match('/уникальн[а-я]*\s+(?:люд[а-я]*|человек[а-я]*|владел[а-я]*|мужчин[а-я]*|женщин[а-я]*)/u',aq_norm($question))) return ['answer'=>'В реестре нет идентификаторов уникальных людей. Можно посчитать усадьбы или различные записанные ФИО; одинаковые ФИО не доказывают тождество людей. Уточните, какой показатель нужен.','sources'=>[],'tool_calls'=>[],'model_used'=>false,'route'=>'clarification','count'=>0,'matches_label'=>'Нужно уточнение'];
    // Replay the previous question, never model-generated prose, for short continuations.
    if(preg_match('/^а\s+(?:в|на)\s+/u',aq_norm($question))) {
        $previous=null; foreach($history as $m) if($m['role']==='user') $previous=$m['content'];
        $prior=$previous!==null?hybrid_fast($previous,$rows):null;
        $places=aq_dictionary($rows)['settlement']; $newPlace=null;
        foreach($places as $value) if(preg_match('/'.preg_quote(preg_replace('/[кг]$/u','',aq_norm($value)),'/').'[а-я]*/u',aq_norm($question))) $newPlace=$value;
        if($prior && $newPlace && preg_match('/^а\s+в\s+[а-я-]+\s*[?!.]*$/u',aq_norm($question))) {
            $prior['filters']=array_values(array_filter($prior['filters'],fn($f)=>$f['field']!=='settlement'));
            $prior['filters'][]=['field'=>'settlement','operator'=>'eq','value'=>$newPlace]; $plan=$prior; $effective=$previous.' '.$question;
        } else return ['answer'=>'Укажите полный вопрос с новыми условиями: предыдущий запрос нельзя однозначно продолжить.','sources'=>[],'tool_calls'=>[],'model_used'=>false,'route'=>'clarification','count'=>0,'matches_label'=>'Нужно уточнение'];
    } else $plan=hybrid_fast($question,$rows);
    $model=$plan===null; if($model) $plan=hybrid_model($effective,$rows,$config);
    if(!empty($plan['clarification'])) return ['answer'=>(string)$plan['clarification'],'sources'=>[],'tool_calls'=>[],'model_used'=>$model,'route'=>'clarification','count'=>0,'matches_label'=>'Нужно уточнение','elapsed_ms'=>round((microtime(true)-$started)*1000)];
    if(!isset($plan['operation'],$plan['field'],$plan['filters']) || !is_array($plan['filters'])) throw new RuntimeException('Получен неполный запрос. Уточните вопрос.');
    // Server-recognized predicates take precedence over model mistakes or omissions.
    if($model) {
        $required=hybrid_constraints($effective,$rows);
        foreach(array_unique(array_column($required,'field')) as $field) $plan['filters']=array_values(array_filter($plan['filters'],fn($f)=>($f['field'] ?? '')!==$field));
        $plan['filters']=array_merge($plan['filters'],$required);
    }
    $intent=hybrid_intent($effective);
    if($intent) { $plan['operation']=$intent; $plan['field']='area_sazh'; }
    if($model && preg_match_all('/(?:с\s+)?(фамилией|фамилии|отчеством|именем|имени)\s+[«"]?([а-я-]+)[»"]?/u',aq_norm($effective),$people,PREG_SET_ORDER)) foreach($people as $p) {
        $f=str_starts_with($p[1],'фамил')?'surname':(str_starts_with($p[1],'отчеств')?'patronymic':'name');
        if(!array_filter($plan['filters'],fn($filter)=>($filter['field'] ?? '')===$f && aq_form((string)($filter['value'] ?? ''),$p[2]))) throw new RuntimeException('Не удалось сохранить условие по ФИО. Укажите фамилию, имя и отчество отдельно.');
    }
    if($model && preg_match('/от\s+(\d+(?:[.,]\d+)?)\s+до\s+(\d+(?:[.,]\d+)?)/u',aq_norm($effective),$range)) foreach(['gte'=>$range[1],'lte'=>$range[2]] as $operator=>$number) {
        if(!array_filter($plan['filters'],fn($f)=>($f['field'] ?? '')==='area_sazh' && ($f['operator'] ?? '')===$operator && is_numeric($f['value'] ?? null) && (float)$f['value']===(float)str_replace(',','.',$number))) throw new RuntimeException('Модель не сохранила границы площади. Укажите «площадь от … до …».');
    }
    // Add only canonical synonyms actually detected in the user's question.
    $scope=str_replace(',','.',$effective);
    foreach(hybrid_aliases() as $field=>$values) foreach($values as $value=>$pattern) if(preg_match('/(?<![а-я])(?:'.$pattern.')(?![а-я])/u',hybrid_alias_question(aq_norm($effective)))) {
        $scope.=' '.$value;
        if($model && !array_filter($plan['filters'],fn($f)=>($f['field'] ?? '')===$field && aq_norm((string)($f['value'] ?? ''))===aq_norm($value))) throw new RuntimeException('Не удалось сохранить все условия вопроса. Уточните условие «'.$value.'».');
    }
    foreach($plan['filters'] as &$f) {
        if(!is_array($f) || !isset($f['field'],$f['operator'],$f['value']) || !is_string($f['field']) || !in_array($f['operator'],['eq','ne','gt','gte','lt','lte'],true) || !is_scalar($f['value'])) throw new RuntimeException('Некорректное условие запроса.');
        if(in_array($f['field'],['surname','name','patronymic'],true)) {
            $matches=[]; foreach(aq_dictionary($rows)[$f['field']] as $value) if(aq_form($value,(string)$f['value'])) $matches[]=$value;
            if(count($matches)>1) throw new RuntimeException('Написание ФИО неоднозначно. Укажите его как в реестре.');
            if($matches) $f['value']=$matches[0];
        }
    } unset($f);
    if(in_array($plan['operation'],['count','search'],true))$plan['field']='area_sazh';
    try { agent_check_scope($plan['filters'],$scope); $tool=agent_tool($plan,$rows); }
    catch(InvalidArgumentException $e) { throw new RuntimeException('Условия не удалось подтвердить по вопросу. Уточните поле и значение: '.$e->getMessage()); }
    $facts=$tool['result']; $selected=array_values(array_filter($rows,function($r) use($plan) { foreach($plan['filters'] as $f) { $a=aq_norm((string)($r[$f['field']] ?? '')); $b=aq_norm((string)$f['value']); $ok=match($f['operator']) {'eq'=>$a===$b,'ne'=>$a!==$b,'gt'=>is_numeric($a)&&(float)$a>(float)$b,'gte'=>is_numeric($a)&&(float)$a>=(float)$b,'lt'=>is_numeric($a)&&(float)$a<(float)$b,'lte'=>is_numeric($a)&&(float)$a<=(float)$b}; if(!$ok)return false; } return true; }));
    $n=count($selected); $op=$plan['operation']; $items=[]; $answer='';
    if($op==='count') $answer='По условиям вопроса: '.aq_estates($n).'.';
    elseif(in_array($op,['distinct','group'],true)) {
        $groups=[]; foreach($selected as $r) { $v=trim((string)($r[$plan['field']] ?? '')); if($v==='' || $v==='Нет данных')continue; $k=aq_norm($v); if(!isset($groups[$k]))$groups[$k]=['value'=>$v,'count'=>0,'map_ids'=>[]]; $groups[$k]['count']++; $groups[$k]['map_ids'][]=(int)$r['id']; }
        $items=array_values($groups); usort($items,$op==='group'?fn($a,$b)=>$b['count']<=>$a['count']:fn($a,$b)=>strcmp($a['value'],$b['value']));
        $answer=(hybrid_labels()[$plan['field']] ?? $plan['field']).': '.count($items).' различных заполненных значений. Без сведений: '.($facts['missing'] ?? 0).'.';
        $facts['groups']=array_map(fn($item)=>['value'=>$item['value'],'count'=>$item['count']],$items); $facts['groups_truncated']=false;
    } elseif($op==='search') {
        $answer='Найдено: '.aq_estates($n).'.'; foreach(array_slice($selected,0,50) as $r)$items[]=['value'=>ai_person($r).' · '.$r['settlement'].' · усадьба №'.$r['num'],'count'=>null,'id'=>(int)$r['id']];
    } else {
        $names=['sum'=>'Суммарная площадь','mean'=>'Средняя площадь','median'=>'Медианная площадь','min'=>'Минимальная площадь','max'=>'Максимальная площадь'];
        $answer=$facts['value']===null?'В выборке нет положительных известных площадей.':$names[$op].': '.aq_number((float)$facts['value']).' саж². Учтено: '.$facts['included'].'; без положительной площади: '.$facts['missing_or_nonpositive'].'.';
        foreach($facts['records'] ?? [] as $r)$answer.="\n".ai_person($r).' · '.$r['settlement'].' · усадьба №'.$r['num'];
    }
    if(preg_match('/мужчин|женщин|человек|людей|владельц/u',aq_norm($effective))) $answer.="\nПодсчитаны записи усадеб. Повторяющиеся владельцы могут встречаться несколько раз; это не число уникальных людей.";
    if($plan['field']==='street') $answer.="\nПриведены исторические значения поля: описания местоположений и варианты написания сохранены.";
    $labels=hybrid_labels(); $signs=['eq'=>'=','ne'=>'≠','gt'=>'>','gte'=>'≥','lt'=>'<','lte'=>'≤'];
    $description=$plan['filters']?implode(' · ',array_map(fn($f)=>$labels[$f['field']].' '.$signs[$f['operator']].' '.$f['value'],$plan['filters'])):'Весь реестр';
    $focusIds=in_array($op,['min','max'],true) && $facts['value']!==null?array_values(array_map(fn($r)=>(int)$r['id'],array_filter($selected,fn($r)=>is_numeric($r['area_sazh'] ?? null)&&(float)$r['area_sazh']===$facts['value']))):[];
    return ['answer'=>$answer,'items'=>$items,'sources'=>$tool['sources'],'tool_calls'=>[['tool'=>'query_database','arguments'=>$plan,'result'=>$facts]],'model_used'=>$model,'route'=>$model?'model':'fast','count'=>$n,'matches_label'=>'Выборка: '.$n.' записей','elapsed_ms'=>round((microtime(true)-$started)*1000),'items_truncated'=>$op==='search'&&$n>50,'map'=>['record_ids'=>array_map(fn($r)=>(int)$r['id'],$selected),'focus_ids'=>$focusIds,'question'=>$effective,'description'=>$description]];
}
