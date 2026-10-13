<?php
declare(strict_types=1);
require __DIR__.'/lib.php'; require __DIR__.'/request-control.php';
if($_SERVER['REQUEST_METHOD']!=='POST')ai_json_response(['error'=>'Используйте POST-запрос'],405);
$input=json_decode((string)file_get_contents('php://input'),true);
$id=is_string($input['request_id'] ?? null)?$input['request_id']:'';
try {
    ai_request_cancel($id);
    $stopped=ai_stop_model_request(require __DIR__.'/config.php',$id);
    ai_json_response(['cancelled'=>true,'model_stop_sent'=>$stopped]);
} catch(InvalidArgumentException $e) {ai_json_response(['error'=>$e->getMessage()],422);}
catch(RuntimeException $e) {ai_json_response(['error'=>$e->getMessage()],503);}
