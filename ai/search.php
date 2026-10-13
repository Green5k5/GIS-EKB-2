<?php
declare(strict_types=1);
require __DIR__ . '/lib.php';
require __DIR__ . '/hybrid.php';
$config = require __DIR__ . '/config.php';
if ($_SERVER['REQUEST_METHOD'] !== 'POST') ai_json_response(['error' => 'Используйте POST-запрос'], 405);
$input = json_decode((string)file_get_contents('php://input'), true);
$question = is_string($input['question'] ?? null) ? trim($input['question']) : '';
if (strlen($question) < 3 || strlen($question) > 1200) ai_json_response(['error' => 'Введите вопрос длиной от 3 до 300 символов'], 422);
$records = ai_records($config['data_files']);
if (!$records) ai_json_response(['error' => 'База данных временно недоступна'], 503);
$history=[];
foreach (array_slice(is_array($input['history'] ?? null)?$input['history']:[], -4) as $m) {
    if (is_array($m) && in_array($m['role'] ?? '', ['user','assistant'], true) && is_string($m['content'] ?? null) && strlen($m['content'])<=4000) $history[]=['role'=>$m['role'],'content'=>$m['content']];
}
set_time_limit(190);
$id=is_string($input['request_id'] ?? null)?$input['request_id']:bin2hex(random_bytes(32));
$status=200;
$owned=false;
ignore_user_abort(true);
try {
    ai_request_begin($id);
    $owned=true;
    $config['request_id']=$id;
    $result=hybrid_run($question,$records,$config,$history);
    if(ai_request_cancelled($id))throw new AiSearchCancelled('Поиск отменён');
} catch(AiSearchCancelled $e) {$result=['cancelled'=>true,'error'=>'Поиск отменён'];$status=499;}
catch(InvalidArgumentException $e) {$result=['error'=>$e->getMessage()];$status=422;}
catch(RuntimeException $e) {$result=['error'=>$e->getMessage()];$status=503;}
finally {if($owned)ai_request_finish($id);}
ai_json_response($result,$status);
