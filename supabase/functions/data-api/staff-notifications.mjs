export const notificationCatalog=[
 ['license','駕照審驗到期','drivers','drivers','審驗日30天內到期或已逾期；不含已離職'],
 ['inspection','驗車到期','vehicles','vehicles','下次定檢日30天內到期或已逾期；不含報廢／出售'],
 ['assignment','待配對車輛','drivers','drivers','待上線但目前沒有有效配車的司機'],
 ['meals','今日訂購便當','mealOrdering',null,'截止日期在今天的訂餐團；不含取消'],
 ['reporting','司機報班待審核','driverReporting','driverReporting','符合報班資格且待審核的司機人數'],
 ['equipment','安椅借用未歸還','equipmentManagement','equipmentManagement','安全座椅／增高墊已借出未歸還數量'],
 ['feedback','意見反饋待回覆','feedbacks','feedbacks','尚無回覆內容的反饋數量'],
 ['loans','車輛借用中','vehicleLoans','vehicleLoans','目前核准借出且尚未回報歸還的車輛數'],
 ['workorders','車輛履歷待工單','serviceRecords','serviceRecords','司機完成保養／維修／調胎，尚未登打工單的台次'],
 ['renewal','保險待續保','insuranceCenter','insuranceCenter','60天內到期或已逾期，且相應保險尚無進行中報價的車輛數']
].map(([key,title,view,permission,rule])=>({key,title,view,permission,rule}));
export const notificationActions=['staff_notifications_load','staff_notifications_save','staff_notifications'];
export function createNotificationHandler({db,adminCan}){return async(body,session)=>{
 const fail=(error,status=400)=>({body:{error},status});
 if(session.session_type!=='admin')return fail('ADMIN_PERMISSION_DENIED',403);
 const root=session.is_super_admin===true;
 if(body.action==='staff_notifications_load'||body.action==='staff_notifications_save'){
  if(!root)return fail('僅最高管理員可管理通知對象',403);
  if(body.action==='staff_notifications_load'){const r=await db.from('staff_notification_settings').select('staff_id,enabled_keys,revision,updated_at');if(r.error)throw r.error;return {body:{settings:r.data||[],catalog:notificationCatalog},status:200};}
  const r=body.record;if(!r||!/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(r.staff_id||'')||!Array.isArray(r.enabled_keys)||r.enabled_keys.length>10||new Set(r.enabled_keys).size!==r.enabled_keys.length||r.enabled_keys.some(k=>!notificationCatalog.some(c=>c.key===k))||!Number.isInteger(r.revision)||r.revision<0)return fail('通知設定格式錯誤');
  const result=await db.rpc('staff_notifications_save',{p_staff:r.staff_id,p_keys:r.enabled_keys,p_expected:r.revision,p_actor:{id:session.admin_user_id||'super-admin',name:session.admin_name||'最高管理員'}});if(result.error)return fail(result.error.message,/已更新/.test(result.error.message)?409:400);return {body:{data:result.data},status:200};
 }
 if(body.action!=='staff_notifications')return null;
 let keys=notificationCatalog.map(c=>c.key);
 if(!root){const active=await db.from('admin_users').select('active').eq('id',session.admin_user_id).maybeSingle();if(active.error)throw active.error;if(!active.data?.active)return fail('員工帳號未啟用',403);const config=await db.from('staff_notification_settings').select('enabled_keys').eq('staff_id',session.admin_user_id).maybeSingle();if(config.error)throw config.error;keys=config.data?.enabled_keys||[];}
 const catalog=[];for(const item of notificationCatalog)if(keys.includes(item.key)&&(!item.permission||await adminCan(session,item.permission)))catalog.push(item);
 if(!catalog.length)return {body:{groups:[],checked_at:new Date().toISOString()},status:200};
 const result=await db.rpc('staff_notifications_summary',{p_keys:catalog.map(c=>c.key)});if(result.error)throw result.error;
 return {body:{groups:catalog.map(c=>({...c,...(result.data?.groups||[]).find(g=>g.key===c.key),count:Number(result.data?.groups?.find(g=>g.key===c.key)?.count||0)})),checked_at:result.data?.checked_at},status:200};
};}
