export const inspectionSlots=['front','front_right','right','rear_right','rear','rear_left','left','front_left','cabin','odometer'];
export const inspectionActions=['inspection_load','inspection_create','inspection_photo','inspection_draft','inspection_submit','inspection_review','inspection_start'];
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const safeName=value=>String(value||'照片.jpg').replace(/[\x00-\x1f/\\]/g,'').slice(0,160)||'照片.jpg';
export function createInspectionHandler({db,adminCan,cryptoApi=globalThis.crypto}) {
 return async function(body,session) {
  const fail=(error,status=400)=>({body:{error},status});
  const admin=session.session_type==='admin',driver=session.session_type==='driver';
  if(!inspectionActions.includes(body.action))return fail('ACTION_NOT_ALLOWED',403);
  if(!driver&&!(admin&&await adminCan(session,'vehicleInspections')))return fail('沒有車輛檢查權限',403);
  if(driver&&!uuid(session.driver_id))return fail('SESSION_EXPIRED',401);
  const actor={id:admin?(session.is_super_admin?'super-admin':session.admin_user_id):session.driver_id,name:session.admin_name||'管理員',role:session.session_type};
  const bucket=db.storage.from('vehicle-inspections');
  const present=async data=>{
   if(!data?.photos)return data;
   const photos=data.photos,paths=photos.map(photo=>photo.storage_path);
   const urls=new Map();
   if(paths.length){const signed=await bucket.createSignedUrls(paths,600);if(signed.error)throw signed.error;for(const item of signed.data||[])if(item.signedUrl)urls.set(item.path,item.signedUrl);}
   return {...data,photos:photos.map(({storage_path,sha256,...photo})=>({...photo,url:urls.get(storage_path)||''}))};
  };
  const rpc=async(name,args)=>{
   const result=await db.rpc(name,args);
   if(result.error)throw result.error;
   return result.data;
  };
  try {
   if(body.action==='inspection_load') {
    if((body.task_id!=null&&!uuid(body.task_id))||(body.batch_id!=null&&!uuid(body.batch_id)))return fail('檢查編號錯誤');
    const page=body.page??1;
    if(!Number.isInteger(page)||page<1||page>10000)return fail('頁碼錯誤');
    if(!['all','pending','draft','submitted','approved','returned','cancelled','overdue','incomplete','todo'].includes(body.status||'all'))return fail('篩選狀態錯誤');
    const data=await rpc('inspection_load',{p_driver:driver?session.driver_id:null,p_batch:body.batch_id||null,p_task:body.task_id||null,p_status:body.status||'all',p_page:page,p_history:admin&&body.history===true});
    return {body:{data:await present(data)},status:200};
   }
   if(body.action==='inspection_create') {
    if(!admin)return fail('僅授權後台可發起車輛檢查',403);
    if(!uuid(body.request_id)||typeof body.title!=='string'||!body.title.trim()||body.title.trim().length>120||typeof body.instructions!=='string'||body.instructions.length>2000)return fail('請填寫有效的檢查標題與說明');
    if(!Array.isArray(body.targets)||!body.targets.length||body.targets.length>500||body.targets.some(target=>!uuid(target?.vehicle_id)||!uuid(target?.driver_id)))return fail('請勾選要檢查的車輛與目前駕駛');
    if(new Set(body.targets.map(target=>target.vehicle_id+'/'+target.driver_id)).size!==body.targets.length)return fail('同一輛車與司機不可重複勾選');
    const date=String(body.due_on||''),parsed=new Date(date+'T00:00:00Z');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)return fail('期限日期錯誤');
    const data=await rpc('inspection_create',{p_request:body.request_id,p_title:body.title.trim(),p_instructions:body.instructions,p_due:new Date(date+'T23:59:59+08:00').toISOString(),p_targets:body.targets,p_actor:actor});
    return {body:{data},status:200};
   }
   if(!uuid(body.task_id)||!Number.isSafeInteger(body.revision)||body.revision<1)return fail('檢查資料版本錯誤，請重新整理');
   if(body.action==='inspection_review') {
    if(!admin)return fail('僅授權後台可審核檢查',403);
    if(!['approved','returned','cancelled'].includes(body.status)||typeof body.reason!=='string'||body.reason.length>2000||!Array.isArray(body.slots)||body.slots.some(slot=>!inspectionSlots.includes(slot)))return fail('請確認審核狀態、說明與補拍項目');
    const data=await rpc('inspection_review',{p_task:body.task_id,p_revision:body.revision,p_status:body.status,p_reason:body.reason,p_slots:[...new Set(body.slots)],p_actor:actor});
    return {body:{data},status:200};
   }
   if(!driver)return fail('僅指定司機可拍攝與送出檢查',403);
   if(body.action==='inspection_start'){const data=await rpc('inspection_start',{p_task:body.task_id,p_driver:session.driver_id,p_revision:body.revision});return {body:{data},status:200};}
   if(body.action==='inspection_draft'||body.action==='inspection_submit') {
    if((body.odometer!==null&&(!Number.isSafeInteger(body.odometer)||body.odometer<0||body.odometer>9999999))||typeof body.notes!=='string'||body.notes.length>2000)return fail('請填寫有效的整數里程與備註');
    const data=await rpc('inspection_submit',{p_task:body.task_id,p_driver:session.driver_id,p_revision:body.revision,p_odometer:body.odometer,p_notes:body.notes,p_submit:body.action==='inspection_submit'});
    return {body:{data},status:200};
   }
   if(!uuid(body.request_id)||!inspectionSlots.includes(body.slot)||typeof body.base64!=='string'||body.base64.length>2796204)return fail('請使用壓縮後 2 MB 以內的指定角度照片');
   const task=await db.from('vehicle_inspection_tasks').select('*').eq('id',body.task_id).maybeSingle();
   if(task.error)throw task.error;
   if(!task.data||!(task.data.eligible_driver_ids||[task.data.driver_id]).includes(session.driver_id))return fail('找不到本人的車輛檢查',404);
   if(task.data.claimed_by&&task.data.claimed_by!==session.driver_id)return fail('同車司機已開始執行此檢查，無需重複拍攝',409);
   let bytes;try{bytes=Uint8Array.from(atob(body.base64),char=>char.charCodeAt(0));}catch{return fail('照片內容無效');}
   const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
   const png=[137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value);
   if(!bytes.length||bytes.length>2097152||!jpeg&&!png)return fail('請使用有效 JPG 或 PNG 照片');
   const digest=Array.from(new Uint8Array(await cryptoApi.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');
   const existing=await db.from('vehicle_inspection_photos').select('*').eq('id',body.request_id).maybeSingle();
   if(existing.error)throw existing.error;
   if(existing.data) {
    if(existing.data.task_id!==body.task_id||existing.data.slot!==body.slot||existing.data.sha256!==digest)return fail('照片識別碼已使用');
    return {body:{data:{task:task.data,duplicate:true}},status:200};
   }
   if(Number(task.data.revision)!==body.revision)return fail('檢查資料已更新，請重新整理',409);
   if(!['pending','draft','returned'].includes(task.data.status))return fail('此檢查已送出或鎖定',409);
   const path=body.task_id+'/'+body.request_id+(jpeg?'.jpg':'.png'),mime=jpeg?'image/jpeg':'image/png';
   const uploaded=await bucket.upload(path,bytes,{contentType:mime,cacheControl:"600",upsert:false});if(uploaded.error)throw uploaded.error;
   let data;
   try {
    data=await rpc('inspection_save_photo',{p_task:body.task_id,p_driver:session.driver_id,p_revision:body.revision,p_photo:{id:body.request_id,slot:body.slot,storage_path:path,name:safeName(body.name),mime,size:bytes.length,sha256:digest}});
   } catch(error) {
    // A lost response can follow a committed write: never delete a possibly saved photo.
    const check=await db.from('vehicle_inspection_photos').select('storage_path').eq('id',body.request_id).maybeSingle();
    if(!check.error&&(!check.data||check.data.storage_path!==path))await bucket.remove([path]);
    throw error;
   }
   const signed=await bucket.createSignedUrls([data.photo.storage_path],600);
   if(signed.error)throw signed.error;
   const {storage_path,sha256,...photo}=data.photo;
   return {body:{data:{task:data.task,photo:{...photo,url:signed.data?.[0]?.signedUrl||''}}},status:200};
  } catch(error) {
   if(['42P01','42883','PGRST202'].includes(error.code))return fail('車輛檢查尚未完成資料庫安裝',503);
   return fail(error.message||'車輛檢查處理失敗，請重新整理',/找不到本人/.test(error.message||'')?404:409);
  }
 };
}
