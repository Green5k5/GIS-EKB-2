<?php
declare(strict_types=1);
require __DIR__.'/lib.php';
require __DIR__.'/native-agent.php';
$config=require __DIR__.'/config.php';
$rows=ai_records($config['data_files']);
$failed=0;
$fixture=[['surname'=>'Тестов','name'=>'Ефим','area_sazh'=>10],['area_sazh'=>20],['area_sazh'=>30],['area_sazh'=>0],['area_sazh'=>'']];
foreach(['sum'=>60,'mean'=>20,'median'=>20,'min'=>10,'max'=>30] as $op=>$expected) {
    $result=agent_tool(['operation'=>$op,'field'=>'area_sazh','filters'=>[]],$fixture)['result'];
    if($result['value']!=$expected || $result['included']!==3 || $result['missing_or_nonpositive']!==2) {echo "FAIL statistic $op\n"; $failed++;}
}
$evidence=[['result'=>['value'=>815,'records'=>[['surname'=>'Каинов','name'=>'Ефим','num'=>'8']]]]];
if(agent_grounding_issues('815 саж², Ефиму Каинову, усадьба №8',$evidence,'')!==[]) {echo "FAIL valid grounding\n"; $failed++;}
if(!agent_grounding_issues('Ефим Кайнов, 999 саж²',$evidence,'')) {echo "FAIL unsupported claims accepted\n"; $failed++;}
$calculation=agent_calculate(['operation'=>'subtract','a'=>2102,'b'=>224],'2102;224');
if($calculation['value']!=1878) {echo "FAIL arithmetic\n"; $failed++;}
try {agent_calculate(['operation'=>'divide','a'=>2102,'b'=>0],'2102;0');echo "FAIL zero division\n";$failed++;} catch(InvalidArgumentException $e) {}
try {agent_check_scope([['field'=>'surname','value'=>'Петров']],'Какая фамилия встречается чаще всего?');echo "FAIL invented filter\n";$failed++;} catch(InvalidArgumentException $e) {}
foreach(['patronymic'=>'Петров','surname'=>'Петров','name'=>'Петр'] as $field=>$value) {
    $expected=count(array_filter($rows,fn($r)=>str_replace('ё','е',ai_lower($r[$field]))===str_replace('ё','е',ai_lower($value))));
    $actual=agent_tool(['operation'=>'count','field'=>'area_sazh','filters'=>[['field'=>$field,'operator'=>'eq','value'=>$value]]],$rows)['result']['value'];
    echo "$field expected=$expected actual=$actual\n";
    if($expected!==$actual) $failed++;
}
foreach([
    ['operation'=>'count','field'=>'area_sazh','filters'=>[['field'=>'name','operator'=>'contains','value'=>'Петр']]],
    ['operation'=>'count','field'=>'invalid','filters'=>[]],
    ['operation'=>'count','field'=>'area_sazh','filters'=>[['field'=>'surname','operator'=>'gt','value'=>'10']]],
    ['operation'=>'max','field'=>'area_sazh','filters'=>[['field'=>'area_sazh','operator'=>'eq','value'=>'Уктус']]],
] as $bad) {
    try {agent_tool($bad,$rows); echo "FAIL unsafe filter\n"; $failed++;} catch(InvalidArgumentException $e) {echo "PASS rejected invalid query\n";}
}
if(in_array('--live',$argv,true)) {
    $liveCases=[
        ['Сколько усадеб?','count',2569,null],
        ['Сколько усадеб у владельцев с отчеством Петров?','count',63,'patronymic'],
        ['У кого самый большой участок в Уктусе?','max',224,'settlement'],
        ['Какая фамилия встречается чаще всего?','group',2569,null],
    ];
    $only=array_search('--only',$argv,true);
    if($only!==false) $liveCases=array_slice($liveCases,(int)($argv[$only+1] ?? 0),1);
    foreach($liveCases as [$q,$operation,$expected,$filter]) {
        try {
            $a=agent_run($q,$rows,$config);
            $first=$a['tool_calls'][0]['arguments'] ?? [];
            $ok=($operation==='group'?in_array($first['operation'] ?? '',['group','distinct'],true):($first['operation'] ?? '')===$operation) && $a['count']===$expected;
            if ($filter) $ok=$ok && in_array($filter,array_column($first['filters'] ?? [],'field'),true);
            if ($operation==='max') $ok=$ok && str_contains($a['answer'],'815');
            if ($operation==='max') $ok=$ok && str_contains($a['answer'],'Каинов') && str_contains($a['answer'],'Ефим');
            if ($operation==='group') $ok=$ok && str_contains($a['answer'],'Пономарев');
            if ($operation==='group') $ok=$ok && ($first['field'] ?? '')==='surname';
            if ($operation==='count') $ok=$ok && str_contains(preg_replace('/[\s\x{00a0}\x{202f}]/u','',$a['answer']),(string)$expected);
            if(!$ok) $failed++;
            echo ($ok?'PASS ':'FAIL ').$q."\n".$a['answer']."\n".json_encode($first,JSON_UNESCAPED_UNICODE)."\n";
        }
        catch(RuntimeException $e) {echo 'FAIL '.$e->getMessage()."\n"; $failed++;}
    }
}
if(in_array('--context',$argv,true)) {
    $history=[['role'=>'user','content'=>'Сколько усадеб?'],['role'=>'assistant','content'=>'В реестре 2569 усадеб.']];
    try {
        $a=agent_run('А в Уктусе?',$rows,$config,$history);
        $ok=$a['count']===224 && str_contains($a['answer'],'224');
        if(!$ok) $failed++;
        echo ($ok?'PASS':'FAIL')." follow-up\n".$a['answer']."\n";
    } catch(RuntimeException $e) {echo 'FAIL '.$e->getMessage()."\n"; $failed++;}
}
exit($failed?1:0);
