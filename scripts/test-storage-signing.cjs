const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');
const source=fs.readFileSync(path.join(__dirname,'../supabase/functions/data-api/index.ts'),'utf8');
const start=source.indexOf('const storagePathFromUrl ='),end=source.indexOf('const phoneDigits =',start);
async function run(){
 const calls=[];let active=0,maximum=0;
 const bucket={async createSignedUrls(paths){active++;maximum=Math.max(active,maximum);calls.push(paths);await new Promise(resolve=>setTimeout(resolve,2));active--;return {data:paths.map(path=>path==='missing'?{path,error:'not found'}:{path,signedUrl:'https://signed.invalid/'+encodeURIComponent(path)})};}};
 const {signStorageUrls}=vm.runInNewContext(stripTypeScriptTypes(source.slice(start,end))+';({signStorageUrls})',{db:{storage:{from:()=>bucket}},storageBucket:'attachments',signedStorageUrlTtlSeconds:3600,URL});
 const base='https://storage.invalid/storage/v1/object/public/attachments/';
 const input={data:Array.from({length:450},(_,i)=>({id:i,url:base+(i%250),nested:{avatar_url:base+(i%250)}})),foreign:{url:'https://drive.google.com/file/original'},missing:{url:base+'missing'}};
 const original=JSON.stringify(input),output=await signStorageUrls(input);
 assert.equal(calls.length,3);assert.equal(calls.flat().length,251);assert(maximum<=4);
 assert.equal(JSON.stringify(input),original,'Do not mutate cached data or stored file snapshots');
 assert.equal(output.data[0].url,'https://signed.invalid/0');assert.equal(output.data[250].nested.avatar_url,output.data[0].url);
 assert.equal(output.foreign.url,input.foreign.url);assert.equal(output.missing.url,input.missing.url);
 calls.length=0;await signStorageUrls({id:1,notes:'no attachment'});assert.equal(calls.length,0);
 console.log('PASS: 900 URL references become 251 unique paths in 3 bounded batch calls, while source objects, unrelated links and missing-file fallbacks remain unchanged.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
