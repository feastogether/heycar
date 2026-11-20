import { mountLiveNews } from './flight-board-news.js?v=20261120-3';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const $ = id => document.getElementById(id);
const time = value => value ? new Date(value).toLocaleTimeString('zh-TW', { timeZone:'Asia/Taipei', hour:'2-digit', minute:'2-digit', hour12:false }) : '—';
const storage = { get(key, fallback='') { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } }, set(key,value) { try { localStorage.setItem(key,value); } catch {} } };
const fragment = new URLSearchParams(location.hash.slice(1));
if (/^[a-f0-9]{64}$/.test(fragment.get('pair') || '')) storage.set('heycar-board-token', fragment.get('pair'));
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
let token = storage.get('heycar-board-token'), news = null, audio = null, enabled = false, processing = false, busy = false, timer = null, pairId = '';
let lastFeed = null; const watches = new Map(), queue = [];
let done; try { done = new Map(JSON.parse(storage.get('heycar-board-announced','[]'))); } catch { done = new Map(); }
const markDone = id => { done.set(id,Date.now()); done = new Map([...done].slice(-300)); storage.set('heycar-board-announced',JSON.stringify([...done])); };
async function api(body, admin=false) {
  let session = {}; if (admin) { try { session = JSON.parse(storage.get('afide-session','{}')); } catch {} }
  const response = await fetch('/api/flight-board', { method:'POST', headers:{ 'Content-Type':'application/json', ...(admin ? {'x-afide-session':session.token || ''} : {'x-board-token':token}) }, body:JSON.stringify(body), signal:AbortSignal.timeout(25000) });
  const result = await response.json(); if (!response.ok) { const error = new Error(result.error || '看板無法連線'); error.status=response.status; throw error; } return result;
}
function renderTracked() {
  const rows = [...watches.values()].filter(w => !w.hideAt || Date.now()<w.hideAt).sort((a,b) => Number(!!b.landedAt)-Number(!!a.landedAt) || a.createdAt-b.createdAt);
  $('trackingCount').textContent = `${rows.length} 班`;
  $('trackedFlights').innerHTML = rows.length ? rows.map(w => `<article class="tracked-flight ${w.landedAt?'landed':''}"><div class="track-top"><strong>${escape(w.flightNo)}</strong><span>${escape(w.landedAt?'已抵達':w.flight?.status || '等待更新')}</span></div><p>${escape(w.flight?.airline || '')} · ${escape(w.flight?.city || '桃園')}</p><footer><b>司機 ${escape(w.driverName)}</b><span>${w.landedAt?'請聯繫客戶':'預計 '+time(w.flight?.estimatedTime || w.flight?.scheduledTime)}</span></footer></article>`).join('') : '<p class="empty">目前沒有追蹤中的航班。司機可在航班查詢後點選追蹤。</p>';
}
function renderFeed(data) {
  $('updatedAt').textContent = `更新 ${time(data.updated_at)}`;
  $('upcomingFlights').innerHTML = data.flights.slice(0,10).map(f => `<div class="arrival-row"><time>${time(f.estimatedTime || f.scheduledTime)}</time><span><strong>${escape(f.flightNo)}</strong><small>${escape(f.city)}</small></span><span>${escape(f.terminal || '—')}</span><span class="status">${escape(f.status)}</span></div>`).join('') || '<p class="empty">目前沒有即將抵達的航班</p>';
  $('marqueeText').textContent = data.marquee?.join('　｜　') || 'HEYCAR · 行車平安，服務用心。';
  if (!news) news = mountLiveNews($('liveNews'), {videoId:data.news_video_id});
  for (const row of data.watches) {
    if (row.tooOld) { markDone(row.id); continue; }
    const prior=watches.get(row.id); watches.set(row.id,{...row,hideAt:prior?.hideAt});
    if (row.landedAt && !done.has(row.id) && !queue.some(w=>w.id===row.id)) queue.push(row);
    if (row.landedAt && done.has(row.id) && !prior?.hideAt) watches.get(row.id).hideAt = done.get(row.id)+180000;
  }
  const currentIds=new Set(data.watches.map(w=>w.id));
  for (const [id,row] of watches) if ((!currentIds.has(id) && !row.hideAt) || (row.hideAt && Date.now()>=row.hideAt)) watches.delete(id);
  renderTracked(); void announceNext();
}
function chime() {
  const start=audio.currentTime;
  [659.25,830.61,987.77].forEach((frequency,index)=>{ const o=audio.createOscillator(),g=audio.createGain(); o.type='sine';o.frequency.value=frequency;g.gain.setValueAtTime(0,start+index*.35);g.gain.linearRampToValueAtTime(.14,start+index*.35+.02);g.gain.exponentialRampToValueAtTime(.001,start+index*.35+.65);o.connect(g).connect(audio.destination);o.start(start+index*.35);o.stop(start+index*.35+.7); });
}
async function announceNext() {
  if (!enabled || processing || !queue.length) return;
  const watch=queue.shift(); if (done.has(watch.id)) return announceNext();
  if (Date.now()-watch.landedAt>5*60000) { markDone(watch.id);return announceNext(); }
  processing=true; news?.beginAnnouncement();
  try {
    await audio.resume(); chime(); await new Promise(resolve=>setTimeout(resolve,1300));
    const text=`${watch.flight?.airline || '航班'} ${watch.flightNo.replace(/([A-Z])/g,'$1 ')} 已抵達，請司機 ${watch.driverName} 準備聯繫客戶與出發。`;
    await new Promise((resolve,reject)=>{
      const utterance=new SpeechSynthesisUtterance(text); utterance.lang='zh-TW';utterance.rate=.9;
      const voice=speechSynthesis.getVoices().find(v=>v.lang==='zh-TW'); if(voice)utterance.voice=voice;
      const timeout=setTimeout(()=>{speechSynthesis.cancel();reject(new Error('廣播逾時，請確認電視的語音服務'));},45000);
      utterance.onend=()=>{clearTimeout(timeout);resolve();};utterance.onerror=()=>{clearTimeout(timeout);reject(new Error('語音播放失敗，請確認電視的語音服務'));};speechSynthesis.speak(utterance);
    });
    markDone(watch.id); const local=watches.get(watch.id);if(local)local.hideAt=Date.now()+180000;
  } catch(error) { enabled=false;queue.unshift(watch);$('enableAudio').textContent='重新啟用降落廣播';$('boardStatus').textContent=error.message; }
  finally {news?.endAnnouncement();processing=false;renderTracked();if(enabled)void announceNext();}
}
async function refresh() {
  if (busy || document.hidden || !navigator.onLine || !token) return;
  busy=true;
  try { lastFeed=await api({action:'snapshot'});renderFeed(lastFeed);$('boardStatus').textContent=lastFeed.stale?'機場連線延遲，顯示上次資料':'已連線 · '+(lastFeed.source||'桃園機場'); }
  catch(error){$('boardStatus').textContent=error.message;if(!news)news=mountLiveNews($('liveNews'));if(error.status===401&&!$('pairDialog').open)$('pairDialog').showModal();}
  finally{busy=false;}
}
$('enableAudio').onclick=async()=>{try{if(!window.speechSynthesis || !window.AudioContext)throw new Error('此瀏覽器不支援語音廣播');audio ||= new AudioContext();await audio.resume();enabled=true;$('enableAudio').textContent='降落廣播已啟用';$('enableAudio').setAttribute('aria-pressed','true');void announceNext();}catch(error){$('boardStatus').textContent=error.message;}};
$('fullScreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{$('boardStatus').textContent='請使用瀏覽器的全螢幕功能';}};
$('pairSettings').onclick=()=>$('pairDialog').showModal();
$('createPair').onclick=async()=>{const button=$('createPair');button.disabled=true;try{const data=await api({action:'pair'},true);pairId=data.id;$('pairUrl').value=`${location.origin}/flight-board#pair=${data.token}`;$('pairError').textContent='連結已產生，有效 30 天。電視僅能讀取看板。';}catch(error){$('pairError').textContent=error.message;}finally{button.disabled=false;}};
$('copyPair').onclick=async()=>{try{if(!$('pairUrl').value)throw new Error('請先產生配對連結');await navigator.clipboard.writeText($('pairUrl').value);$('pairError').textContent='已複製';}catch{$('pairUrl').select();$('pairError').textContent='請複製上方連結';}};
$('revokePair').onclick=async()=>{if(!pairId){$('pairError').textContent='請先產生本次連結';return;}try{await api({action:'revoke',id:pairId},true);$('pairUrl').value='';pairId='';$('pairError').textContent='連結已停用';}catch(error){$('pairError').textContent=error.message;}};
function tick(){ $('clock').textContent=new Date().toLocaleTimeString('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});renderTracked(); }
tick();timer=setInterval(tick,1000);setInterval(()=>void refresh(),60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});window.addEventListener('online',()=>void refresh());
window.addEventListener('pagehide',()=>{clearInterval(timer);news?.destroy();window.speechSynthesis?.cancel();});
if(token)void refresh();else{$('boardStatus').textContent='請先配對電視看板';$('pairDialog').showModal();news=mountLiveNews($('liveNews'));}
