import {signMedia,verifyMedia,mediaKey} from '../supabase/functions/data-api/media-store.mjs';
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const hex=bytes=>Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
async function bounded(request){const reader=request.body?.getReader();if(!reader)throw Error('EMPTY_BODY');let size=0;const chunks=[];for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>3000000){await reader.cancel();throw Error('FILE_TOO_LARGE');}chunks.push(value);}const joined=new Uint8Array(size);let off=0;for(const c of chunks){joined.set(c,off);off+=c.length;}return JSON.parse(new TextDecoder().decode(joined));}
async function store(env,bucket,path,base64){
 if(typeof base64!=='string'||base64.length>2796204)throw Error('INVALID_IMAGE');
 const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255,png=[137,80,78,71,13,10,26,10].every((v,i)=>v===bytes[i]);
 if(!bytes.length||bytes.length>2097152||!jpeg&&!png||!path.endsWith(jpeg?'.jpg':'.png'))throw Error('INVALID_IMAGE');
 const sha=hex(await crypto.subtle.digest('SHA-256',bytes)),key=mediaKey(bucket,path),mime=jpeg?'image/jpeg':'image/png';
 const saved=await env.ATTACHMENTS.put(key,bytes,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:mime,cacheControl:'private, max-age=600'},customMetadata:{originalName:path.split('/').at(-1),sha,managed:'true'}});
 if(!saved){const existing=await env.ATTACHMENTS.head(key);if(existing?.customMetadata?.sha!==sha)throw Error('PHOTO_ID_ALREADY_USED');}
 return {sha,size:bytes.length,mime};
}
export async function operationalMedia(request,env){
 if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
 try{
  const body=await bounded(request),internal=new URL(request.url).pathname.startsWith('/internal/');
  const claims=await verifyMedia(env.MEDIA_SIGNING_SECRET,body.token,internal?'server':'upload');if(!claims)return json({error:'INVALID_MEDIA_PERMISSION'},403);
  if(!internal){const result=await store(env,claims.bucket,claims.path,body.base64);return json({receipt:await signMedia(env.MEDIA_SIGNING_SECRET,{...claims,...result,kind:'receipt',exp:Date.now()+86400000})});}
  const args=claims.args;
  if(claims.op==='upload'){if(typeof body.base64!=='string'||hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body.base64)))!==args.content_sha)return json({error:'INVALID_CONTENT_SIGNATURE'},403);return json(await store(env,args.bucket,args.path,body.base64));}
  if(!Array.isArray(args.paths)||args.paths.length>100)throw Error('INVALID_MEDIA_PATHS');
  const keys=args.paths.map(path=>mediaKey(args.bucket,path));
  if(claims.op==='remove'){await env.ATTACHMENTS.delete(keys);return json({ok:true});}
  if(claims.op==='sign'){
   const data=[];for(const key of keys){const signingKey=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.FILE_SIGNING_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=hex(await crypto.subtle.sign('HMAC',signingKey,new TextEncoder().encode(key)));data.push(`${new URL(args.origin).origin}/files/${encodeURIComponent(key)}?sig=${sig}`);}return json({data});
  }
  return json({error:'UNKNOWN_ACTION'},400);
 }catch{return json({error:'照片處理失敗，請確認檔案大小或重新拍攝'},409);}
}
