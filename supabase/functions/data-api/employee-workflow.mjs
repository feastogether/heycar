export function profileIdentity(session) {
  const type=session.session_type;
  const id=type==='admin'?(session.is_super_admin?'super-admin':session.admin_user_id):type==='driver'?session.driver_id:type==='partner'?session.partner_id:null;
  return id?{actor_type:type,actor_id:String(id)}:null;
}
export function validAvatar(value) {
  if(typeof value!=='string'||value.length>180000) return false;
  if(value==='') return true;
  const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if(!match) return false;
  try {
    const bytes=atob(match[2]);
    return match[1]==='png'?bytes.startsWith('\x89PNG\r\n\x1a\n'):match[1]==='jpeg'?bytes.startsWith('\xff\xd8\xff'):bytes.startsWith('RIFF')&&bytes.slice(8,12)==='WEBP';
  } catch {return false;}
}
export function createEmployeeWorkflowHandler({db,adminCan}) {
  return async function(body,session) {
    const fail=(message,status=400)=>({body:{error:message},status});
    const actor=profileIdentity(session);
    if(!actor) return fail('SESSION_EXPIRED',401);
    if(body.action==='load_avatar_profiles'||body.action==='save_own_avatar') {
      if(body.action==='save_own_avatar') {
        if(session.session_type==='driver')return fail('司機頭像由管理後台設定',403);
        if(!validAvatar(body.avatar_url))return fail('請選擇有效照片，壓縮後須小於 135 KB');
        const {error}=await db.from('avatar_profiles').upsert({...actor,avatar_url:body.avatar_url,updated_at:new Date().toISOString()},{onConflict:'actor_type,actor_id'});
        if(error)return fail(error.message);
      }
      let query=db.from('avatar_profiles').select('*').eq('actor_type',actor.actor_type);
      if(actor.actor_type!=='admin')query=query.eq('actor_id',actor.actor_id);
      const {data,error}=await query;
      return error?fail(error.message):{body:{profiles:data||[]},status:200};
    }
    const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value||''));
    if(body.action==='cancel_service_schedule') {
      if(session.session_type!=='admin'||!await adminCan(session,'calendar'))return fail('沒有安排保養權限',403);
      if(!uuid(body.id)||typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>500||!body.expected_updated_at||!Number.isFinite(Date.parse(body.expected_updated_at)))return fail('請確認排程與取消原因');
      const {data,error}=await db.rpc('cancel_vehicle_service_schedule',{p_id:body.id,p_expected:body.expected_updated_at,p_reason:body.reason.trim(),p_actor:actor});
      return error?fail(error.message,409):{body:data,status:200};
    }
    if(body.action==='save_service_schedule') {
      if(session.session_type!=='admin'||!await adminCan(session,'calendar'))return fail('沒有安排保養權限',403);
      if(body.id!=null&&!uuid(body.id))return fail('排程編號錯誤');
      const allowed=['event_date','event_time','event_type','fleet_name','vehicle_id','plate_no','driver_id','vendor','content'];
      const record=Object.fromEntries(Object.entries(body.record||{}).filter(([key])=>allowed.includes(key)));
      const {data,error}=await db.rpc('save_vehicle_service_schedule',{p_id:body.id||null,p_record:record,p_expected:body.expected_updated_at||null});
      return error?fail(error.message,409):{body:data,status:200};
    }
    if(!uuid(body.id))return fail('排程／通知編號錯誤');
    let name,args;
    if(body.action==='sync_service_schedule') {
      if(session.session_type!=='admin'||!await adminCan(session,'calendar'))return fail('沒有安排保養權限',403);
      name='sync_vehicle_service_schedule';args={p_id:body.id};
    } else if(body.action==='complete_service_schedule') {
      if(session.session_type!=='driver')return fail('僅通知的司機可回報完成',403);
      if(typeof body.odometer!=='number'||!Number.isFinite(body.odometer)||body.odometer<0)return fail('請輸入有效的完成里程');
      if(!Array.isArray(body.photos)||body.photos.length!==(body.work_order_missing===true?5:6)||body.photos.some(id=>!uuid(id)))return fail('請完成四顆輪胎、儀表里程照片及工單（或註記尚未有工單）');
      if(body.work_order_missing!==undefined&&typeof body.work_order_missing!=='boolean')return fail('請確認工單選項');name='hey_complete_service_with_order';args={p_id:body.id,p_driver:session.driver_id,p_odometer:body.odometer,p_photos:body.photos,p_missing:body.work_order_missing===true};
    } else return fail('ACTION_NOT_ALLOWED',403);
    const {data,error}=await db.rpc(name,args);
    return error?fail(error.message,409):{body:data,status:200};
  };
}
