const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
function functionSource(name) {
  const start = app.indexOf(`function ${name}(`);
  assert(start >= 0, name);
  const rest = app.slice(start);
  const end = /\n  }\r?\n/.exec(rest);
  assert(end, `end of ${name}`);
  return rest.slice(0, end.index + end[0].length);
}

async function libraryTests() {
  const scripts = [];
  const context = vm.createContext({window:{}, optionalLibraryPromises:new Map(), setTimeout, clearTimeout,
    document:{createElement:()=>({dataset:{},remove(){this.removed=true}}),head:{appendChild:script=>scripts.push(script)}}});
  vm.runInContext(functionSource('ensureOptionalLibrary'),context);
  const first = context.ensureOptionalLibrary('excel');
  const second = context.ensureOptionalLibrary('excel');
  assert.equal(first,second);assert.equal(scripts.length,1);
  context.window.XLSX = {read(){}};scripts[0].onload();
  assert.equal(await first,context.window.XLSX);
  await context.ensureOptionalLibrary('excel');assert.equal(scripts.length,1);
  const failure = context.ensureOptionalLibrary('ocr');
  scripts[1].onerror();await assert.rejects(failure);assert(scripts[1].removed);
  const retry = context.ensureOptionalLibrary('ocr');
  assert.equal(scripts.length,3);context.window.Tesseract={};scripts[2].onload();await retry;
  await assert.rejects(context.ensureOptionalLibrary('unknown'));
  const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert(!/xlsx|tesseract|pdf-lib|fontkit|liff\/edge/.test(html));
  assert(!fs.readFileSync(path.join(root,'styles.css'),'utf8').includes('fonts.googleapis.com'));
}

async function scopeTests() {
  const calls=[];let release;
  const state={admin:true,apiSession:'session-a',data:{},adminProfile:{}};
  const context=vm.createContext({state,hasApi:true,Promise,emptyData:()=>({vehicles:[],staff_notes:[]}),
    adminFullDataReady:false,adminFullDataPromise:null,
    apiRequest:async(action,payload)=>{calls.push(payload);if(payload.scope==='workspace')return new Promise(resolve=>{release=resolve});return {data:{staff_notes:[{content:'保留首頁資料'}]}}}});
  vm.runInContext(`async ${functionSource('loadAll')}\n${functionSource('ensureAdminWorkspaceData')}`,context);
  await context.loadAll({homeOnly:true});assert.equal(calls[0].scope,'home');
  const first=context.ensureAdminWorkspaceData(),second=context.ensureAdminWorkspaceData();
  assert.equal(first,second);assert.equal(calls.length,2);assert.equal(calls[1].scope,'workspace');
  release({data:{vehicles:[{id:'vehicle'}]}});await first;
  assert.equal(state.data.staff_notes[0].content,'保留首頁資料');assert.equal(state.data.vehicles.length,1);
  await context.ensureAdminWorkspaceData();assert.equal(calls.length,2);
  const stale=context.loadAll({workspaceOnly:true});state.apiSession='session-b';release({data:{vehicles:[{id:'stale'}]}});await stale;
  assert.equal(state.data.vehicles[0].id,'vehicle');
}

async function workerTests() {
  assert(fs.readFileSync(path.join(root,'wrangler.toml'),'utf8').includes('run_worker_first = ["/*.js", "/*.css", "/api/*", "/files/*"]'));
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(new Date());
  const tomorrow=new Date(Date.parse(`${today}T00:00:00+08:00`)+86400000).toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'});
  let requests=[];
  const context=vm.createContext({Request,Response,Headers,URL,URLSearchParams,Intl,Date,AbortSignal,
    fetch:async(url,options)=>{requests.push({url:new URL(url),options});return Response.json({daily:{time:[today,tomorrow],weather_code:[3,0],temperature_2m_min:[21,22],temperature_2m_max:[29,30],precipitation_probability_max:[20,30]}})}});
  const weather=fs.readFileSync(path.join(root,'cloudflare/office-weather.js'),'utf8').replace('export async function','async function');
  const worker=fs.readFileSync(path.join(root,'cloudflare/frontend-worker.js'),'utf8').replace(/^import .*\r?\n/,'').replace('export default','globalThis.worker =');
  vm.runInContext(`${weather}\n${worker}`,context);
  let response=await context.officeWeather(new Request('https://test/api/office-weather'));
  assert.equal(response.status,200);assert.equal((await response.json()).days.length,2);
  assert.equal(requests[0].url.searchParams.get('timezone'),'Asia/Taipei');assert.equal(requests[0].url.searchParams.get('end_date'),tomorrow);
  assert.equal(requests[0].options.cf.cacheTtl,1800);assert(response.headers.get('cache-control').includes('900'));
  assert.equal((await context.officeWeather(new Request('https://test/api/office-weather',{method:'POST'}))).status,405);
  context.fetch=async()=>Response.json({daily:{time:[today,tomorrow]}});
  response=await context.officeWeather(new Request('https://test/api/office-weather'));assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');
  context.fetch=async()=>{throw new Error('network')};assert.equal((await context.officeWeather(new Request('https://test/api/office-weather'))).status,503);
  const env={ASSETS:{fetch:async()=>new Response('static',{headers:{'cache-control':'no-store',pragma:'no-cache'}})},STORAGE:{fetch:async()=>new Response('private',{headers:{'cache-control':'private, no-store'}})}};
  response=await context.worker.fetch(new Request('https://test/app.js?v=20261018-1'),env);
  assert(response.headers.get('cache-control').includes('immutable'));assert.equal(response.headers.get('pragma'),null);
  for(const url of ['https://test/','https://test/index.html','https://test/app.js'])assert((await context.worker.fetch(new Request(url),env)).headers.get('cache-control').includes('no-store'));
  response=await context.worker.fetch(new Request('https://test/files/private.js?v=1'),env);
  assert.equal(await response.text(),'private');assert.equal(response.headers.get('cache-control'),'private, no-store');
  response=await context.worker.fetch(new Request('https://test/api/office-weather'),env);assert.equal(response.status,503);
}

function dateTests() {
  let clock=Date.parse('2026-10-18T15:59:59.999Z'),formatters=0,formats=0;
  class ClockDate extends Date { constructor(...args){super(...(args.length?args:[clock]))}static now(){return clock} }
  const context=vm.createContext({Date:ClockDate,Intl:{DateTimeFormat:function(...args){formatters++;const formatter=new Intl.DateTimeFormat(...args);return {formatToParts:date=>{formats++;return formatter.formatToParts(date)}}}}});
  vm.runInContext(`${functionSource('taipeiParts')}\n${functionSource('today')}`,context);
  for(let i=0;i<1000;i++)assert.equal(context.today(),'2026-10-18');
  assert.equal(formats,1);assert.equal(formatters,1);
  clock+=2;assert.equal(context.today(),'2026-10-19');assert.equal(formats,2);assert.equal(formatters,1);
  clock=Date.parse('2026-12-31T16:00:00Z');assert.equal(context.today(),'2027-01-01');
}

libraryTests().then(scopeTests).then(workerTests).then(dateTests).then(()=>console.log('PASS: optional libraries, scoped loads, stale sessions, forecast/cache, shared date formatter and midnight/year rollover')).catch(error=>{console.error(error);process.exitCode=1});
