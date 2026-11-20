const text=value=>String(value||'').trim().replace(/^null$/i,'');
export function compactBoardFeed(rows,updated=Date.now(),now=Date.now()){
 const date=value=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(new Date(value));
 const days=[date(now),date(now+86400000)];
 return {version:1,updated,rows:rows.filter(row=>row['方向']==='A'&&days.includes(text(row['表訂日期']).slice(0,10))).slice(0,3000).map(row=>[text(row['航空公司代碼'])+text(row['班次']),text(row['航空公司中文']),text(row['往來地點中文'])||text(row['往來地點英文']),text(row['表訂日期']).slice(0,10),text(row['表訂時間']).slice(0,8),text(row['預計日期']).slice(0,10),text(row['預計時間']).slice(0,8),text(row['航廈']),text(row['行李轉盤']),text(row['備註']),text(row['航班動態中文'])])};
}
export function expandBoardFeed(payload){
 if(payload?.version!==1||!Number.isFinite(payload.updated)||!Array.isArray(payload.rows)||payload.rows.length>3000)throw Error('SOURCE_FORMAT_CHANGED');
 return payload.rows.map(row=>{
  if(!Array.isArray(row)||row.length!==11||row.some(value=>typeof value!=='string'||value.length>300))throw Error('SOURCE_FORMAT_CHANGED');
  const [number,airline,city,date,scheduled,estimatedDate,estimated,terminal,baggage,remark,detail]=row;
  return {'方向':'A','航空公司代碼':number.slice(0,2),'班次':number.slice(2),'航空公司中文':airline,'往來地點中文':city,'表訂日期':date,'表訂時間':scheduled,'預計日期':estimatedDate,'預計時間':estimated,'航廈':terminal,'行李轉盤':baggage,'備註':remark,'航班動態中文':detail};
 });
}
