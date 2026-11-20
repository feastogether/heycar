const CITIES = [
  ['台北',25.033,121.565],['桃園',24.993,121.301],['新竹',24.804,120.971],
  ['台中',24.147,120.674],['台南',22.999,120.227],['高雄',22.627,120.301]
];
const MIS = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_t00.tw&json=1&delay=0';
const DAILY = 'https://openapi.twse.com.tw/v1/exchangeReport/FMTQIK';
const number = value => typeof value==='number'||typeof value==='string'&&value.trim() ? Number(String(value).replaceAll(',','')) : NaN;
async function json(url, fetcher) {
  const response = await fetcher(url,{signal:AbortSignal.timeout(7000),cf:{cacheTtl:0,cacheEverything:false}});
  if (!response.ok || !response.body) throw Error('BRIEFING_SOURCE');
  const reader=response.body.getReader(),parts=[];let size=0;
  for (;;) {const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>128000){await reader.cancel();throw Error('BRIEFING_TOO_LARGE');}parts.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
export function weatherItems(rows) {
  if (!Array.isArray(rows)||rows.length!==CITIES.length) throw Error('WEATHER_FORMAT');
  return rows.map((row,i)=>{
    const temperature=number(row.current?.temperature_2m),rain=number(row.daily?.precipitation_probability_max?.[0]);
    if (!Number.isFinite(temperature)||temperature < -30||temperature>60||!Number.isFinite(rain)||rain<0||rain>100||!/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(row.current?.time||'')) throw Error('WEATHER_FORMAT');
    return {kind:'weather',text:CITIES[i][0]+' '+temperature.toFixed(1)+'°C · 今日降雨 '+Math.round(rain)+'% · '+row.current.time.replace('T',' ')+'｜Open-Meteo',date:row.current.time.slice(0,10)};
  });
}
export function stockItem(payload, daily=false) {
  let row,date,stamp,point,change,percent;
  if (daily) {
    row=Array.isArray(payload)?[...payload].filter(x=>/^\d{7}$/.test(x.Date)).sort((a,b)=>b.Date.localeCompare(a.Date))[0]:null;
    if(!row)throw Error('STOCK_FORMAT');date=String(Number(row.Date.slice(0,3))+1911)+'-'+row.Date.slice(3,5)+'-'+row.Date.slice(5,7);stamp='收盤參考';point=number(row.TAIEX);change=number(row.Change);percent=change/(point-change)*100;
  } else {
    row=payload?.msgArray?.find(x=>x.c==='t00');if(!row||!/^\d{8}$/.test(row.d)||!/^\d\d:\d\d:\d\d$/.test(row.t))throw Error('STOCK_FORMAT');
    date=row.d.slice(0,4)+'-'+row.d.slice(4,6)+'-'+row.d.slice(6,8);stamp=row.t+(row.t>='13:30:00'?' 收盤參考':' 盤中資料');point=number(row.z);const prior=number(row.y);change=point-prior;percent=change/prior*100;
  }
  if(!Number.isFinite(point)||point<=0||!Number.isFinite(change)||!Number.isFinite(percent))throw Error('STOCK_FORMAT');
  const fmt=n=>(n>0?'+':'')+n.toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2});
  return {kind:'stock',date,text:'台股加權 '+point.toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2})+' 點 · '+fmt(change)+'（'+fmt(percent)+'%）· '+date+' '+stamp+'｜TWSE'};
}
async function cached(bucket,kind,ttl,loader,now) {
  const name='_flight-board/briefing/'+kind+'.json',file=await bucket.get(name),old=file?await file.json():null;
  if(old?.next_refresh_at>now)return old;
  try {
    const items=await loader(),value={items,updated_at:now,next_refresh_at:now+ttl};
    await bucket.put(name,JSON.stringify(value),{onlyIf:file?{etagMatches:file.etag}:{etagDoesNotMatch:'*'}});return value;
  } catch {
    // Preserve dated values and back off; never invent weather, prices or zero values.
    const value={items:old?.items||[],updated_at:old?.updated_at||0,next_refresh_at:now+300000,delayed:true};
    await bucket.put(name,JSON.stringify(value),{onlyIf:file?{etagMatches:file.etag}:{etagDoesNotMatch:'*'}});return value;
  }
}
export async function boardBriefing(bucket,{fetcher=fetch,now=Date.now(),includeWeather=true,includeStock=true}={}) {
  const url=new URL('https://api.open-meteo.com/v1/forecast');url.search=new URLSearchParams({latitude:CITIES.map(x=>x[1]).join(','),longitude:CITIES.map(x=>x[2]).join(','),current:'temperature_2m',daily:'precipitation_probability_max',forecast_days:'1',timezone:'Asia/Taipei'}).toString();
  const [weather,stock]=await Promise.all([
    includeWeather?cached(bucket,'weather',1800000,async()=>weatherItems(await json(url,fetcher)),now):Promise.resolve({items:[],updated_at:now}),
    includeStock?cached(bucket,'stock',300000,async()=>{try{return [stockItem(await json(MIS,fetcher))];}catch{return [stockItem(await json(DAILY,fetcher),true)];}},now):Promise.resolve({items:[],updated_at:now})
  ]);
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(new Date(now));
  return {items:[...weather.items.filter(x=>x.date===today&&now-weather.updated_at<7200000).map(x=>({...x,text:x.text+(weather.delayed?' · 更新延遲':'')})),...stock.items.map(x=>({...x,text:x.text+(stock.delayed?' · 更新延遲':'')}))],next_refresh_at:now+300000,weather_delayed:!!weather.delayed,stock_delayed:!!stock.delayed};
}
