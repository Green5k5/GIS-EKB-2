<?php
declare(strict_types=1);

// Check provenance of filter values, not conversational intent. Derived values
// from earlier tool results are allowed; invented examples from a prompt are not.
function agent_check_scope(array $filters, string $context): void {
    $context=str_replace('ё','е',ai_lower($context));
    preg_match_all('/[а-яa-z0-9-]+/u',$context,$tokens);
    foreach($filters as $f) {
        if(!is_array($f) || !is_scalar($f['value'] ?? null)) throw new InvalidArgumentException('Invalid filter value');
        $value=str_replace('ё','е',ai_lower(trim((string)$f['value'])));
        if($value==='') throw new InvalidArgumentException('Empty filter value is ambiguous; request a clarification');
        if(is_numeric($value)) {
            if(!preg_match('/(?<![0-9])'.preg_quote($value,'/').'(?![0-9])/u',$context)) throw new InvalidArgumentException('Filter value '.$value.' is not supported by the question or previous tool results. Do not invent restrictions.');
            continue;
        }
        preg_match_all('/[а-яa-z0-9-]+/u',$value,$words);
        foreach($words[0] as $word) {
            $ok=false;
            foreach($tokens[0] as $token) {
                if($word===$token) {$ok=true; break;}
                if(in_array($f['field'] ?? '',['surname','name','patronymic'],true)) {
                    foreach(['а','у','ом','е','ы','и','ой','у','ю'] as $ending) if($token===$word.$ending) {$ok=true; break;}
                } else {
                    $a=preg_replace('/(ская|ской|скую|ский|ского|ские|ских|ный|ные|ных|ной|ного|ая|ой|ую|ое|ые|ий|ый|ов|ам|ах|ом|ы|и|а|я|е|у|ю)$/u','',$word);
                    $b=preg_replace('/(ская|ской|скую|ский|ского|ские|ских|ный|ные|ных|ной|ного|ая|ой|ую|ое|ые|ий|ый|ов|ам|ах|ом|ы|и|а|я|е|у|ю)$/u','',$token);
                    if(strlen($a)>=6 && $a===$b) {$ok=true; break;}
                }
            }
            if(!$ok) throw new InvalidArgumentException('Filter value '.$value.' is not supported by the question or previous tool results. Remove invented restrictions and correct the query.');
        }
    }
}

function agent_grounding_issues(string $answer, array $trace, string $question): array {
    $issues=[]; $people=[];
    $evidence=json_encode(array_column($trace,'result'),JSON_UNESCAPED_UNICODE)."\n".$question.' 1809 1810';
    preg_match_all('/\d+(?:[ \x{00a0}\x{202f}]\d{3})*(?:[.,]\d+)?/u',$evidence,$values);
    $numbers=array_map(fn($n)=>(float)str_replace([',',' ',"\u{00a0}","\u{202f}"],['.','','',''],$n),$values[0]);
    foreach($trace as $step) foreach(['records','groups'] as $key) if(isset($step['result'][$key])) $numbers[]=count($step['result'][$key]);
    preg_match_all('/\d+(?:[ \x{00a0}\x{202f}]\d{3})*(?:[.,]\d+)?/u',$answer,$claims);
    foreach($claims[0] as $claim) {
        $n=(float)str_replace([',',' ',"\u{00a0}","\u{202f}"],['.','','',''],$claim);
        if(!array_filter($numbers,fn($v)=>abs($v-$n)<0.011)) $issues[]='Число «'.$claim.'» отсутствует в результатах инструментов. Не придумывай значения.';
    }
    foreach($trace as $step) {
        foreach($step['result']['records'] ?? [] as $r) foreach(['surname','name','patronymic'] as $field) if(!empty($r[$field])) $people[(string)$r[$field]]=true;
        if(in_array($step['result']['field'] ?? '',['surname','name','patronymic'],true)) foreach($step['result']['groups'] ?? [] as $g) $people[(string)$g['value']]=true;
    }
    preg_match_all('/(?<![а-яА-Я])[А-ЯЁ][а-яё-]{2,}/u',$answer,$words);
    foreach($words[0] as $word) {
        $normalized=str_replace('ё','е',ai_lower($word));
        $valid=false;
        foreach(array_keys($people) as $person) {
            $p=str_replace('ё','е',ai_lower($person));
            if($normalized===$p) {$valid=true; break;}
            foreach(['а','у','ом','е','ы','и','ой','ю'] as $ending) if($normalized===$p.$ending) {$valid=true; break;}
        }
        if($valid) continue;
        foreach(array_keys($people) as $person) {
            $p=str_replace('ё','е',ai_lower($person));
            if(strlen($p)>=8 && levenshtein($normalized,$p)<=2) { $issues[]='В тексте «'.$word.'», а в записи «'.$person.'». Копируй ФИО точно, не исправляй историческое написание.'; break; }
        }
    }
    return array_values(array_unique($issues));
}

function agent_calculate(array $args, string $context): array {
    $op=$args['operation'] ?? '';
    if(!in_array($op,['add','subtract','multiply','divide','percentage'],true)) throw new InvalidArgumentException('Неизвестная арифметическая операция');
    foreach(['a','b'] as $key) {
        if(!is_numeric($args[$key] ?? null) || !is_finite((float)$args[$key]) || abs((float)$args[$key])>1e12) throw new InvalidArgumentException('Допустимы конечные числа до 1e12');
        agent_check_scope([['field'=>'area_sazh','value'=>(string)$args[$key]]],$context);
    }
    $a=(float)$args['a']; $b=(float)$args['b'];
    if(in_array($op,['divide','percentage'],true) && $b==0) throw new InvalidArgumentException('Деление на ноль недопустимо');
    $value=match($op) { 'add'=>$a+$b,'subtract'=>$a-$b,'multiply'=>$a*$b,'divide'=>$a/$b,'percentage'=>100*$a/$b };
    return ['operation'=>$op,'a'=>$a,'b'=>$b,'value'=>round($value,2),'unit'=>$op==='percentage'?'%':''];
}
