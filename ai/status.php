<?php
declare(strict_types=1);
require __DIR__ . '/lib.php';
$config = require __DIR__ . '/config.php';
$healthUrl = preg_replace('~/v1/chat/completions$~', '/health', $config['model_url']);
$online = false;
if (function_exists('curl_init')) {
    $ch = curl_init($healthUrl);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER=>true,CURLOPT_PROXY=>'',CURLOPT_TIMEOUT=>2,CURLOPT_CONNECTTIMEOUT=>1]);
    $raw = curl_exec($ch); $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE); curl_close($ch);
    $json = json_decode((string)$raw, true);
    $online = $status === 200 && ($json['status'] ?? '') === 'ok';
}
ai_json_response(['online'=>$online]);
