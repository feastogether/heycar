(function(){
 'use strict';
 window.HeycarMediaUpload=async function(api,action,payload){
  if(window.AFIDE_CONFIG?.DIRECT_MEDIA_UPLOAD!==true)return api(action,payload);
  const {base64,...metadata}=payload;
  const ticket=await api(action+'_ticket',metadata);
  const url=new URL(ticket.url,location.origin);
  if(url.origin!==location.origin||url.pathname!=='/api/operational-media')throw Error('照片服務網址錯誤');
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:ticket.token,base64}),signal:AbortSignal.timeout(60000)});
  const result=await response.json();if(!response.ok||!result.receipt)throw Error(result.error||'照片上傳失敗，請重試');
  return api(action,{...metadata,receipt:result.receipt});
 };
})();
