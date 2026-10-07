import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import { loadEnv } from './env.js';
loadEnv();
import { db, initDb } from './db.js';
initDb();

const root = path.resolve('.');
const port = Number(process.env.PORT || 3000);
const adminKey = process.env.ADMIN_KEY || '';
const sessionTtlMs = Number(process.env.SESSION_TTL_HOURS || 12) * 3600_000;
const sessions = new Map();

function json(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
function html(res, status, body) { res.writeHead(status, {'Content-Type':'text/html; charset=utf-8'}); res.end(body); }
function parseCookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf('='); return [x.slice(0,i), decodeURIComponent(x.slice(i+1))]})); }
function safeEqual(a,b){ const aa=Buffer.from(String(a)); const bb=Buffer.from(String(b)); return aa.length===bb.length && crypto.timingSafeEqual(aa,bb); }
function makeToken(){ return crypto.randomBytes(32).toString('hex'); }
function sessionFrom(req){ const c=parseCookies(req); const s=sessions.get(c.gis_session); if(!s || s.expires < Date.now()){ if(c.gis_session) sessions.delete(c.gis_session); return null; } return s; }
function mutationAllowed(req){
  const origin=req.headers.origin;
  if(!origin) return false;
  const host=req.headers.host;
  try { return new URL(origin).host===host; } catch { return false; }
}
async function body(req){ let s=''; for await(const chunk of req) s+=chunk; return s ? JSON.parse(s) : {}; }
function rowRecord(x){ return {...x}; }
function snapshot(){
  const settlements=db.prepare("SELECT id,slug,name,color,bounds_json as bounds,sort_order as sortOrder FROM settlements WHERE active=1 ORDER BY sort_order").all().map(x=>({...x,bounds:JSON.parse(x.bounds)}));
  const plots=db.prepare("SELECT id,settlement_id as settlementId,legacy_key as legacyKey,geometry_json as geometry,focus_lat as focusLat,focus_lng as focusLng FROM plots WHERE status='active'").all().map(x=>({...x,geometry:JSON.parse(x.geometry)}));
  const records=db.prepare("SELECT id,num,settlement_id as settlementId,street,building_type as buildingType,surname,name,patronymic,soslovie,family_status as familyStatus,sex,service_type as serviceType,rank,position,service_place as servicePlace,registration_place as registrationPlace,area_sazh,source,scan_url as scanUrl,lat,lng,plot_id as plotId FROM records WHERE status='active' ORDER BY id").all();
  const historicalFeatures=db.prepare("SELECT id,type,name,geometry_json as geometry,visible,sort_order as sortOrder FROM historical_features ORDER BY sort_order").all().map(x=>({...x,geometry:JSON.parse(x.geometry),visible:Boolean(x.visible)}));
  const overlays=db.prepare("SELECT id,file_url as fileUrl,settlement_id as settlementId,name,bounds_json as bounds,sort_order as sortOrder,opacity,visible FROM historical_overlays ORDER BY sort_order").all().map(x=>({...x,bounds:JSON.parse(x.bounds),visible:Boolean(x.visible)}));
  const glossary=db.prepare("SELECT id,term,category,description,aliases_json as aliases,filter_key as filterKey,filter_value as filterValue,sort_order as sortOrder FROM glossary_terms ORDER BY sort_order").all().map(x=>({...x,aliases:JSON.parse(x.aliases)}));
  const content=Object.fromEntries(db.prepare('SELECT key,value_json FROM site_content').all().map(x=>[x.key,JSON.parse(x.value_json)]));
  return {schemaVersion:1,releaseId:null,settlements,records,plots,historicalFeatures,overlays,glossary,content,settings:{}};
}
function publicSnapshot(){ const r=db.prepare('SELECT id,snapshot_json FROM releases ORDER BY id DESC LIMIT 1').get(); if(!r) return {...snapshot(),releaseId:null}; const s=JSON.parse(r.snapshot_json); s.releaseId=r.id; return s; }
function adminStats(){ return {records:db.prepare("SELECT COUNT(*) n FROM records WHERE status='active'").get().n,plots:db.prepare("SELECT COUNT(*) n FROM plots WHERE status='active'").get().n,settlements:db.prepare("SELECT COUNT(*) n FROM settlements WHERE active=1").get().n,releases:db.prepare('SELECT COUNT(*) n FROM releases').get().n}; }

function requireAuth(req,res){ const s=sessionFrom(req); if(!s){ json(res,401,{error:'AUTH_REQUIRED'}); return null; } return s; }
function requireMutation(req,res){ if(!mutationAllowed(req)){ json(res,403,{error:'BAD_ORIGIN'}); return false; } return true; }

function serveFile(res, file, type){
  const p=path.resolve(root,file); if(!p.startsWith(root) || !fs.existsSync(p) || !fs.statSync(p).isFile()) return false;
  res.writeHead(200, {'Content-Type':type || 'application/octet-stream'}); fs.createReadStream(p).pipe(res); return true;
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};


function parseCsv(text){
  const rows=[]; let row=[], cell='', quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];
    if(quoted){if(c==='\"'&&text[i+1]==='\"'){cell+='\"';i++;}else if(c==='\"')quoted=false;else cell+=c;}
    else if(c==='\"')quoted=true; else if(c===','){row.push(cell);cell='';}
    else if(c==='\n'){row.push(cell);rows.push(row);row=[];cell='';} else if(c!=='\r')cell+=c;
  }
  if(cell!==''||row.length){row.push(cell);rows.push(row);} if(!rows.length)return [];
  const headers=rows.shift().map(x=>x.trim()); return rows.filter(r=>r.some(Boolean)).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??''])));
}
function validateGeometry(g){
  if(!g||g.type!=='Polygon'||!Array.isArray(g.coordinates)||g.coordinates.length!==1) throw new Error('Нужен Polygon с одним внешним кольцом');
  const ring=g.coordinates[0]; if(ring.length<4)throw new Error('Кольцо должно содержать минимум 4 точки');
  for(const p of ring){if(!Array.isArray(p)||p.length<2||!Number.isFinite(Number(p[0]))||!Number.isFinite(Number(p[1]))||Math.abs(Number(p[0]))>180||Math.abs(Number(p[1]))>90)throw new Error('Некорректные координаты');}
  const a=ring[0],z=ring[ring.length-1]; if(Number(a[0])!==Number(z[0])||Number(a[1])!==Number(z[1]))throw new Error('Кольцо не замкнуто');
}
function normalizeRecord(b){return {id:b.id==null?null:Number(b.id),num:String(b.num??''),settlementId:b.settlementId||b.settlement||'',street:b.street||'',buildingType:b.buildingType||'',surname:b.surname||'',name:b.name||'',patronymic:b.patronymic||'',soslovie:b.soslovie||'',familyStatus:b.familyStatus||'',sex:b.sex||'',serviceType:b.serviceType||'',rank:b.rank||'',position:b.position||'',servicePlace:b.servicePlace||'',registrationPlace:b.registrationPlace||'',area_sazh:b.area_sazh===''||b.area_sazh==null?null:Number(b.area_sazh),source:b.source||'',scanUrl:b.scanUrl||'',lat:b.lat===''||b.lat==null?null:Number(b.lat),lng:b.lng===''||b.lng==null?null:Number(b.lng),plotId:b.plotId===''||b.plotId==null?null:Number(b.plotId)};}
function validateImportRows(rows,mode,settlementId){
 const errors=[], actions={create:0,update:0,archive:0,skip:0}, valid=[]; const settlements=new Set(db.prepare('SELECT id FROM settlements').all().map(x=>x.id));
 rows.forEach((raw,i)=>{try{const r=normalizeRecord(raw); if(!r.num||!r.settlementId)throw new Error('Нужны num и settlementId'); if(!settlements.has(r.settlementId))throw new Error('Неизвестное поселение'); if(settlementId&&r.settlementId!==settlementId)throw new Error('Другая область'); if(r.area_sazh!=null&&!Number.isFinite(r.area_sazh))throw new Error('Некорректная площадь'); let ex=r.id?db.prepare("SELECT id FROM records WHERE id=? AND status='active'").get(r.id):null; if(!ex)ex=db.prepare("SELECT id FROM records WHERE settlement_id=? AND num=? AND status='active'").get(r.settlementId,r.num); if(mode==='add'&&ex){actions.skip++;throw new Error('Конфликт существующей записи');} if(ex)actions.update++;else actions.create++; valid.push(r);}catch(e){errors.push({row:i+2,message:e.message});}});
 if(mode==='replace'&&settlementId){const ids=new Set(valid.map(r=>r.id).filter(Boolean));actions.archive=db.prepare("SELECT id FROM records WHERE settlement_id=? AND status='active'").all(settlementId).filter(x=>!ids.has(x.id)).length;}
 return {total:rows.length,valid:valid.length,errors,actions};
}

const server=http.createServer(async (req,res)=>{
  try {
    const url=new URL(req.url, `http://${req.headers.host}`);
    if(url.pathname==='/api/admin/login' && req.method==='POST'){
      if(!adminKey){ json(res,503,{error:'ADMIN_KEY_NOT_CONFIGURED'}); return; }
      const b=await body(req); if(!safeEqual(b.key || '',adminKey)){ json(res,401,{error:'INVALID_KEY'}); return; }
      const token=makeToken(), csrf=makeToken(); sessions.set(token,{expires:Date.now()+sessionTtlMs,csrf});
      json(res,200,{ok:true}, {'Set-Cookie':[`gis_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(sessionTtlMs/1000)}`,`gis_csrf=${csrf}; SameSite=Strict; Path=/; Max-Age=${Math.floor(sessionTtlMs/1000)}`]}); return;
    }
    if(url.pathname==='/api/admin/session' && req.method==='GET'){ const s=sessionFrom(req); json(res,200,{authenticated:Boolean(s),expires:s?.expires||null}); return; }
    if(url.pathname==='/api/admin/logout' && req.method==='POST'){
      if(!requireMutation(req,res)) return; const c=parseCookies(req); sessions.delete(c.gis_session); json(res,200,{ok:true},{'Set-Cookie':['gis_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0','gis_csrf=; SameSite=Strict; Path=/; Max-Age=0']}); return;
    }
    if(url.pathname.startsWith('/api/admin/')){
      const s=requireAuth(req,res); if(!s)return;
      if(['POST','PATCH','DELETE'].includes(req.method)) { const c=parseCookies(req); if(!mutationAllowed(req) || c.gis_csrf !== s.csrf || req.headers['x-csrf-token'] !== s.csrf){ json(res,403,{error:'CSRF'}); return; } }
      if(url.pathname==='/api/admin/stats' && req.method==='GET'){ json(res,200,adminStats()); return; }
      if(url.pathname==='/api/admin/records' && req.method==='GET'){
        const q=(url.searchParams.get('q')||'').trim(); const settlement=url.searchParams.get('settlement')||''; const limit=Math.min(Number(url.searchParams.get('limit')||100),500); const offset=Math.max(Number(url.searchParams.get('offset')||0),0);
        const where=["r.status='active'"]; const args=[]; if(q){where.push("(CAST(r.id AS TEXT) LIKE ? OR r.num LIKE ? OR r.surname LIKE ? OR r.name LIKE ? OR r.patronymic LIKE ?)"); args.push(...Array(5).fill(`%${q}%`));} if(settlement){where.push('r.settlement_id=?');args.push(settlement);}
        const sql=`SELECT r.*,s.name settlement FROM records r JOIN settlements s ON s.id=r.settlement_id WHERE ${where.join(' AND ')} ORDER BY r.id LIMIT ? OFFSET ?`; args.push(limit,offset); const rows=db.prepare(sql).all(...args); const total=db.prepare(`SELECT COUNT(*) n FROM records r WHERE ${where.join(' AND ')}`).get(...args.slice(0,-2)).n; json(res,200,{items:rows,total,limit,offset}); return;
      }
      if(url.pathname==='/api/admin/records' && req.method==='POST'){
        const b=await body(req); if(!b.num || !b.settlementId){json(res,422,{error:'num and settlementId required'});return;} const max=db.prepare('SELECT COALESCE(MAX(id),0)+1 id FROM records').get().id;
        db.prepare(`INSERT INTO records(id,num,settlement_id,street,building_type,surname,name,patronymic,soslovie,family_status,sex,service_type,rank,position,service_place,registration_place,area_sazh,source,scan_url,lat,lng,plot_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(max,String(b.num),b.settlementId,b.street||'',b.buildingType||'',b.surname||'',b.name||'',b.patronymic||'',b.soslovie||'',b.familyStatus||'',b.sex||'',b.serviceType||'',b.rank||'',b.position||'',b.servicePlace||'',b.registrationPlace||'',b.area_sazh ?? null,b.source||'',b.scanUrl||'',b.lat ?? null,b.lng ?? null,b.plotId ?? null);
        json(res,201,{id:max}); return;
      }
      const rm=url.pathname.match(/^\/api\/admin\/records\/(\d+)$/);
      if(rm){ const id=Number(rm[1]); if(req.method==='GET'){const r=db.prepare('SELECT * FROM records WHERE id=?').get(id); if(!r){json(res,404,{error:'NOT_FOUND'});return;} json(res,200,r);return;} if(req.method==='PATCH'){const b=await body(req); const allowed=['num','settlementId','street','buildingType','surname','name','patronymic','soslovie','familyStatus','sex','serviceType','rank','position','servicePlace','registrationPlace','area_sazh','source','scanUrl','lat','lng','plotId']; const map={settlementId:'settlement_id',buildingType:'building_type',familyStatus:'family_status',serviceType:'service_type',servicePlace:'service_place',registrationPlace:'registration_place',scanUrl:'scan_url',area_sazh:'area_sazh',plotId:'plot_id'}; const parts=[],args=[]; for(const k of allowed) if(Object.prototype.hasOwnProperty.call(b,k)){parts.push(`${map[k]||k}=?`);args.push(b[k] === '' ? '' : b[k]);} if(!parts.length){json(res,422,{error:'NO_FIELDS'});return;} parts.push('updated_at=CURRENT_TIMESTAMP'); args.push(id); db.prepare(`UPDATE records SET ${parts.join(',')} WHERE id=?`).run(...args); json(res,200,{ok:true});return;} if(req.method==='DELETE'){db.prepare("UPDATE records SET status='archived',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);json(res,200,{ok:true});return;} }
      if(url.pathname==='/api/admin/plots' && req.method==='GET'){ const rows=db.prepare("SELECT p.*,s.name settlement FROM plots p JOIN settlements s ON s.id=p.settlement_id WHERE p.status='active' ORDER BY p.id").all(); json(res,200,{items:rows.map(x=>({...x,geometry:JSON.parse(x.geometry_json),record_ids:db.prepare("SELECT id FROM records WHERE plot_id=? AND status=\'active\' ORDER BY id").all(x.id).map(r=>r.id)}))}); return; }
      if(url.pathname==='/api/admin/plots' && req.method==='POST'){const b=await body(req);try{validateGeometry(b.geometry);if(!b.settlementId||!b.legacyKey)throw new Error('settlementId и legacyKey обязательны');const r=db.prepare('INSERT INTO plots(settlement_id,legacy_key,geometry_json,focus_lat,focus_lng) VALUES(?,?,?,?,?)').run(b.settlementId,String(b.legacyKey),JSON.stringify(b.geometry),b.focusLat??null,b.focusLng??null);json(res,201,{id:Number(r.lastInsertRowid)});}catch(e){json(res,422,{error:e.message});}return;}
      const pm=url.pathname.match(/^\/api\/admin\/plots\/(\d+)$/); if(pm){const id=Number(pm[1]); if(req.method==='GET'){const p=db.prepare("SELECT p.*,s.name settlement FROM plots p JOIN settlements s ON s.id=p.settlement_id WHERE p.id=?").get(id);if(!p){json(res,404,{error:'NOT_FOUND'});return;}p.geometry=JSON.parse(p.geometry_json);p.record_ids=db.prepare("SELECT id FROM records WHERE plot_id=? AND status='active' ORDER BY id").all(id).map(x=>x.id);json(res,200,p);return;} if(req.method==='PATCH'){const b=await body(req);try{if(b.geometry)validateGeometry(b.geometry);const map={settlementId:'settlement_id',legacyKey:'legacy_key',geometry:'geometry_json',focusLat:'focus_lat',focusLng:'focus_lng'},parts=[],args=[];for(const k of Object.keys(map))if(Object.prototype.hasOwnProperty.call(b,k)){parts.push(map[k]+'=?');args.push(k==='geometry'?JSON.stringify(b[k]):b[k]);}if(!parts.length){json(res,422,{error:'NO_FIELDS'});return;}args.push(id);db.prepare('UPDATE plots SET '+parts.join(',')+' WHERE id=?').run(...args);json(res,200,{ok:true});}catch(e){json(res,422,{error:e.message});}return;} if(req.method==='DELETE'){const used=db.prepare("SELECT COUNT(*) n FROM records WHERE plot_id=? AND status='active'").get(id).n;if(used){json(res,409,{error:'PLOT_IN_USE',records:used});return;}db.prepare("UPDATE plots SET status='archived' WHERE id=?").run(id);json(res,200,{ok:true});return;}}
      if(url.pathname==='/api/admin/settlements' && req.method==='GET'){json(res,200,db.prepare("SELECT id,slug,name,color,bounds_json as bounds,sort_order as sortOrder FROM settlements WHERE active=1 ORDER BY sort_order").all().map(x=>({...x,bounds:JSON.parse(x.bounds)})));return;}
      if(url.pathname==='/api/admin/imports' && req.method==='POST'){const b=await body(req);try{const rows=b.kind==='csv'?parseCsv(b.content||''):JSON.parse(b.content||'[]');if(!Array.isArray(rows))throw new Error('JSON должен быть массивом');const report=validateImportRows(rows,b.mode||'add',b.settlementId||null);const r=db.prepare('INSERT INTO imports(kind,mode,status,report_json,payload_json) VALUES(?,?,?,?,?)').run(b.kind||'json',b.mode||'add',report.errors.length?'invalid':'validated',JSON.stringify(report),JSON.stringify({rows,settlementId:b.settlementId||null}));json(res,200,{id:Number(r.lastInsertRowid),canApply:!report.errors.length&&report.valid>0,report});}catch(e){json(res,422,{error:e.message});}return;}
      const im=url.pathname.match(/^\/api\/admin\/imports\/(\d+)\/apply$/); if(im&&req.method==='POST'){const rec=db.prepare('SELECT * FROM imports WHERE id=?').get(Number(im[1]));if(!rec){json(res,404,{error:'NOT_FOUND'});return;}if(rec.status!=='validated'){json(res,409,{error:'IMPORT_NOT_VALIDATED'});return;}const payload=JSON.parse(rec.payload_json);const rows=payload.rows.map(normalizeRecord);db.exec('BEGIN');try{for(const r of rows){let ex=r.id?db.prepare("SELECT id FROM records WHERE id=? AND status='active'").get(r.id):null;if(!ex)ex=db.prepare("SELECT id FROM records WHERE settlement_id=? AND num=? AND status='active'").get(r.settlementId,r.num);if(rec.mode==='add'&&ex)continue;if(ex){db.prepare('UPDATE records SET num=?,settlement_id=?,street=?,building_type=?,surname=?,name=?,patronymic=?,soslovie=?,family_status=?,sex=?,service_type=?,rank=?,position=?,service_place=?,registration_place=?,area_sazh=?,source=?,scan_url=?,lat=?,lng=?,plot_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(r.num,r.settlementId,r.street,r.buildingType,r.surname,r.name,r.patronymic,r.soslovie,r.familyStatus,r.sex,r.serviceType,r.rank,r.position,r.servicePlace,r.registrationPlace,r.area_sazh,r.source,r.scanUrl,r.lat,r.lng,r.plotId,ex.id);}else{const id=r.id||db.prepare('SELECT COALESCE(MAX(id),0)+1 id FROM records').get().id;db.prepare('INSERT INTO records(id,num,settlement_id,street,building_type,surname,name,patronymic,soslovie,family_status,sex,service_type,rank,position,service_place,registration_place,area_sazh,source,scan_url,lat,lng,plot_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,r.num,r.settlementId,r.street,r.buildingType,r.surname,r.name,r.patronymic,r.soslovie,r.familyStatus,r.sex,r.serviceType,r.rank,r.position,r.servicePlace,r.registrationPlace,r.area_sazh,r.source,r.scanUrl,r.lat,r.lng,r.plotId);}}if(rec.mode==='replace'&&payload.settlementId){const ids=new Set(rows.map(r=>r.id).filter(Boolean));for(const x of db.prepare("SELECT id FROM records WHERE settlement_id=? AND status='active'").all(payload.settlementId))if(!ids.has(x.id))db.prepare("UPDATE records SET status='archived',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(x.id);}db.prepare("UPDATE imports SET status='applied' WHERE id=?").run(rec.id);db.exec('COMMIT');json(res,200,{ok:true});}catch(e){db.exec('ROLLBACK');json(res,500,{error:e.message});}return;}
      if(url.pathname==='/api/admin/releases' && req.method==='GET'){json(res,200,db.prepare('SELECT id,created_at as createdAt,note FROM releases ORDER BY id DESC').all());return;}
      if(url.pathname==='/api/admin/releases' && req.method==='POST'){const b=await body(req);const snap=snapshot();const r=db.prepare('INSERT INTO releases(snapshot_json,note) VALUES(?,?)').run(JSON.stringify(snap),b.note||'');json(res,201,{id:Number(r.lastInsertRowid)});return;}
      if(url.pathname==='/api/admin/preview' && req.method==='GET'){json(res,200,snapshot());return;}
      json(res,404,{error:'ADMIN_ROUTE_NOT_FOUND'}); return;
    }
    if(url.pathname==='/api/public/bootstrap' && req.method==='GET'){ const snap=publicSnapshot(); json(res,200,snap,{'ETag':`"release-${snap.releaseId||0}"`}); return; }
    if(url.pathname==='/admin' || url.pathname==='/admin/') { serveFile(res,'server/admin/index.html','text/html; charset=utf-8'); return; }
    if(url.pathname.startsWith('/admin/')) { const rel=url.pathname.replace(/^\/admin\//,'server/admin/'); if(serveFile(res,rel,mime[path.extname(rel)])) return; }
    const rel=url.pathname==='/'?'index.html':url.pathname.replace(/^\//,''); if(serveFile(res,rel,mime[path.extname(rel)])) return;
    json(res,404,{error:'NOT_FOUND'});
  } catch(e){ console.error(e); json(res,500,{error:'INTERNAL_ERROR',message:process.env.NODE_ENV==='development'?e.message:undefined}); }
});

server.listen(port,()=>console.log(`GIS-EKB server: http://localhost:${port}`));
