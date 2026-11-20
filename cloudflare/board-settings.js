export const SETTINGS_KEY='_flight-board/settings.json';
export async function readBoardSettings(bucket){const file=await bucket.get(SETTINGS_KEY);return file?{file,data:await file.json()}:{file:null,data:{revision:0,marquee:[],announcements:[]}};}
export async function saveBoardSettings(bucket,input,actor){
 if(!input||['ticker_weather','ticker_stock'].some(k=>input[k]!==undefined&&typeof input[k]!=='boolean')||!Number.isSafeInteger(input.revision)||!Array.isArray(input.marquee)||input.marquee.length>20||input.marquee.some(x=>typeof x!=='string'||x.length>500)||!Array.isArray(input.announcements)||input.announcements.length>12||input.announcements.some(x=>!x||typeof x.title!=='string'||x.title.length>100||typeof x.content!=='string'||x.content.length>2000))throw Error('INVALID_SETTINGS');
 const current=await readBoardSettings(bucket);if(current.data.revision!==input.revision)return null;
 const data={revision:input.revision+1,ticker_weather:input.ticker_weather!==false,ticker_stock:input.ticker_stock!==false,marquee:input.marquee.map(x=>x.trim()).filter(Boolean),announcements:input.announcements.map(x=>({id:String(x.id||crypto.randomUUID()).slice(0,80),title:x.title.trim(),content:x.content.trim(),active:x.active!==false})).filter(x=>x.title||x.content),updated_at:new Date().toISOString()};
 const saved=await bucket.put(SETTINGS_KEY,JSON.stringify(data),{onlyIf:current.file?{etagMatches:current.file.etag}:{etagDoesNotMatch:'*'}});if(!saved)return null;
 await bucket.put('_flight-board/settings-audit/'+crypto.randomUUID()+'.json',JSON.stringify({actor,at:data.updated_at,before:current.data,after:data}));return data;
}
