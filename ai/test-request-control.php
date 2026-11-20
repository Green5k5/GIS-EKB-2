<?php
declare(strict_types=1);
require __DIR__.'/request-control.php';
function ensure(bool $ok,string $label):void {if(!$ok)throw new RuntimeException('FAIL '.$label);echo 'PASS '.$label.PHP_EOL;}
$id=bin2hex(random_bytes(32));
try {
    ai_request_begin($id); ensure(!ai_request_cancelled($id),'New request is active');
    try {ai_request_begin($id);throw new LogicException('Duplicate accepted');}catch(RuntimeException $e){ensure(ai_request_cancelled($id)===false,'Duplicate does not erase the active request');}
    ai_request_cancel($id); ensure(ai_request_cancelled($id),'Active request can be cancelled');
    try {ai_request_begin($id);throw new LogicException('Cancelled request resumed');}catch(AiSearchCancelled $e){ensure(true,'Cancelled ID cannot restart');}
} finally {ai_request_finish($id);}
$early=bin2hex(random_bytes(32));
try {
    ai_request_cancel($early);
    try {ai_request_begin($early);throw new LogicException('Early cancel ignored');}catch(AiSearchCancelled $e){ensure(true,'Cancellation before PHP/model startup is retained');}
}finally{ai_request_finish($early);}
try {ai_request_path('../outside');throw new LogicException('Unsafe ID accepted');}catch(InvalidArgumentException $e){ensure(true,'Unsafe request IDs rejected');}
$buffer='';$text='';$finish=null;$done=false;
$events='data: '.json_encode(['choices'=>[['delta'=>['content'=>'{"operation":'], 'finish_reason'=>null]]],JSON_UNESCAPED_UNICODE)."\n\n";
$events.='data: '.json_encode(['choices'=>[['delta'=>['content'=>'"count","label":"Уктус"}'],'finish_reason'=>'stop']]],JSON_UNESCAPED_UNICODE)."\n\n"."data: [DONE]\n\n";
foreach(str_split($events,3) as $chunk)ai_stream_consume($buffer,$chunk,$text,$finish,$done);
ensure($done&&$finish==='stop'&&json_decode($text,true)['label']==='Уктус','Fragmented SSE and UTF-8 reconstruct a complete JSON plan');
