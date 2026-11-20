const encoder=new TextEncoder();
const encoded=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const decoded=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
const key=secret=>crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
export async function signMedia(secret,claims){if(!secret||secret.length<32)throw Error('MEDIA_NOT_CONFIGURED');const payload=encoded(encoder.encode(JSON.stringify(claims)));return payload+'.'+encoded(await crypto.subtle.sign('HMAC',await key(secret),encoder.encode(payload)));}
export async function verifyMedia(secret,token,kind){try{if(!secret||typeof token!=='string'||token.length>12000)return null;const parts=token.split('.');if(parts.length!==2||!await crypto.subtle.verify('HMAC',await key(secret),decoded(parts[1]),encoder.encode(parts[0])))return null;const claims=JSON.parse(new TextDecoder().decode(decoded(parts[0])));if(claims.kind!==kind||!Number.isSafeInteger(claims.exp)||claims.exp<Date.now()||claims.exp>Date.now()+86400001)return null;return claims;}catch{return null;}}
export function mediaKey(bucket,path){if(!['vehicle-inspections','driver-operations'].includes(bucket)||typeof path!=='string'||!(/^[a-f0-9-]{36}\/[a-f0-9-]{36}\.(jpg|png)$/.test(path)))throw Error('INVALID_MEDIA_PATH');return `photos/${bucket}/${path}`;}
export function createMediaStore({db,secret,apiUrl,publicOrigin,fetcher=fetch}){
 if(!secret||!apiUrl||!publicOrigin)return null;
 const remote=async(op,args)=>{const {base64,...safeArgs}=args;if(base64)safeArgs.content_sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(base64))),v=>v.toString(16).padStart(2,'0')).join('');const token=await signMedia(secret,{kind:'server',op,args:safeArgs,exp:Date.now()+60000});const response=await fetcher(apiUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,...(base64?{base64}:{})}),signal:AbortSignal.timeout(30000)});const result=await response.json();if(!response.ok)throw Error(result.error||'MEDIA_SERVICE_UNAVAILABLE');return result;};
 const pathFor=(bucket,path)=>{mediaKey(bucket,path);return `r2://${bucket}/${path}`;};
 const parse=(bucket,path)=>{const prefix=`r2://${bucket}/`;if(!path.startsWith(prefix))throw Error('INVALID_MEDIA_BUCKET');const logical=path.slice(prefix.length);mediaKey(bucket,logical);return logical;};
 return {
  pathFor,
  async issue(claims){mediaKey(claims.bucket,claims.path);return {token:await signMedia(secret,{...claims,kind:'upload',exp:Date.now()+600000}),url:new URL('/api/operational-media',publicOrigin).href};},
  async receipt(token,expected){const value=await verifyMedia(secret,token,'receipt');if(!value||Object.entries(expected).some(([k,v])=>value[k]!==v)||!Number.isSafeInteger(value.size)||value.size<1||value.size>2097152||!['image/jpeg','image/png'].includes(value.mime)||!/^[a-f0-9]{64}$/.test(value.sha))throw Error('照片上傳憑證錯誤或過期，請重新上傳');mediaKey(value.bucket,value.path);return value;},
  bucket(bucket){const old=db.storage.from(bucket);return {
   async upload(path,bytes,options){try{const result=await remote('upload',{bucket,path,base64:btoa(Array.from(bytes,c=>String.fromCharCode(c)).join('')),mime:options.contentType});return {data:result,error:null};}catch(error){return {error};}},
   async remove(paths){try{const legacy=paths.filter(p=>!p.startsWith('r2://')),r2=paths.filter(p=>p.startsWith('r2://')).map(p=>parse(bucket,p));if(legacy.length){const result=await old.remove(legacy);if(result.error)throw result.error;}if(r2.length)await remote('remove',{bucket,paths:r2});return {error:null};}catch(error){return {error};}},
   async createSignedUrls(paths,ttl){try{const data=[];const legacy=paths.filter(p=>!p.startsWith('r2://'));let oldUrls=[];if(legacy.length){const result=await old.createSignedUrls(legacy,ttl);if(result.error)throw result.error;oldUrls=result.data||[];}const r2=paths.filter(p=>p.startsWith('r2://')),urls=[];for(let i=0;i<r2.length;i+=100)urls.push(...(await remote('sign',{bucket,paths:r2.slice(i,i+100).map(p=>parse(bucket,p)),origin:publicOrigin})).data);for(const path of paths)data.push(path.startsWith('r2://')?{path,signedUrl:urls[r2.indexOf(path)]}:oldUrls.find(item=>item.path===path)||{path,signedUrl:''});return {data,error:null};}catch(error){return {error};}}
  };}
 };
}
