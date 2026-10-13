<?php
declare(strict_types=1);

class AiSearchCancelled extends RuntimeException {}

function ai_request_path(string $id,bool $clean=false): string {
    if(!preg_match('/^[a-f0-9]{64}$/D',$id)) throw new InvalidArgumentException('Некорректный ID запроса');
    $dir=sys_get_temp_dir().DIRECTORY_SEPARATOR.'kh-way-requests-'.substr(hash('sha256',__DIR__),0,16);
    if(!is_dir($dir) && !@mkdir($dir,0700,true) && !is_dir($dir)) throw new RuntimeException('Не удалось подготовить обработку запроса');
    // Only ephemeral IDs/statuses are stored, never questions or personal data.
    if($clean)foreach(glob($dir.DIRECTORY_SEPARATOR.'*.state') ?: [] as $file) if(@filemtime($file)<time()-300) @unlink($file);
    return $dir.DIRECTORY_SEPARATOR.$id.'.state';
}

function ai_request_begin(string $id): void {
    $path=ai_request_path($id,true); $file=@fopen($path,'x+');
    if(!$file) {
        if(ai_request_cancelled($id)) throw new AiSearchCancelled('Поиск отменён');
        throw new RuntimeException('Этот запрос уже обрабатывается');
    }
    flock($file,LOCK_EX);
    if(stream_get_contents($file)==='cancelled') {flock($file,LOCK_UN);fclose($file);throw new AiSearchCancelled('Поиск отменён');}
    fwrite($file,'running'); fflush($file); flock($file,LOCK_UN); fclose($file);
}

function ai_request_cancelled(string $id): bool {
    $path=ai_request_path($id); $file=@fopen($path,'r');
    if(!$file)return false;
    flock($file,LOCK_SH); $state=stream_get_contents($file); flock($file,LOCK_UN); fclose($file);
    return $state==='cancelled';
}

function ai_request_cancel(string $id): void {
    // A tombstone also cancels a request still waiting to reach PHP/the model.
    $file=@fopen(ai_request_path($id,true),'c+');
    if(!$file)throw new RuntimeException('Не удалось отменить запрос');
    flock($file,LOCK_EX); ftruncate($file,0); rewind($file); fwrite($file,'cancelled'); fflush($file); flock($file,LOCK_UN); fclose($file);
}

function ai_request_finish(string $id): void { @unlink(ai_request_path($id)); }

function ai_stop_model_request(array $config,string $id): bool {
    $base=preg_replace('~/v1/chat/completions$~','',$config['model_url']);
    $ch=curl_init($base.'/v1/stream?conv_id='.rawurlencode('kh-way-'.$id));
    curl_setopt_array($ch,[CURLOPT_CUSTOMREQUEST=>'DELETE',CURLOPT_PROXY=>'',CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>3,CURLOPT_CONNECTTIMEOUT=>1]);
    curl_exec($ch); $code=curl_getinfo($ch,CURLINFO_RESPONSE_CODE); curl_close($ch);
    return $code===204;
}

function ai_stream_consume(string &$buffer,string $chunk,string &$content,?string &$finish,bool &$done): void {
    $buffer.=$chunk;
    while(($newline=strpos($buffer,"\n"))!==false) {
        $line=rtrim(substr($buffer,0,$newline),"\r"); $buffer=substr($buffer,$newline+1);
        if(!str_starts_with($line,'data:'))continue;
        $value=trim(substr($line,5));
        if($value==='[DONE]') {$done=true;continue;}
        $event=json_decode($value,true);
        $delta=$event['choices'][0]['delta']['content'] ?? null;
        if(is_string($delta))$content.=$delta;
        if(is_string($event['choices'][0]['finish_reason'] ?? null))$finish=$event['choices'][0]['finish_reason'];
    }
}
