<?php
declare(strict_types=1);
require __DIR__.'/lib.php';
require __DIR__.'/query.php';
$config = require __DIR__.'/config.php';
$rows = ai_records($config['data_files']);
$cases = [
    ['Сколько усадеб?', count($rows)],
    ['Сколько усадеб в Уктусе?', count(array_filter($rows, fn($r)=>$r['settlement']==='Уктус'))],
    ['Сколько усадеб купцов в Екатеринбурге?', count(array_filter($rows, fn($r)=>$r['settlement']==='Екатеринбург' && $r['soslovie']==='Купцы'))],
    ['Сколько усадеб у владельцев с отчеством Петров?', count(array_filter($rows, fn($r)=>$r['patronymic']==='Петров'))],
    ['Сколько усадеб у владельцев с именем Петр?', count(array_filter($rows, fn($r)=>aq_norm($r['name'])==='петр'))],
    ['Сколько усадеб у владельцев с фамилией Петров?', count(array_filter($rows, fn($r)=>$r['surname']==='Петров'))],
    ['Сколько деревянных домов на Ломаевской улице?', count(array_filter($rows, fn($r)=>$r['street']==='Ломаевская улица' && $r['buildingType']==='Дом деревянный'))],
    ['Сколько усадеб площадью больше 1000 саженей в Уктусе?', count(array_filter($rows, fn($r)=>$r['settlement']==='Уктус' && ai_area($r)>1000))],
    ['Сколько усадеб с фамилией Несуществующий?', 0],
    ['Сколько усадеб кроме купцов?', count(array_filter($rows, fn($r)=>$r['soslovie']!=='Купцы'))],
    ['Сколько усадеб площадью от 100 до 200 в Уктусе?', count(array_filter($rows, fn($r)=>$r['settlement']==='Уктус' && ai_area($r)>=100 && ai_area($r)<=200))],
];
$failed=0;
foreach($cases as [$q,$expected]) {
    $plan=aq_plan($q,$rows); $actual=count(aq_select($rows,$plan));
    $ok=$actual===$expected && $plan['clarification']===null;
    echo ($ok?'PASS':'FAIL')." {$q} expected={$expected} actual={$actual}\n";
    if(!$ok) { echo json_encode($plan,JSON_UNESCAPED_UNICODE)."\n"; $failed++; }
}
foreach ([['Сколько усадеб на Марсе?','clarification'], ['Петров','clarification']] as [$q,$key]) {
    if (aq_plan($q,$rows)[$key] === null) { echo "FAIL no clarification: {$q}\n"; $failed++; }
}
$followup=aq_answer('А в Уктусе?', $rows, $config, 'Сколько усадеб?');
if ($followup['count']!==224 || !str_contains($followup['answer'],'224 усадьбы')) {echo "FAIL followup\n"; $failed++;}
$patronymics=aq_select($rows,aq_plan('У кого отчество Петров?',$rows));
foreach($patronymics as $r) if($r['patronymic']!=='Петров') {echo "FAIL patronymic leak\n"; $failed++;}
$streets=aq_answer('Сколько улиц?', $rows, $config);
$expectedStreets=count(array_unique(array_map('aq_norm',array_filter(array_column($rows,'street'),fn($v)=>$v!=='' && $v!=='Нет данных'))));
if(!str_contains($streets['answer'], '— '.$expectedStreets.'.')) {echo "FAIL unique streets expected={$expectedStreets} ".json_encode($streets,JSON_UNESCAPED_UNICODE)."\n"; $failed++;}
$zero=aq_answer('Сколько усадеб с фамилией Несуществующий?', $rows, $config);
if($zero['count']!==0 || $zero['sources']!==[]) {echo "FAIL zero fallback\n"; $failed++;}
$max=aq_answer('У кого самый большой участок в Уктусе?', $rows,$config);
if(!str_contains($max['answer'],'815 саж²') || count($max['sources'])!==1) {echo "FAIL max\n"; $failed++;}
foreach(['У кого был самый большой участок в Уктусе?','Какая фамилия встречается чаще всего?','Средняя площадь усадеб купцов','О чем проект?'] as $q) {
    $answer=aq_answer($q,$rows,$config); echo $q."\n".$answer['answer']."\n";
}
exit($failed?1:0);
