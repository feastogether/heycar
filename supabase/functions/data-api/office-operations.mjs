export const officeActions=['meal_directory','meal_shop','meal_round','meal_shop_save','meal_round_create','meal_entry_save','meal_entry_cancel','meal_round_close','meal_round_cancel','navigation_load','navigation_save'];
export const navigationKeys=['home','insurancePartners','heyPoints','equipmentManagement','drivers','driverOnboarding','hiringManagement','driverHelperArticles','feedbacks','boardManagement','dispatchCenter','driverReporting','driverRoster','vehicleLoans','announcements','personalMessages','payments','marquee','loginSlogans','vehicleTypes','vehicles','vehicleInspections','maintenanceManagement','idleManagement','fleetCases','serviceRecords','insuranceCenter','emergencyEvents','adminUsers','loginHistory','mailManagement','bom','storage','trafficMonitor','satelliteMonitor','mealOrdering','navigationManagement'];
export function validNavigation(config){
 if(!config||typeof config!=='object'||Array.isArray(config)||!Array.isArray(config.groups)||config.groups.length<1||config.groups.length>20)return false;
 const used=[],groups=new Set();for(const g of config.groups){if(!g||typeof g.id!=='string'||! /^[a-zA-Z0-9_-]{1,80}$/.test(g.id)||groups.has(g.id)||typeof g.title!=='string'||!g.title.trim()||g.title.length>30||!Array.isArray(g.keys)||g.keys.length>50)return false;groups.add(g.id);used.push(...g.keys);}
 if(used.length!==navigationKeys.length||new Set(used).size!==used.length||used.some(k=>!navigationKeys.includes(k)))return false;
 const labels=config.labels||{};return typeof labels==='object'&&!Array.isArray(labels)&&Object.entries(labels).every(([k,v])=>navigationKeys.includes(k)&&typeof v==='string'&&v.trim()&&v.length<=30);
}
export function createOfficeHandler({db}){return async(body,session)=>{
 const fail=(error,status=400)=>({body:{error},status}),uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
 if(session.session_type!=='admin')return fail('僅內部員工可使用',403);
 let actor={id:'super-admin',name:session.admin_name||'最高管理員',super:true};
 if(!session.is_super_admin){const{data,error}=await db.from('admin_users').select('id,name,active').eq('id',session.admin_user_id).maybeSingle();if(error)return fail('無法驗證員工身分',503);if(!data?.active)return fail('員工帳號未啟用',403);actor={id:data.id,name:data.name,super:false};}
 let rpc,args;
 if(body.action==='navigation_load'){rpc='office_navigation_read';args={};}
 else if(body.action==='navigation_save'){
  if(!actor.super)return fail('僅最高管理員可設定全公司選單',403);
  if(JSON.stringify(body.config||{}).length>30000||!validNavigation(body.config)||!Number.isInteger(body.revision)||body.revision<0)return fail('請確認選單分組、名稱與排序，每個功能須保留一次');
  rpc='office_navigation_save';args={p_config:body.config,p_revision:body.revision,p_actor:actor};
 }else if(body.action==='meal_shop'){if(!uuid(body.id))return fail('請選擇店家');rpc='office_meal_shop';args={p_id:body.id};}
 else if(body.action==='meal_directory'||body.action==='meal_round'){
  if(body.action==='meal_round'&&!uuid(body.id))return fail('請選擇訂購團');rpc='office_meal_read';args={p_round:body.action==='meal_round'?body.id:null};
 }else{
  if(!uuid(body.request_id)||!body.record||typeof body.record!=='object'||Array.isArray(body.record))return fail('缺少操作編號或資料');
  const action=String(body.action).replace(/^meal_/,''),keys={shop_save:['id','revision','name','phone','address','menu','source_url','price_note'],round_create:['id','shop_id','shop_revision','title','deadline','note'],entry_save:['round_id','revision','items','note'],entry_cancel:['round_id','revision'],round_close:['round_id','revision'],round_cancel:['round_id','revision']}[action];if(!keys)return fail('ACTION_NOT_ALLOWED');
  const record=Object.fromEntries(keys.filter(k=>Object.hasOwn(body.record,k)).map(k=>[k,body.record[k]]));
  if(JSON.stringify(record).length>150000||!uuid(record.id||record.round_id)||record.shop_id&&!uuid(record.shop_id))return fail('欄位格式或資料大小錯誤');
  if(action==='shop_save'&&(!Array.isArray(record.menu)||record.menu.some(p=>!p||typeof p.id!=='string'||typeof p.name!=='string'||!Number.isInteger(p.price_cents)||p.price_cents<0||p.price_cents>1000000||p.unit!==undefined&&typeof p.unit!=='string'||p.category!==undefined&&typeof p.category!=='string')))return fail('請確認餐點名稱、價格及單位');
  if(action==='shop_save'&&record.source_url&&!/^https:\/\/[^\s]+$/i.test(record.source_url))return fail('來源連結須為 HTTPS');
  if(action==='round_create'&&body.price_confirmed!==true)return fail('請先確認本次門市價格');
  if(['round_close','round_cancel','entry_cancel'].includes(action)&&body.confirmed!==true)return fail('請確認此操作');
  rpc='office_meal_write';args={p_action:action,p_body:record,p_actor:actor,p_request:body.request_id};
 }
 const{data,error}=await db.rpc(rpc,args);return error?fail(error.message,['42883','42P01','PGRST202'].includes(error.code)?503:409):{body:{data,actor},status:200};
};}
