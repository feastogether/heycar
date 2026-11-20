const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const load = file => import(require('node:url').pathToFileURL(path.join(root,file)).href);
class Bucket {
  rows = new Map();
  async get(key) {const row=this.rows.get(key);return row?{...row,json:async()=>JSON.parse(row.body)}:null;}
  async head(key){return this.get(key);}
  async put(key,body,options={}){const old=this.rows.get(key);if(options.onlyIf?.etagDoesNotMatch==='*'&&old)return null;if(options.onlyIf?.etagMatches&&old?.etag!==options.onlyIf.etagMatches)return null;const row={key,body,etag:require('node:crypto').createHash('sha256').update(body).digest('hex'),customMetadata:options.customMetadata};this.rows.set(key,row);return row;}
  async delete(key){this.rows.delete(key);}
  async list({prefix}){return {objects:[...this.rows.values()].filter(x=>x.key.startsWith(prefix)),truncated:false};}
}
(async()=>{
  const {flightBoard,flightKey,mapArrival,parseCsv}=await load('cloudflare/flight-board.js');
  assert.equal(flightKey('CI 0001'),'CI1');assert.equal(flightKey('5J0310'),'5J310');
  assert.equal(parseCsv('\uFEFFa,b\r\n"a,b","c""d"\r\n')[0].b,'c"d');
  const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(new Date());
  const pending={'方向':'A','航空公司代碼':'CI','班次':'0001','航空公司中文':'測試航空','表訂日期':date+'+08:00','表訂時間':'23:50:00+08:00','預計日期':date+'+08:00','預計時間':'23:45:00+08:00','航班動態中文':'預計已抵達','往來地點中文':'測試城市','航廈':'T2'};
  assert.equal(mapArrival(pending).landed,false);assert.equal(mapArrival({...pending,'備註':'已到','航班動態中文':'抵達機坪'}).landed,true);
  const bucket=new Bucket(),env={ATTACHMENTS:bucket,SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-test-only'};
  const originalFetch=global.fetch;let restCalls=0,sourceCalls=0;
  global.fetch=async url=>{
    const u=new URL(url);
    if(u.hostname==='odp.taoyuan-airport.com'){sourceCalls++;return new Response(Object.keys(pending).join(',')+'\n'+Object.values(pending).map(v=>'"'+v+'"').join(',')+'\n');}
    restCalls++;
    if(u.pathname.endsWith('/app_sessions')){const token=u.searchParams.get('token');return Response.json(token==='eq.admin'?[{session_type:'admin',is_super_admin:true}]:token==='eq.driver'?[{session_type:'driver',driver_id:'driver-a'}]:token==='eq.other'?[{session_type:'driver',driver_id:'driver-b'}]:[]);}
    if(u.pathname.endsWith('/drivers'))return Response.json([{name:'合成司機'}]);
    if(u.pathname.endsWith('/marquee_messages'))return Response.json([{message:'測試跑馬燈'}]);
    throw Error('Unexpected fetch '+u.pathname);
  };
  const call=async(body,headers={})=>{const response=await flightBoard(new Request('https://fixture.invalid/api/flight-board',{method:'POST',headers,body:JSON.stringify(body)}),env);return {status:response.status,data:await response.json()};};
  let pair;
  try{
    assert.equal((await call({action:'snapshot'})).status,401);
    assert.equal((await call({action:'pair'},{'x-afide-session':'driver'})).status,403);
    pair=await call({action:'pair'},{'x-afide-session':'admin'});assert.equal(pair.status,200);
    await call({action:'settings_save',settings:{revision:0,marquee:['電視專用跑馬燈'],announcements:[{id:'notice',title:'公司公告',content:'測試公告',active:true}]}},{'x-afide-session':'admin'});
    const follow={action:'follow',flight_no:'CI0001',date};
    assert.equal((await call(follow,{'x-afide-session':'driver'})).status,200);
    assert.equal((await call({...follow,driver_name:'偽造姓名'}, {'x-afide-session':'driver'})).status,200);
    assert.equal(sourceCalls,1,'shared feed cache');
    let snapshot=await call({action:'snapshot'},{'x-board-token':pair.data.token});assert.equal(snapshot.status,200);assert.equal(snapshot.data.watches.length,1);assert.equal(snapshot.data.watches[0].driverName,'合成司機');assert.equal(snapshot.data.marquee[0],'電視專用跑馬燈');
    const beforePulse=restCalls;const immediate=await call({action:'pulse'},{'x-board-token':pair.data.token});assert.equal(immediate.data.watches.length,1,'follow is visible on the next lightweight pulse');assert.equal(restCalls,beforePulse,'pulse only reads R2');assert.equal(sourceCalls,1,'pulse cannot download flight source');
    const before=restCalls;await call({action:'snapshot'},{'x-board-token':pair.data.token});assert.equal(restCalls,before,'paired TV refresh must not reread Supabase');
    await call({action:'unfollow',flight_no:'CI1',date},{'x-afide-session':'other'});snapshot=await call({action:'snapshot'},{'x-board-token':pair.data.token});assert.equal(snapshot.data.watches.length,1,'another driver cannot remove watch');
    const landed={...mapArrival({...pending,'備註':'已到'}),estimatedTime:new Date().toISOString()};
    await bucket.put('_flight-board/cache/arrivals.json',JSON.stringify({updated:Date.now(),flights:[landed]}));
    snapshot=await call({action:'snapshot'},{'x-board-token':pair.data.token});assert(snapshot.data.watches[0].landedAt);const first=snapshot.data.watches[0].landedAt;
    snapshot=await call({action:'snapshot'},{'x-board-token':pair.data.token});assert.equal(snapshot.data.watches[0].landedAt,first,'landing event persists across TVs');
    await call({action:'revoke',id:pair.data.id},{'x-afide-session':'admin'});assert.equal((await call({action:'snapshot'},{'x-board-token':pair.data.token})).status,401);
  }finally{global.fetch=originalFetch;}
  const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://fixture');const file=path.resolve(root,'.'+(url.pathname==='/flight-board'?'/flight-board.html':url.pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    const base='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1920,height:1080}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{localStorage.setItem('heycar-board-token','a'.repeat(64));window.__news=[];window.YT={Player:class{constructor(el,options){this.options=options;this.frame=document.createElement('iframe');el.replaceWith(this.frame);window.__player=this;queueMicrotask(()=>options.events.onReady());}getIframe(){return this.frame;}mute(){window.__news.push('mute');}unMute(){window.__news.push('unmute');}playVideo(){}loadVideoById(){}destroy(){}}};window.AudioContext=class{currentTime=0;destination={};resume(){return Promise.resolve();}createOscillator(){return {frequency:{},connect(){return {connect(){}};},start(){},stop(){}};}createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){}};}};window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[],speak:u=>{window.__spoken=u.text;setTimeout(()=>u.onend(),10);},cancel(){}}});});
    const watch={id:'test-watch',flightNo:'CI1',driverName:'測試司機',createdAt:Date.now(),landedAt:Date.now(),flight:{airline:'測試航空',city:'東京',status:'已抵達'}};
    await page.route('**/api/flight-board',route=>route.fulfill({json:{next_refresh_at:Date.now()+300000,updated_at:new Date().toISOString(),announcements:[{title:"公司公告",content:"測試公告"}],flights:[mapArrival(pending)],watches:[watch],marquee:['安全駕駛'],news_video_id:'wM0g8EoUZ_E'}}));
    await page.goto(base+'/flight-board#pair='+'a'.repeat(64));await page.locator('.news-video iframe').waitFor();assert.equal(new URL(page.url()).hash,'');assert.match(await page.locator('.news-video iframe').getAttribute('title'),/華視/);
    await page.locator('[data-news-sound]').evaluate(el=>el.click());await page.locator('#enableAudio').click();await page.waitForFunction(()=>window.__spoken?.includes('測試司機'));await page.waitForTimeout(80);
    const calls=await page.evaluate(()=>window.__news);assert(calls.indexOf('unmute')>=0);assert.deepEqual(calls.slice(-2),['mute','unmute'],'news ducks for landing speech and restores selected sound');
    assert.equal(await page.locator('#marqueeText').textContent(),'安全駕駛');
    for(const width of [1920,1440,768,390]){await page.setViewportSize({width,height:1080});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow '+width);}
    await page.setViewportSize({width:1920,height:1080});fs.mkdirSync(path.join(root,'.fleet-preview'),{recursive:true});await page.screenshot({path:path.join(root,'.fleet-preview','nov20-flight-board.png'),fullPage:true});assert.deepEqual(errors,[]);
    console.log('Flight board PASS: verified identity, private pairing/revocation, cache, landing status, official news player, audio duck/restore, responsive layout. YouTube playback mocked; live ID verified separately by official page and oEmbed.');
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
