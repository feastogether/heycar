const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const benefitActions=['points_load','points_award','reward_save','points_redeem','redemption_process','equipment_load','equipment_save','equipment_borrow','equipment_return','operation_photo','operation_photo_ticket','operation_photos','operation_storage'];
export function createBenefitsHandler({db,adminCan,cryptoApi=globalThis.crypto,media=null}){
 return async(body,session)=>{
  const fail=(error,status=400)=>({body:{error},status}),isAdmin=session.session_type==='admin',driver=session.session_type==='driver'?session.driver_id:null;
  if(!benefitActions.includes(body.action)||!isAdmin&&!uuid(driver))return fail('沒有功能權限',403);
  const points=/^(points_|reward_|redemption_)/.test(body.action),permission=points?'heyPoints':body.action==='operation_storage'?'storage':body.action==='operation_photos'?'maintenanceNotifications':'equipmentManagement';
  if(isAdmin&&body.action!=='operation_photos'&&!await adminCan(session,permission))return fail('沒有管理權限',403);
  const actor={role:session.session_type,id:driver||(session.is_super_admin?'super-admin':session.admin_user_id),name:session.admin_name||'司機'};
  const rpc=async(name,args)=>{const result=await db.rpc(name,args);if(result.error)throw result.error;return result.data;};
  const sign=async rows=>{for(const bucketName of new Set(rows.map(row=>row.bucket||'driver-operations'))){const group=rows.filter(row=>(row.bucket||'driver-operations')===bucketName);for(let i=0;i<group.length;i+=100){const chunk=group.slice(i,i+100),result=await (media?.bucket(bucketName)||db.storage.from(bucketName)).createSignedUrls(chunk.map(row=>row.storage_path||row.path),600);if(result.error)throw result.error;chunk.forEach((row,j)=>row.url=result.data[j]?.signedUrl||'');}}return rows;};
  try{
   if(body.action==='operation_storage'){
    if(!isAdmin)return fail('沒有儲存空間權限',403);
    return {body:{files:await sign(await rpc('hey_storage_photos',{}))},status:200};
   }
   if(body.action==='operation_photos'){
    if(!uuid(body.reference_id))return fail('照片關聯編號錯誤');
    if(isAdmin&&!await adminCan(session,'maintenanceNotifications')&&!await adminCan(session,'equipmentManagement'))return fail('沒有查看照片權限',403);
    const rows=await rpc('hey_photo_list',{p_reference:body.reference_id,p_driver:driver,p_admin:isAdmin});
    for(const row of rows)if(isAdmin&&!await adminCan(session,row.purpose==='service'?'maintenanceNotifications':'equipmentManagement'))return fail('沒有查看此類照片權限',403);
    return {body:{photos:await sign(rows)},status:200};
   }
   if(body.action==='operation_photo'||body.action==='operation_photo_ticket'){
    if(!driver)return fail('僅司機可上傳作業照片',403);
    if(!uuid(body.request_id)||!uuid(body.reference_id)||!['service','equipment_borrow','equipment_return'].includes(body.purpose)||typeof body.slot!=='string'||(!body.receipt&&body.action!=='operation_photo_ticket'&&(typeof body.base64!=='string'||body.base64.length>2796204)))return fail('照片用途或內容錯誤');
    const expected={bucket:'driver-operations',driver_id:driver,request_id:body.request_id,reference_id:body.reference_id,purpose:body.purpose,slot:body.slot};
    if(body.action==='operation_photo_ticket'){
     if(!media)return fail('照片直傳服務尚未啟用',503);
     await rpc('hey_photo_preflight',{p_driver:driver,p_purpose:body.purpose,p_reference:body.reference_id,p_slot:body.slot});
     return {body:await media.issue({...expected,path:driver+'/'+body.request_id+'.jpg'}),status:200};
    }
    const receipt=body.receipt?await media?.receipt(body.receipt,expected):null;if(body.receipt&&!receipt)return fail('照片直傳憑證無效',403);
    let bytes;try{bytes=receipt?new Uint8Array():Uint8Array.from(atob(body.base64),c=>c.charCodeAt(0));}catch{return fail('照片編碼錯誤');}
    const jpeg=receipt?receipt.mime==='image/jpeg':bytes[0]===255&&bytes[1]===216&&bytes[2]===255,png=[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);
    if(!receipt&&(!bytes.length||bytes.length>2097152||!jpeg&&!png))return fail('請上傳壓縮後2 MB以內的有效照片');
    const sha=receipt?.sha||Array.from(new Uint8Array(await cryptoApi.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join(''),logicalPath=driver+'/'+body.request_id+(jpeg?'.jpg':'.png'),path=media?media.pathFor('driver-operations',logicalPath):logicalPath,bucket=media?.bucket('driver-operations')||db.storage.from('driver-operations');
    if(receipt&&receipt.path!==logicalPath)return fail('照片路徑錯誤',403);
    // Ownership is checked by SQL. A failed attempt only removes its own uncommitted object.
    const existing=await db.from('hey_operation_photos').select('*').eq('id',body.request_id).maybeSingle();if(existing.error)throw existing.error;
    if(existing.data){if(existing.data.driver_id!==driver||existing.data.sha256!==sha||existing.data.reference_id!==body.reference_id||existing.data.purpose!==body.purpose||existing.data.slot!==body.slot)return fail('照片識別碼已使用',409);return {body:{photo:(await sign([existing.data]))[0]},status:200};}
    if(!receipt){const uploaded=await bucket.upload(logicalPath,bytes,{contentType:jpeg?'image/jpeg':'image/png',upsert:false});if(uploaded.error)throw uploaded.error;}
    let photo;
    try{photo=await rpc('hey_record_photo',{p_id:body.request_id,p_driver:driver,p_purpose:body.purpose,p_reference:body.reference_id,p_slot:body.slot,p_path:path,p_mime:jpeg?'image/jpeg':'image/png',p_size:receipt?.size||bytes.length,p_sha:sha});}
    catch(error){const check=await db.from('hey_operation_photos').select('storage_path').eq('id',body.request_id).maybeSingle();if(!check.error&&!check.data)await bucket.remove([path]);throw error;}
    return {body:{photo:(await sign([photo]))[0]},status:200};
   }
   const data=body.record||{};
   if(typeof data!=='object'||Array.isArray(data)||JSON.stringify(data).length>6000)return fail('操作資料錯誤');
   if(!['points_load','equipment_load'].includes(body.action)&&body.confirmed!==true)return fail('請先確認操作');
   const result=await rpc('hey_operations',{p_action:body.action,p_data:data,p_driver:driver,p_actor:actor,p_admin:isAdmin});
   return {body:{data:result},status:200};
  }catch(error){return fail(error.message||'作業處理失敗',/權限|本人|僅司機/.test(error.message||'')?403:/42P01|42883|PGRST202/.test(error.code||'')?503:409);}
 };
}
