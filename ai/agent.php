<?php
declare(strict_types=1);

function agent_fields(): array {
    return ['num','settlement','street','surname','name','patronymic','soslovie','buildingType','sex','familyStatus','rank','position','serviceType','servicePlace','registrationPlace','area_sazh'];
}

// Only a declarative, read-only query is accepted. Never execute generated code.
function agent_tool(array $args, array $records): array {
    $fields = agent_fields();
    $op = $args['operation'] ?? '';
    if (!in_array($op, ['search','count','distinct','sum','mean','median','min','max','group'], true)) throw new InvalidArgumentException('Unknown operation');
    $field = $args['field'] ?? 'area_sazh';
    if (!in_array($field, $fields, true)) throw new InvalidArgumentException('Unknown field');
    $filters = $args['filters'] ?? [];
    if (!is_array($filters) || count($filters)>8) throw new InvalidArgumentException('At most 8 filters');
    foreach ($filters as $f) {
        if (!is_array($f) || !in_array($f['field'] ?? '', $fields, true)) throw new InvalidArgumentException('Unknown filter field');
        if (!in_array($f['operator'] ?? '', ['eq','ne','contains','gt','gte','lt','lte'], true) || !is_scalar($f['value'] ?? null) || strlen((string)$f['value'])>200) throw new InvalidArgumentException('Invalid filter');
        if (in_array($f['operator'], ['gt','gte','lt','lte'], true) && ($f['field']!=='area_sazh' || !is_numeric($f['value']))) throw new InvalidArgumentException('Numeric comparisons require area_sazh and a number');
        if ($f['field']==='area_sazh' && !is_numeric($f['value'])) {
            $hints=[];
            foreach ($fields as $candidate) {
                if ($candidate==='area_sazh') continue;
                foreach($records as $r) if(ai_lower((string)($r[$candidate] ?? ''))===ai_lower((string)$f['value'])) { $hints[]=$candidate; break; }
            }
            throw new InvalidArgumentException('Поле area_sazh — числовая площадь, здесь нельзя искать текст «'.$f['value'].'».'.($hints?' Это значение найдено в полях: '.implode(', ',$hints).'. Исправь field в фильтре.':''));
        }
        if (in_array($f['field'], ['surname','name','patronymic'], true) && $f['operator']==='contains') throw new InvalidArgumentException('Personal fields require exact eq/ne, not substring matching');
    }
    $rows = array_values(array_filter($records, function($r) use ($filters) {
        foreach ($filters as $f) {
            $a = str_replace('ё','е',ai_lower(trim((string)($r[$f['field']] ?? ''))));
            $b = str_replace('ё','е',ai_lower(trim((string)$f['value'])));
            $ok = match($f['operator']) {
                'eq'=>$a===$b, 'ne'=>$a!==$b, 'contains'=>str_contains($a,$b),
                'gt'=>is_numeric($a) && (float)$a>(float)$b,
                'gte'=>is_numeric($a) && (float)$a>=(float)$b,
                'lt'=>is_numeric($a) && (float)$a<(float)$b,
                'lte'=>is_numeric($a) && (float)$a<=(float)$b,
            };
            if (!$ok) return false;
        }
        return true;
    }));
    $out = ['operation'=>$op,'filters'=>$filters,'matched_records'=>count($rows),'entity'=>'estate records, not unique people'];
    if ($op==='count') $out['value']=count($rows);
    if ($op==='group' || $op==='distinct') {
        $groups=[]; $missing=0;
        foreach($rows as $r) {
            $v=trim((string)($r[$field] ?? ''));
            if ($v==='' || $v==='Нет данных') { $missing++; continue; }
            $key=str_replace('ё','е',ai_lower($v));
            if (!isset($groups[$key])) $groups[$key]=['value'=>$v,'count'=>0];
            $groups[$key]['count']++;
        }
        usort($groups,fn($a,$b)=>$b['count']<=>$a['count']);
        $out += ['field'=>$field,'distinct_values'=>count($groups),'missing'=>$missing,'groups'=>array_slice($groups,0,15),'groups_truncated'=>count($groups)>15];
        if($op==='group' && $groups) {
            $top=array_column(array_filter($groups,fn($g)=>$g['count']===$groups[0]['count']),'value');
            $rows=array_values(array_filter($rows,fn($r)=>in_array((string)($r[$field] ?? ''),$top,true)));
        }
    }
    if (in_array($op,['sum','mean','median','min','max'],true)) {
        if ($field!=='area_sazh') throw new InvalidArgumentException('Area calculations require area_sazh');
        $known=array_values(array_filter($rows,fn($r)=>isset($r[$field]) && is_numeric($r[$field]) && (float)$r[$field]>0));
        $values=array_map(fn($r)=>(float)$r[$field],$known); sort($values); $n=count($values);
        $out += ['unit'=>'саж²','included'=>$n,'missing_or_nonpositive'=>count($rows)-$n];
        $out['value']=$n ? match($op) {
            'sum'=>array_sum($values),'mean'=>round(array_sum($values)/$n,2),
            'median'=>$n%2?$values[intdiv($n,2)]:($values[$n/2-1]+$values[$n/2])/2,
            'min'=>min($values),'max'=>max($values)
        } : null;
        if ($n && ($op==='min' || $op==='max')) $rows=array_values(array_filter($known,fn($r)=>(float)$r[$field]===$out['value']));
    }
    $samples=array_slice($rows,0,3);
    if(in_array($op,['search','min','max'],true)) {
        $out['records']=array_map(fn($r)=>array_intersect_key($r,array_flip(array_merge(agent_fields(),['source']))),$samples);
        $out['records_truncated']=count($rows)>count($samples);
    }
    return ['result'=>$out,'sources'=>array_map('ai_source',$samples)];
}
