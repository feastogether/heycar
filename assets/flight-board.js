import { mountLiveNews } from './flight-board-news.js?v=20261120-3';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const $ = id => document.getElementById(id);
const time = value => value ? new Date(value).toLocaleTimeString('zh-TW', { timeZone:'Asia/Taipei', hour:'2-digit', minute:'2-digit', hour12:false }) : '—';
const storage = { get(key, fallback='') { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } }, set(key,value) { try { localStorage.setItem(key,value); } catch {} } };
const fragment = new URLSearchParams(location.hash.slice(1));
if (/^[a-f0-9]{64}$/.test(fragment.get('pair') || '')) storage.set('heycar-board-token', fragment.get('pair'));
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
let token = storage.get('heycar-board-token'), news = null, audio = null, enabled = false, processing = false, busy = false, feedBusy = false, timer = null, pulseTimer = null;
let lastFeed = null,briefing=null,briefingBusy=false,briefingTimer=null,tickerItems=[],tickerKey='',tickerIndex=0;const inFlight=new Set(); const watches = new Map(), queue = [];
let done; try { done = new Map(JSON.parse(storage.get('heycar-board-announced','[]'))); } catch { done = new Map(); }
const markDone = id => { done.set(id,Date.now()); done = new Map([...done].slice(-300)); storage.set('heycar-board-announced',JSON.stringify([...done])); };
async function api(body, admin=false) {
  let session = {}; if (admin) { try { session = JSON.parse(storage.get('afide-session','{}')); } catch {} }
  const response = await fetch('/api/flight-board', { method:'POST', headers:{ 'Content-Type':'application/json', ...(admin ? {'x-afide-session':session.token || ''} : {'x-board-token':token}) }, body:JSON.stringify(body), signal:AbortSignal.timeout(25000) });
  const result = await response.json(); if (!response.ok) { const error = new Error(result.error || '看板無法連線'); error.status=response.status; throw error; } return result;
}
const logo=flight=>{const code=flight.airlineCode||String(flight.flightNo||'').slice(0,2);return /^[A-Z0-9]{2}$/.test(code)?`<img src="https://images.kiwi.com/airlines/64/${code}.png" alt="" onerror="this.hidden=true">`:'';};
const phase=()=>Math.floor(Date.now()/8000);
function renderTracked(){
 const rows=[...watches.values()].filter(row=>!row.hideAt||Date.now()<row.hideAt),groups=new Map();for(const row of rows){const key=row.date+row.flightNo;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
 for(const group of groups.values())group.sort((a,b)=>b.createdAt-a.createdAt);
 const cards=[...groups.values()].sort((a,b)=>Number(!!b[0].landedAt)-Number(!!a[0].landedAt)||a[0].createdAt-b[0].createdAt),pages=Math.max(1,Math.ceil(cards.length/4)),recent=cards.findIndex(group=>Date.now()-group[0].createdAt<15000),page=recent>=0?Math.floor(recent/4):phase()%pages;
 $('trackingCount').textContent=`${cards.length} 班 · ${rows.length} 位司機${pages>1?' · '+(page+1)+'/'+pages:''}`;
 $('trackedFlights').innerHTML=cards.slice(page*4,page*4+4).map(group=>{const row=group[0],flight=row.flight||{flightNo:row.flightNo},eta=flight.estimatedTime||flight.scheduledTime,late=!row.landedAt&&Date.parse(eta)<Date.now(),namePage=Date.now()-group[0].createdAt<15000?0:phase()%Math.max(1,Math.ceil(group.length/4)),names=group.slice(namePage*4,namePage*4+4);return `<article class="tracked-flight ${row.landedAt?'landed':''}"><header>${logo(flight)}<strong>${escape(flight.flightNo||row.flightNo)}</strong><span>${row.landedAt?'已抵達':late?'等候機場更新':escape(flight.status||'追蹤中')}</span></header><p>${escape(flight.airline||'')} · ${escape(flight.city||'桃園')}</p><footer><time>${row.landedAt?'請聯繫客戶':late?'原預計 '+time(eta):'預計 '+time(eta)}</time><div class="tracked-drivers">${names.map(x=>'<b>'+escape(x.driverName)+'</b>').join('')}${group.length>4?'<small>共 '+group.length+' 位・輪播顯示</small>':''}</div></footer></article>`;}).join('')||'<div class="empty">目前沒有追蹤航班</div>';
}
function renderUpcoming(){
 if(!lastFeed)return;const rows=(lastFeed.flights||[]).filter(f=>!f.landed&&!f.cancelled&&Date.parse(f.estimatedTime||f.scheduledTime)>=Date.now()),rowCount=Math.max(2,Math.min(8,Math.floor((innerHeight-$('upcomingFlights').getBoundingClientRect().top-80)/(innerWidth>=1800?74:66)))),pages=Math.max(1,Math.ceil(rows.length/rowCount)),page=phase()%pages;
 $('upcomingFlights').innerHTML=rows.slice(page*rowCount,page*rowCount+rowCount).map(f=>`<div class="arrival-row"><time>${time(f.estimatedTime||f.scheduledTime)}</time><span class="arrival-airline">${logo(f)}<span><strong>${escape(f.airline||f.airlineCode||'航空公司')} <b>${escape(f.flightNo)}</b></strong></span></span><span>${escape(f.city)}</span><span>${escape(f.terminal||'—')}</span></div>`).join('')||'<p class="empty">等待下一批即將抵達航班資料</p>';
 const notices=lastFeed.announcements||[],notice=notices[phase()%Math.max(1,notices.length)];$('announcementCount').textContent=notices.length>1?`${phase()%notices.length+1} / ${notices.length}`:'';$('companyAnnouncement').innerHTML=notice?'<h3>'+escape(notice.title)+'</h3><p>'+escape(notice.content)+'</p>':'<p class="empty">目前沒有公告</p>';
}

function paintTicker(){
 const span=$('marqueeText'),entry=tickerItems[tickerIndex%Math.max(1,tickerItems.length)];
 $('tickerLabel').textContent=entry?({announcement:'公告',weather:'天氣',stock:'台股',info:'資訊'})[entry.kind]||'資訊':'公告';
 span.style.animationName='none';span.textContent=entry?.text||'';
 const distance=span.parentElement.clientWidth;span.style.setProperty('--ticker-start',distance+'px');span.style.animationDuration=Math.max(8,(distance+span.scrollWidth)/80)+'s';void span.offsetWidth;span.style.animationName=entry?'ticker-slide':'none';
}
function renderTicker(){
 if(!lastFeed)return;const manual=(lastFeed.marquee||[]).flatMap(text=>{const chars=Array.from(text),chunks=[];for(let i=0;i<chars.length;i+=160)chunks.push({kind:'announcement',text:chars.slice(i,i+160).join('')});return chunks;}),weather=lastFeed.ticker_weather!==false?(briefing?.items||[]).filter(x=>x.kind==='weather'):[],stock=lastFeed.ticker_stock!==false?(briefing?.items||[]).filter(x=>x.kind==='stock'):[];
 const items=[];for(let i=0;i<Math.max(manual.length,weather.length,stock.length);i++){if(manual[i])items.push(manual[i]);if(weather[i])items.push(weather[i]);if(stock[i])items.push(stock[i]);}
 if(briefing?.weather_delayed&&!weather.length&&lastFeed.ticker_weather!==false)items.push({kind:'info',text:'天氣資訊暫時無法取得，稍後自動重試'});
 if(briefing?.stock_delayed&&!stock.length&&lastFeed.ticker_stock!==false)items.push({kind:'info',text:'台股資訊暫時無法取得，稍後自動重試'});
 const nextKey=JSON.stringify(items);if(nextKey===tickerKey)return;tickerKey=nextKey;tickerItems=items;tickerIndex=0;paintTicker();
}
async function refreshBriefing(){
 if(briefingBusy||!token||navigator.onLine===false)return;briefingBusy=true;
 try{briefing=await api({action:'briefing'});renderTicker();}catch{if(!briefing)briefing={items:[],weather_delayed:true,stock_delayed:true};renderTicker();}finally{briefingBusy=false;}
}
$('marqueeText').addEventListener('animationend',()=>{if(!tickerItems.length)return;tickerIndex=(tickerIndex+1)%tickerItems.length;paintTicker();});

function renderFeed(patch) {
  const optionsChanged=lastFeed&&((patch.ticker_weather!==undefined&&lastFeed.ticker_weather!==patch.ticker_weather)||(patch.ticker_stock!==undefined&&lastFeed.ticker_stock!==patch.ticker_stock));lastFeed={...lastFeed,...patch};const data=lastFeed;if(optionsChanged)void refreshBriefing();
  $('updatedAt').textContent = `更新 ${time(data.updated_at)}`;
  renderTicker();
  if (!news) news = mountLiveNews($('liveNews'), {videoId:data.news_video_id});
  for (const row of data.watches) {
    if (row.tooOld) { markDone(row.id); continue; }
    const prior=watches.get(row.id); watches.set(row.id,{...row,hideAt:prior?.hideAt});
    if (row.landedAt && !done.has(row.id) && !inFlight.has(row.id)&&!queue.some(w=>w.id===row.id)) queue.push(row);
    if (row.landedAt && done.has(row.id) && !prior?.hideAt) watches.get(row.id).hideAt = done.get(row.id)+180000;
  }
  const currentIds=new Set(data.watches.map(w=>w.id));
  for (const [id,row] of watches) if ((!currentIds.has(id) && !row.hideAt) || (row.hideAt && Date.now()>=row.hideAt)) watches.delete(id);
  renderTracked(); renderUpcoming(); void announceNext();
}
function chime() {
  const start=audio.currentTime;
  [659.25,830.61,987.77].forEach((frequency,index)=>{ const o=audio.createOscillator(),g=audio.createGain(); o.type='sine';o.frequency.value=frequency;g.gain.setValueAtTime(0,start+index*.35);g.gain.linearRampToValueAtTime(.14,start+index*.35+.02);g.gain.exponentialRampToValueAtTime(.001,start+index*.35+.65);o.connect(g).connect(audio.destination);o.start(start+index*.35);o.stop(start+index*.35+.7); });
}
async function announceNext() {
  if (!enabled || processing || !queue.length) return;
  const watch=queue.shift(); if (done.has(watch.id)) return announceNext();
  if (Date.now()-watch.landedAt>15*60000) { markDone(watch.id);return announceNext(); }
  processing=true;inFlight.add(watch.id); news?.beginAnnouncement();
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
  } catch(error) { enabled=false;$('startOverlay').hidden=false;$('startMessage').textContent=error.message;queue.unshift(watch);$('enableAudio').textContent='重新啟用降落廣播';$('boardStatus').textContent=error.message; }
  finally {inFlight.delete(watch.id);news?.endAnnouncement();processing=false;renderTracked();if(enabled)void announceNext();}
}
function connectionError(error){$('boardStatus').textContent=error.message;if(!news)news=mountLiveNews($('liveNews'));if(error.status===401){$('startMessage').textContent='請在後台「看板管理」取得有效連結';$('enableAudio').hidden=true;$('startOverlay').hidden=false;}}
function connected(){ $('boardStatus').textContent=lastFeed.stale?'機場連線延遲，顯示上次資料':'已連線 · '+(lastFeed.source||'桃園機場'); }
async function refreshSource(){
 if(feedBusy)return;feedBusy=true;try{renderFeed(await api({action:'snapshot'}));connected();}catch(error){connectionError(error);}finally{feedBusy=false;}
}
async function refresh() {
  if (busy || navigator.onLine===false || !token) return;
  if(!lastFeed||!Array.isArray(lastFeed.flights)||Date.now()>=lastFeed.next_refresh_at)void refreshSource();
  busy=true;
  try {renderFeed(await api({action:'pulse'}));connected();}
  catch(error){connectionError(error);}
  finally{busy=false;}
}
$('enableAudio').onclick=async()=>{try{if(!window.speechSynthesis || !window.AudioContext)throw new Error('此瀏覽器不支援語音廣播');audio ||= new AudioContext();await audio.resume();enabled=true;$('startOverlay').hidden=true;void document.documentElement.requestFullscreen?.().catch(()=>{});$('enableAudio').textContent='降落廣播已啟用';$('enableAudio').setAttribute('aria-pressed','true');void announceNext();}catch(error){$('boardStatus').textContent=error.message;}};
function tick(){const seconds=Math.max(0,Math.ceil(((lastFeed?.next_refresh_at||Date.now()+300000)-Date.now())/1000));$('refreshCountdown').textContent=seconds?String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0')+' 後更新':'正在更新航班'; $('clock').textContent=new Date().toLocaleTimeString('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});renderTracked();renderUpcoming(); }
tick();timer=setInterval(tick,1000);briefingTimer=setInterval(()=>void refreshBriefing(),300000);pulseTimer=setInterval(()=>void refresh(),5000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});window.addEventListener('online',()=>void refresh());
window.addEventListener('pagehide',()=>{clearInterval(timer);clearInterval(pulseTimer);clearInterval(briefingTimer);channel?.close();news?.destroy();window.speechSynthesis?.cancel();});
if(token){void refresh();void refreshBriefing();}else{$('startMessage').textContent='請在後台「看板管理」取得永久電視連結';$('enableAudio').hidden=true;news=mountLiveNews($('liveNews'));}
const channel=window.BroadcastChannel?new BroadcastChannel('heycar-flight-watches'):null;if(channel)channel.onmessage=()=>void refresh();
