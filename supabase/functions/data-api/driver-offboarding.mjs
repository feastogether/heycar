export const offboardingActions=['offboarding_list','offboarding_directory','offboarding_detail','offboarding_write','offboarding_photos'];
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
export function createOffboardingHandler({db,adminCan,media=null}){return async(body,session)=>{
 const fail=(error,status=400)=>({body:{error},status});
 if(session.session_type!=='admin'||!await adminCan(session,'driverOffboarding'))return fail('沒有下線管理權限',403);
 const actor={id:session.is_super_admin?'super-admin':session.admin_user_id,name:session.admin_name||(session.is_super_admin?'最高管理員':'管理員'),role:'admin'};
 try{
  let name,args;
  if(body.action==='offboarding_directory'){name='offboarding_directory';args={};}
  else if(body.action==='offboarding_list'){if(!Number.isInteger(body.page??1)||(body.page??1)<1||(body.page??1)>10000||typeof(body.search??'')!=='string'||String(body.search||'').length>100||!['','draft','approved','closed','cancelled'].includes(body.status||''))return fail('查詢格式錯誤');name='offboarding_read';args={p_case:null,p_page:body.page??1,p_search:body.search||'',p_status:body.status||''};}
  else if(body.action==='offboarding_detail'){if(!uuid(body.id))return fail('案件編號錯誤');name='offboarding_read';args={p_case:body.id};}
  else if(body.action==='offboarding_write'){
   if(!['create','save','check','approve','review','close','cancel'].includes(body.operation)||!body.data||typeof body.data!=='object'||Array.isArray(body.data)||JSON.stringify(body.data).length>30000)return fail('退隊操作格式錯誤');
   if(body.operation!=='create'&&(!uuid(body.id)||!Number.isInteger(body.revision)||body.revision<1))return fail('請重新整理案件');
   if(['approve','review','close','cancel'].includes(body.operation)&&!await adminCan(session,'driverOffboardingApprove'))return fail('沒有車輛部退隊核准／結案權限',403);
   if(['approve','review','close','cancel'].includes(body.operation)&&body.confirmed!==true)return fail('請確認此操作');
   if(body.operation==='create'&&(!uuid(body.data.request_id)||!uuid(body.data.driver_id)||!/^\d{4}-\d{2}-\d{2}$/.test(body.data.leave_on||'')||!Number.isFinite(Date.parse(body.data.leave_on))||new Date(body.data.leave_on).toISOString().slice(0,10)!==body.data.leave_on))return fail('請選擇司機與有效離職日');
   name='offboarding_write';args={p_operation:body.operation,p_case:body.id||null,p_revision:body.revision||0,p_data:body.data,p_actor:actor};
  }else if(body.action==='offboarding_photos'){
   if(!uuid(body.id))return fail('案件編號錯誤');const links=await db.from('driver_offboarding_vehicles').select('task_id,snapshot').eq('case_id',body.id);if(links.error)throw links.error;
   const ids=(links.data||[]).map(l=>l.task_id);if(!ids.length)return {body:{photos:[]},status:200};
   const result=await db.from('vehicle_inspection_photos').select('id,task_id,slot,storage_path,name,damage_description,uploaded_at').in('task_id',ids).eq('is_current',true).is('purged_at',null).order('task_id').order('slot');if(result.error)throw result.error;
   const bucket=media?.bucket('vehicle-inspections')||db.storage.from('vehicle-inspections'),photos=result.data||[],urls=new Map();
   for(let i=0;i<photos.length;i+=50){const chunk=photos.slice(i,i+50);const signed=await bucket.createSignedUrls(chunk.map(p=>p.storage_path),600);if(signed.error)throw signed.error;for(const p of signed.data||[])urls.set(p.path,p.signedUrl||'');}
   return {body:{photos:photos.map(({storage_path,...p})=>({...p,plate_no:links.data.find(l=>l.task_id===p.task_id)?.snapshot?.plate_no||'',url:urls.get(storage_path)||''}))},status:200};
  }else return fail('ACTION_NOT_ALLOWED',403);
  const result=await db.rpc(name,args);if(result.error)return fail(result.error.code==='23505'?'此司機已有處理中退隊案件':result.error.message,result.error.code==='23505'?409:/已更新|指派.*異動|仍有其他有效配車/.test(result.error.message)?409:400);
  return {body:{data:result.data},status:200};
 }catch(error){return fail(error.message||'退隊操作失敗',400);}
};}
