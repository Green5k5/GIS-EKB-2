<?php
declare(strict_types=1);
return [
    'data_files' => [dirname(__DIR__) . '/js/data-records.js'],
    'model_url' => getenv('KH_WAY_MODEL_URL') ?: 'http://127.0.0.1:8080/v1/chat/completions',
    'model_name' => 'kh-way-local',
    'model_timeout' => 90,
    'thinking' => false,
    'max_sources' => 8,
];
