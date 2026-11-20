const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict'),{stripTypeScriptTypes}=require('node:module'),{gunzipSync}=require('node:zlib');
const {compactBoardFeed,expandBoardFeed}=require('../supabase/functions/flights/board-feed.mjs');
(async()=>{
 const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(new Date());
 const row={'方向':'A','航空公司代碼':'CI','班次':'0001','航空公司中文':'測試航空','往來地點中文':'東京','表訂日期':date,'表訂時間':'18:00:00','預計日期':date,'預計時間':'18:10:00','備註':'已到','航班動態中文':'抵達機坪','航廈':'T2','行李轉盤':'03'};
 const feed=compactBoardFeed([row,{...row,'方向':'D'},{...row,'表訂日期':'2020-01-01'}]);assert.equal(feed.rows.length,1);const expanded=expandBoardFeed(feed);assert.equal(expanded[0]['班次'],'0001');assert.equal(expanded[0]['備註'],'已到');assert.throws(()=>expandBoardFeed({version:1,updated:Date.now(),rows:[[1]]}));
 const csv=Object.keys(row).join(',')+'\n'+Object.values(row).map(value=>'"'+value+'"').join(',')+'\n';
 let handler,fetchCount=0;const context=vm.createContext({Deno:{serve(fn){handler=fn;},env:{get:()=>''}},compactBoardFeed,Request,Response,Blob,CompressionStream,URL,URLSearchParams,TextEncoder,Date,Intl,Map,AbortSignal,fetch:async()=>{fetchCount++;return new Response(csv);}});
 const source=fs.readFileSync(path.resolve(__dirname,'../supabase/functions/flights/index.ts'),'utf8').replace(/^import .*\r?\n/gm,'');vm.runInContext(stripTypeScriptTypes(source),context);
 let response=await handler(new Request('https://fixture.invalid/?source=taoyuan&board=1'));assert.equal(response.status,200);assert.equal(response.headers.get('content-encoding'),'gzip');const compressed=Buffer.from(await response.arrayBuffer());const payload=JSON.parse(gunzipSync(compressed));assert.equal(payload.version,1);assert.equal(payload.rows.length,1);assert.equal(response.headers.get('x-feed-bytes'),String(compressed.length));
 response=await handler(new Request('https://fixture.invalid/?source=taoyuan&q=CI1&date='+date));assert.equal(response.status,200);assert(Array.isArray(await response.json()),'ordinary driver flight search is unchanged');assert.equal(fetchCount,1,'relay and normal searches share source cache');
 console.log('PASS: compact arrival-only feed, date bounds, gzip transport, validated expansion, source cache and unchanged normal flight search.');
})().catch(error=>{console.error(error);process.exitCode=1;});
