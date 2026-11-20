<?php
declare(strict_types=1);
require __DIR__.'/lib.php'; require __DIR__.'/hybrid.php';
$config=require __DIR__.'/config.php'; $rows=ai_records($config['data_files']); $failed=0; $passed=0;
function check(bool $ok,string $label): void {global $failed,$passed; $ok?$passed++:$failed++; echo ($ok?'PASS ':'FAIL ').$label.PHP_EOL;}
foreach([
 ['Сколько усадеб?',2569],['Посчитай усадьбы в Уктусе',224],['Сколько было мужчин?',2242],['Сколько женщин?',311],['Сколько усадеб в Екатеринбурге?',2102],['Сколько усадеб принадлежало купцам?',122],['Сколько усадеб у владельцев с фамилией Петров?',5],['Сколько усадеб с отчеством Петров?',63],['Сколько усадеб с именем Петр?',102],['Сколько усадеб с фамилией Несуществующаяфамилия?',0],
] as [$q,$n]) { $a=hybrid_run($q,$rows,$config);check($a['route']==='fast'&&$a['count']===$n,$q); }
$a=hybrid_run('Какие есть улицы?',$rows,$config);check(count($a['items'])===38 && !$a['tool_calls'][0]['result']['groups_truncated'],'Full street list');
$a=hybrid_run('Сколько улиц?',$rows,$config);check($a['tool_calls'][0]['result']['distinct_values']===38,'Distinct street count');
$a=hybrid_run('Какая фамилия встречается чаще всего?',$rows,$config);check($a['route']==='fast' && $a['items'][0]['value']==='Пономарев'&&$a['items'][0]['count']===23,'Surname frequency');
$a=hybrid_run('Средняя площадь усадеб купцов',$rows,$config);check($a['route']==='fast'&&$a['tool_calls'][0]['result']['value']===605.16,'Mean area');
$a=hybrid_run('А в Уктусе?',$rows,$config,[['role'=>'user','content'=>'Сколько усадеб в Екатеринбурге?']]);check($a['count']===224,'Follow-up replaces settlement');
$a=hybrid_run('Сколько уникальных мужчин?',$rows,$config);check($a['route']==='clarification','Unique people requires clarification');
foreach(['Сколько усадеб в Москве?','Сколько усадеб не купцов?','Сколько усадеб купцов или мещан?','Сколько усадеб больше 100 саженей?','Сколько усадеб со сканами?','Сколько было мужчин в 1900 году?','Сколько усадеб на Уктусской улице?'] as $q)check(hybrid_fast($q,$rows)===null,'No dropped conditions: '.$q);
$a=hybrid_run('Какие отчества у владельцев с фамилией Петров?',$rows,$config);check($a['route']==='fast'&&$a['count']===5,'Output column versus surname filter');
$a=hybrid_run('Сколько усадеб площадью от 100 до 200 в Уктусе?',$rows,$config);check($a['route']==='fast'&&$a['count']===49,'Inclusive range');
$a=hybrid_run('Сколько усадеб принадлежало купцам?',$rows,$config);
$expectedIds=array_values(array_map(fn($r)=>(int)$r['id'],array_filter($rows,fn($r)=>$r['soslovie']==='Купцы')));
check($a['map']['record_ids']===$expectedIds && count(array_unique($a['map']['record_ids']))===122,'Map IDs exactly match all 122 merchants');
check(!array_diff(array_column($a['sources'],'id'),$a['map']['record_ids']),'Source IDs belong to answer selection');
$a=hybrid_run('Какие есть улицы?',$rows,$config);
foreach($a['items'] as $item) {
 $ids=array_values(array_map(fn($r)=>(int)$r['id'],array_filter($rows,fn($r)=>aq_norm($r['street'])===aq_norm($item['value']))));
 if($ids!==$item['map_ids'] || count($ids)!==$item['count']) {check(false,'Street selection mismatch');break;}
}
check(count($a['items'])===38,'38 interactive street groups');
$a=hybrid_run('У кого был самый большой участок в Уктусе?',$rows,$config);
$extrema=array_values(array_map(fn($r)=>(int)$r['id'],array_filter($rows,fn($r)=>$r['settlement']==='Уктус'&&$r['area_sazh']==815)));
check(count($a['map']['record_ids'])===224 && $a['map']['focus_ids']===$extrema,'Maximum has full selection and exact focus IDs');
$a=hybrid_run('Сколько усадеб с фамилией Несуществующаяфамилия?',$rows,$config);check($a['map']['record_ids']===[],'Zero result has no map records');
if(in_array('--live',$argv,true)) {
 foreach([
  ['Назови владельца наибольшего по площади участка в Уктусе','max',224,'Каинов'],
  ['Подскажи сколько усадеб площадью от 100 до 200 в Уктусе?','count',count(array_filter($rows,fn($r)=>$r['settlement']==='Уктус'&&is_numeric($r['area_sazh'])&&$r['area_sazh']>=100&&$r['area_sazh']<=200)),null],
  ['Подскажи какие отчества у владельцев с фамилией Петров?','distinct',5,null],
  ['Сколько усадеб не принадлежало купцам?','count',2447,null],
 ] as [$q,$op,$n,$text]) {
  $ch=curl_init(rtrim(getenv('KH_WAY_SITE_URL') ?: 'http://kh-way','/').'/ai/search.php');curl_setopt_array($ch,[CURLOPT_PROXY=>'',CURLOPT_POST=>true,CURLOPT_RETURNTRANSFER=>true,CURLOPT_HTTPHEADER=>['Content-Type: application/json'],CURLOPT_POSTFIELDS=>json_encode(['question'=>$q],JSON_UNESCAPED_UNICODE),CURLOPT_TIMEOUT=>75]);$raw=curl_exec($ch);curl_close($ch);$a=json_decode((string)$raw,true);
  check(($a['route'] ?? '')==='model'&&($a['tool_calls'][0]['arguments']['operation'] ?? '')===$op&&($a['count'] ?? -1)===$n&&($text===null||str_contains($a['answer'] ?? '',$text)),'LIVE '.$q); echo json_encode(['answer'=>$a['answer'] ?? $a['error'] ?? 'no response','plan'=>$a['tool_calls'][0]['arguments'] ?? null,'ms'=>$a['elapsed_ms'] ?? null],JSON_UNESCAPED_UNICODE).PHP_EOL;
 }
}
echo "Passed: $passed; failed: $failed".PHP_EOL;exit($failed?1:0);
