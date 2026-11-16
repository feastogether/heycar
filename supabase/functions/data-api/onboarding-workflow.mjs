export const onboardingStatuses=['跑趟中','停派中','待上線','已離職','留停中','其他'];
const fields=['files_confirmed_at','training_at','online_confirmed_at','satellite_dog_notified_at','vehicle_confirmed_at','vehicle_plate','delivery_at','responsible_user_id','responsible_name','notes'];
function progressObject(value) {
  if(typeof value==='string'){try{return progressObject(JSON.parse(value));}catch{return {};}}
  return value&&typeof value==='object'&&!Array.isArray(value)?value:{};
}
export function createOnboardingHandler({db,adminCan,now=()=>new Date()}) {
  return async function(body,session) {
    const fail=(error,status=400)=>({body:{error},status});
    if(session.session_type!=='admin'||!await adminCan(session,'driverOnboarding'))return fail('沒有上線管理權限',403);
    if(!['save_driver_onboarding','complete_driver_onboarding'].includes(body.action))return fail('ACTION_NOT_ALLOWED',403);
    const complete=body.action==='complete_driver_onboarding';
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(body.id||'')))return fail('司機編號錯誤');
    if(!Object.hasOwn(body,'expected_updated_at'))return fail('請重新整理司機資料再操作',409);
    if(complete&&!onboardingStatuses.includes(body.status))return fail('請選擇有效的結案後司機狀態');
    const {data:current,error:readError}=await db.from('drivers').select('*').eq('id',body.id).maybeSingle();
    if(readError)return fail(readError.message);
    if(!current)return fail('找不到司機',404);
    if((current.updated_at??null)!==(body.expected_updated_at??null))return fail('司機資料已更新，請重新整理後再操作',409);
    const original=progressObject(current.onboarding_progress),closed=Boolean(current.onboarding_completed_at||original.completed_at);
    if(complete&&closed)return fail('此上線案件已結案，請重新整理',409);
    const incoming=progressObject(body.progress),progress={...original};
    for(const key of fields)if(Object.hasOwn(incoming,key)) {
      if(typeof incoming[key]!=='string'||incoming[key].length>(key==='notes'?5000:300))return fail('上線進度欄位格式錯誤');
      progress[key]=incoming[key];
    }
    if(!complete&&!closed&&incoming.completed_at)return fail('結案時請先選擇司機狀態');
    const instant=now();
    const version=new Date(Math.max(instant.getTime(),Date.parse(current.updated_at || '')||0)+1).toISOString();
    const patch={onboarding_progress:progress,updated_at:version};
    if(complete) {
      const date=String(body.completed_on||new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(instant));
      const parsed=new Date(date+'T00:00:00Z');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)return fail('結案日期格式錯誤');
      progress.completed_at=date;progress.completion_driver_status=body.status;
      progress.completed_by={id:session.is_super_admin?'super-admin':session.admin_user_id,name:session.admin_name||'管理員'};
      progress.closed_at=instant.toISOString();
      patch.onboarding_completed_at=new Date(date+'T00:00:00+08:00').toISOString();patch.driver_status=body.status;
    }
    let query=db.from('drivers').update(patch).eq('id',current.id);
    query=current.updated_at==null?query.is('updated_at',null):query.eq('updated_at',current.updated_at);
    const {data,error}=await query.select('*').maybeSingle();
    if(error)return fail(error.message);
    if(!data)return fail('司機資料已更新，請重新整理後再操作',409);
    return {body:{data},status:200};
  };
}
