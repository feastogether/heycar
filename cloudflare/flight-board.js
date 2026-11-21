import {sealBoardToken,openBoardToken} from './board-links.js';
import {boardBriefing} from './board-briefing.js';
import {readBoardSettings,saveBoardSettings} from './board-settings.js';
import {expandBoardFeed} from '../supabase/functions/flights/board-feed.mjs';
const SOURCE = 'https://odp.taoyuan-airport.com/dataset/2025102001?format=csv';
const PREFIX = '_flight-board/';
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const clean = value => String(value || '').trim().replace(/^null$/i, '');
export const flightKey = value => clean(value).toUpperCase().replace(/\s/g, '').replace(/^([A-Z0-9]{2})0+(?=\d)/, '$1');
const day = (now = Date.now()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date(now));
const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), n => n.toString(16).padStart(2, '0')).join('');
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (c === ',' || c === '\n')) { row.push(cell.replace(/\r$/, '')); cell = ''; if (c === '\n') { rows.push(row); row = []; } }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  const headers = (rows.shift() || []).map(h => h.replace(/^\uFEFF/, ''));
  return rows.filter(r => r.length === headers.length).map(r => Object.fromEntries(headers.map((h, i) => [h, clean(r[i])])));
}
export function mapArrival(row) {
  const stamp = (date, time) => date?.slice(0, 10) && time ? `${date.slice(0, 10)}T${time.slice(0, 8)}+08:00` : '';
  const remark = clean(row['備註']), detail = clean(row['航班動態中文']);
  // An estimated arrival in the past is NOT evidence of landing.
  const landed = !/預計|預估/.test(remark) && (/^(已到|已抵達|抵達|降落|已降落)$/.test(remark) || /^(抵達機坪|已落地|已降落)$/.test(detail));
  return { airlineCode:clean(row['航空公司代碼']),flightNo: flightKey(`${row['航空公司代碼']}${row['班次']}`), airline: row['航空公司中文'], city: row['往來地點中文'] || row['往來地點英文'], date: row['表訂日期']?.slice(0, 10), scheduledTime: stamp(row['表訂日期'], row['表訂時間']), estimatedTime: stamp(row['預計日期'], row['預計時間']), terminal: row['航廈'], baggage: row['行李轉盤'], status: landed ? '已抵達' : remark || detail || '預計抵達', landed, cancelled: /取消|CANCEL/i.test(`${remark} ${detail}`) };
}
async function boundedText(response, limit) {
  if (!response.body) return '';
  const reader = response.body.getReader(); const chunks = []; let bytes = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > limit) { await reader.cancel(); throw new Error('RESPONSE_TOO_LARGE'); } chunks.push(value); }
  const joined = new Uint8Array(bytes); let offset = 0; for (const part of chunks) { joined.set(part, offset); offset += part.length; }
  return new TextDecoder().decode(joined);
}
async function arrivals(env) {
  const bucket = env.ATTACHMENTS, key = `${PREFIX}cache/arrivals.json`, cached = await bucket.get(key);
  const old = cached ? await cached.json() : null;
  if(old?.retry_at>Date.now())return {...old,stale:true};
  if (old && Date.now() - (old.fetched_at||old.updated) < 300000) return old;
  try {
    let rows,updated=Date.now(),source='桃園機場';
    const stateKey=PREFIX+'cache/source-state.json',sourceState=await bucket.get(stateKey),state=sourceState?await sourceState.json():null;
    if(!state?.relayUntil||state.relayUntil<Date.now()){
      try{const response=await fetch(SOURCE,{signal:AbortSignal.timeout(5000),cf:{cacheTtl:300,cacheEverything:true}});if(!response.ok)throw Error('SOURCE_HTTP_'+response.status);rows=parseCsv(await boundedText(response,4*1024*1024));}
      catch{await bucket.put(stateKey,JSON.stringify({relayUntil:Date.now()+3600000}));}
    }
    if(!rows){
      const relay=new URL('/functions/v1/flights?source=taoyuan&board=1&window='+Math.floor(Date.now()/300000),env.SUPABASE_URL);
      const response=await fetch(relay,{signal:AbortSignal.timeout(15000),cf:{cacheTtl:0,cacheEverything:false}});
      if(!response.ok)throw Error('SOURCE_RELAY_HTTP_'+response.status);
      const payload=JSON.parse(await boundedText(response,1024*1024));rows=expandBoardFeed(payload);updated=payload.updated;if(payload.source==='桃園機場（TDX備援）')source=payload.source;
    }
    if (!rows.length || !Object.hasOwn(rows[0], '方向')) throw new Error('SOURCE_FORMAT_CHANGED');
    const data = { updated,source,fetched_at:Date.now(),stale:Date.now()-updated>600000,flights: rows.filter(r => !r['方向']||r['方向'] === 'A').map(mapArrival) };
    try{await bucket.put(key, JSON.stringify(data), { onlyIf: cached ? { etagMatches: cached.etag } : { etagDoesNotMatch: '*' } });}catch{throw new Error('SOURCE_CACHE_WRITE');}
    return data;
  } catch(error){if(old){const fallback={...old,stale:true,retry_at:Date.now()+60000};await bucket.put(key,JSON.stringify(fallback),{onlyIf:{etagMatches:cached.etag}});return fallback;}throw error;}
}
async function rest(env, table, params) {
  const url = new URL(`/rest/v1/${table}`, env.SUPABASE_URL); url.search = new URLSearchParams(params).toString();
  const response = await fetch(url, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('DATA_UNAVAILABLE');
  return JSON.parse(await boundedText(response, 128000));
}
async function session(request, env) {
  const token = request.headers.get('x-afide-session');
  if (!token || token.length > 200) return null;
  return (await rest(env, 'app_sessions', { token: `eq.${token}`, expires_at: `gt.${new Date().toISOString()}`, select: 'session_type,driver_id,admin_user_id,is_super_admin', limit: '1' }))[0];
}
async function canPair(actor, env) {
  if (actor?.session_type !== 'admin') return false;
  if (actor.is_super_admin) return true;
  if (!actor.admin_user_id) return false;
  const profile = (await rest(env, 'admin_users', { id: `eq.${actor.admin_user_id}`, select: 'active,permissions', limit: '1' }))[0];
  return profile?.active && profile.permissions?.boardManagement===true;
}
async function listedWatches(bucket, date) {
  const objects = []; let cursor;
  do { const page = await bucket.list({ prefix: `${PREFIX}watches/${date}/`, limit: 1000, cursor, include: ['customMetadata'] }); objects.push(...page.objects); cursor = page.truncated ? page.cursor : null; } while (cursor && objects.length < 10000);
  return objects;
}
export async function flightBoard(request, env) {
  let stage='request';
  try {
    if (request.method !== 'POST') return reply({ error: 'METHOD_NOT_ALLOWED' }, 405);
    const body = JSON.parse(await boundedText(request, 32768));
    if (['snapshot','pulse','briefing'].includes(body.action)) {
      const token = request.headers.get('x-board-token') || '';
      if (!/^[a-f0-9]{64}$/.test(token)) return reply({ error: '請使用後台產生的電視配對連結' }, 401);
      const access = await env.ATTACHMENTS.get(`${PREFIX}access/${await hash(token)}.json`);
      if (!access) return reply({ error: '電視連結已撤銷或無效，請重新取得連結' }, 401);
      const accessData=await access.json(),accessId=await hash(token);if(!accessData.token_cipher){const token_cipher=await sealBoardToken(token,accessId,env);await env.ATTACHMENTS.put(`${PREFIX}access/${accessId}.json`,JSON.stringify({...accessData,token_cipher}),{onlyIf:{etagMatches:access.etag},customMetadata:{...access.customMetadata,tokenStored:'1'}});}
      if(body.action==='briefing'){stage='briefing';const settings=(await readBoardSettings(env.ATTACHMENTS)).data;return reply(await boardBriefing(env.ATTACHMENTS,{includeWeather:settings.ticker_weather!==false,includeStock:settings.ticker_stock!==false}));}
      stage='feed';const cached=body.action==='pulse'?await env.ATTACHMENTS.get(PREFIX+'cache/arrivals.json'):null;const feed=body.action==='pulse'?(cached?await cached.json():{updated:0,fetched_at:0,flights:[]}):await arrivals(env), date = day(), tomorrow = day(Date.now() + 86400000);const settings=(await readBoardSettings(env.ATTACHMENTS)).data;
      stage='watch_list';
      const objects = [...await listedWatches(env.ATTACHMENTS,day(Date.now()-86400000)),...await listedWatches(env.ATTACHMENTS, date), ...await listedWatches(env.ATTACHMENTS, tomorrow)];
      const watches = [];
      for (const obj of objects) {
        let watch; try { watch = JSON.parse(obj.customMetadata?.watch || '{}'); } catch { continue; }
        if (!watch.id||Date.now()-watch.createdAt>48*3600000) continue;
        let flight = feed.flights.find(f => f.date === watch.date && f.flightNo === watch.flightNo);
        const flightTime=Date.parse(flight?.estimatedTime||flight?.scheduledTime);
        if(Number.isFinite(flightTime)&&flightTime>Date.now()+8*3600000)continue;
        if(flight?.cancelled&&!watch.cancelledAt&&!feed.stale&&Date.now()-feed.updated<600000){
          watch.cancelledAt=Date.now();watch.cancelledFlight=flight;
          const saved=await env.ATTACHMENTS.put(obj.key,JSON.stringify(watch),{onlyIf:{etagMatches:obj.etag},customMetadata:{watch:JSON.stringify(watch)}});
          if(!saved){const fresh=await env.ATTACHMENTS.head(obj.key);try{watch=JSON.parse(fresh?.customMetadata?.watch||'{}');}catch{continue;}}
        }
        if(watch.cancelledAt&&flight&&!flight.cancelled&&!feed.stale&&Date.now()-feed.updated<600000){
          delete watch.cancelledAt;delete watch.cancelledFlight;
          const saved=await env.ATTACHMENTS.put(obj.key,JSON.stringify(watch),{onlyIf:{etagMatches:obj.etag},customMetadata:{watch:JSON.stringify(watch)}});
          if(!saved)continue;
        }
        flight ||= watch.cancelledFlight;
        // A stale source must not trigger a new cancellation or landing announcement.
        if(flight?.cancelled&&!watch.cancelledAt)continue;
        if (!watch.cancelledAt&&flight?.landed && !watch.landedAt&&!feed.stale&&Date.now()-feed.updated<600000) {
          watch.landedAt = Date.now(); watch.tooOld=false;
          const saved = await env.ATTACHMENTS.put(obj.key, JSON.stringify(watch), { onlyIf: { etagMatches: obj.etag }, customMetadata: { watch: JSON.stringify(watch) } });
          if (!saved) { const fresh = await env.ATTACHMENTS.head(obj.key); try { watch = JSON.parse(fresh?.customMetadata?.watch || '{}'); } catch { continue; } }
        }
        if (!watch.cancelledAt&&watch.landedAt && Date.now() - watch.landedAt > 5 * 60000) continue;
        watches.push({ ...watch, flight: flight || null });
      }
      return reply({ updated_at: new Date(feed.updated).toISOString(), source:feed.source||'桃園機場',stale: !!feed.stale||Date.now()-feed.updated>600000,next_refresh_at:Math.max((feed.fetched_at||feed.updated)+300000,feed.retry_at||0),checked_at:new Date().toISOString(), watches, ...(body.action==='snapshot'?{flights: feed.flights.filter(f => [date, tomorrow].includes(f.date) && !f.landed && !f.cancelled && Date.parse(f.estimatedTime || f.scheduledTime) >= Date.now()).sort((a,b) => Date.parse(a.estimatedTime || a.scheduledTime) - Date.parse(b.estimatedTime || b.scheduledTime)).slice(0, 40)}:{}), marquee:settings.marquee,ticker_weather:settings.ticker_weather!==false,ticker_stock:settings.ticker_stock!==false,announcements:settings.announcements.filter(x=>x.active!==false), news_video_id: /^[\w-]{11}$/.test(env.CTS_LIVE_VIDEO_ID || '') ? env.CTS_LIVE_VIDEO_ID : 'wM0g8EoUZ_E' });
    }
    const actor = await session(request, env);
    if (!actor) return reply({ error: '請重新登入' }, 401);
    if(['settings_get','settings_save','pair_list','pair_link'].includes(body.action)){
      if(!await canPair(actor,env))return reply({error:'沒有看板管理權限'},403);
      if(body.action==='settings_get')return reply({settings:(await readBoardSettings(env.ATTACHMENTS)).data});
      if(body.action==='settings_save'){const settings=await saveBoardSettings(env.ATTACHMENTS,body.settings,{id:actor.admin_user_id||'super-admin'});return settings?reply({settings}):reply({error:'設定已由其他人修改，請重新整理後再儲存'},409);}
      if(body.action==='pair_link'){if(!/^[a-f0-9]{64}$/.test(body.id||''))return reply({error:'連結編號錯誤'},400);const file=await env.ATTACHMENTS.get(`${PREFIX}access/${body.id}.json`);if(!file)return reply({error:'此連結已停用'},404);const data=await file.json();if(!data.token_cipher)return reply({error:'此舊連結尚未保存網址，請在原電視重新整理後再取得；若原電視尚未使用，請產生新連結。'},409);return reply({token:await openBoardToken(data.token_cipher,body.id,env)});}
      const page=await env.ATTACHMENTS.list({prefix:PREFIX+'access/',limit:1000,include:['customMetadata']});return reply({pairs:page.objects.map(row=>({id:row.key.split('/').pop().replace('.json',''),name:row.customMetadata?.name||'電視看板',created_at:row.uploaded}))});
    }
    if (body.action === 'pair') {
      if (!await canPair(actor, env)) return reply({ error: '沒有電視配對權限' }, 403);
      const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
      const id = await hash(token); await env.ATTACHMENTS.put(`${PREFIX}access/${id}.json`, JSON.stringify({ expires:null,actor_id:actor.admin_user_id||'super-admin',token_cipher:await sealBoardToken(token,id,env)}),{customMetadata:{name:clean(body.name||'電視看板').slice(0,80),tokenStored:'1'}});
      return reply({ token, id, expires_days: null });
    }
    if (body.action === 'revoke') {
      if (!await canPair(actor, env) || !/^[a-f0-9]{64}$/.test(body.id || '')) return reply({ error: 'ACTION_NOT_ALLOWED' }, 403);
      await env.ATTACHMENTS.delete(`${PREFIX}access/${body.id}.json`); return reply({ ok: true });
    }
    if (actor.session_type !== 'driver' || !actor.driver_id) return reply({ error: '僅供司機追蹤航班' }, 403);
    const flightNo = flightKey(body.flight_no), date = clean(body.date);
    if (!/^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(flightNo) || ![day(), day(Date.now() + 86400000)].includes(date)) return reply({ error: '僅能追蹤今天或明天的桃園抵達航班' }, 400);
    const id = await hash(`${actor.driver_id}|${date}|${flightNo}`), key = `${PREFIX}watches/${date}/${id}`;
    if (body.action === 'unfollow') { await env.ATTACHMENTS.delete(key); return reply({ ok: true }); }
    if (body.action !== 'follow') return reply({ error: 'UNKNOWN_ACTION' }, 400);
    const feed = await arrivals(env), flight = feed.flights.find(f => f.date === date && f.flightNo === flightNo);
    if (!flight || flight.landed || flight.cancelled) return reply({ error: '航班已抵達、取消或尚未公布，無法新增追蹤' }, 409);
    const driver = (await rest(env, 'drivers', { id: `eq.${actor.driver_id}`, select: 'name', limit: '1' }))[0];
    if (!driver) return reply({ error: '找不到司機資料' }, 403);
    const watch = { id, flightNo, date, driverName: clean(driver.name).slice(0, 60), createdAt: Date.now() };
    await env.ATTACHMENTS.put(key, JSON.stringify(watch), { onlyIf: { etagDoesNotMatch: '*' }, customMetadata: { watch: JSON.stringify(watch) } });
    return reply({ ok: true, id });
  } catch(error) {if(error?.message==='INVALID_SETTINGS')return reply({error:'請確認跑馬燈最多20則、每則500字；公告最多12則，標題100字、內容2000字。'},400); const code=/^(SOURCE_[A-Z0-9_]+|RESPONSE_TOO_LARGE)$/.test(error?.message||'')?error.message:'BOARD_'+stage.toUpperCase();console.warn(JSON.stringify({event:'flight_board_error',code}));return reply({ error: '航班看板暫時無法連線，請稍後重試',code }, 503); }
}
