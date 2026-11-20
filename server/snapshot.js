import { toRecord } from './workspace.js';

export function snapshot(db){
  const settlements=db.prepare("SELECT id,slug,name,color,bounds_json as bounds,sort_order as sortOrder FROM settlements WHERE active=1 ORDER BY sort_order").all().map(x=>({...x,bounds:JSON.parse(x.bounds)}));
  const plots=db.prepare("SELECT id,settlement_id as settlementId,legacy_key as legacyKey,geometry_json as geometry,focus_lat as focusLat,focus_lng as focusLng FROM plots WHERE status='active'").all().map(x=>({...x,geometry:JSON.parse(x.geometry)}));
  const records=db.prepare("SELECT * FROM records WHERE status='active' ORDER BY id").all().map(toRecord);
  const historicalFeatures=db.prepare("SELECT id,type,name,geometry_json as geometry,visible,sort_order as sortOrder FROM historical_features ORDER BY sort_order").all().map(x=>({...x,geometry:JSON.parse(x.geometry),visible:Boolean(x.visible)}));
  const overlays=db.prepare("SELECT id,file_url as fileUrl,settlement_id as settlementId,name,bounds_json as bounds,sort_order as sortOrder,opacity,visible,rotation,crop_json FROM historical_overlays ORDER BY sort_order").all().map(x=>({...x,bounds:JSON.parse(x.bounds),crop:JSON.parse(x.crop_json),visible:Boolean(x.visible)}));
  const glossary=db.prepare("SELECT id,term,category,description,aliases_json as aliases,filter_key as filterKey,filter_value as filterValue,sort_order as sortOrder FROM glossary_terms ORDER BY sort_order").all().map(x=>({...x,aliases:JSON.parse(x.aliases)}));
  const content=Object.fromEntries(db.prepare('SELECT key,value_json FROM site_content').all().map(x=>[x.key,JSON.parse(x.value_json)]));
  const warnings=db.prepare('SELECT id,settlement_id as settlementId,message FROM workspace_warnings WHERE resolved=0 ORDER BY id').all();
  return {schemaVersion:1,releaseId:null,settlements,records,plots,historicalFeatures,overlays,glossary,content,settings:{},warnings};
}
