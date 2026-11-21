export function createStaffManagementHandler({db,hashCode,normalizeLoginCode}){
 const fail=(error,status=400)=>({body:{error},status});
 const uuid=value=>typeof value==='string'&&/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
 const permissionsValid=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length<=150&&Object.entries(value).every(([key,val])=>/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/.test(key)&&typeof val==='boolean'&&!['super','all','adminUsers','is_super_admin'].includes(key));
 return async(body,session)=>{
  if(session.session_type!=='admin'||session.is_super_admin!==true)return fail('ADMIN_PERMISSION_DENIED',403);
  const actor={id:session.admin_user_id||'super-admin',name:session.admin_name||session.name||'最高管理員'},record=body.record;
  if(!record||Array.isArray(record)||typeof record!=='object')return fail('資料格式錯誤');
  try{
   let result;
   if(['department_save','department_delete','title_save','title_delete'].includes(body.action)){
    const deleting=body.action.endsWith('_delete');
    if(record.id&&!uuid(record.id)||record.id&&(!Number.isInteger(record.revision)||record.revision<1)||deleting&&!uuid(record.id))return fail('請重新整理部門資料',409);
    const safe={id:record.id||null,revision:record.revision};
    if(!deleting){if(typeof record.name!=='string'||!record.name.trim()||record.name.trim().length>100)return fail('名稱請填寫 1 至 100 個字');safe.name=record.name.trim();
     if(body.action==='department_save'){if(!permissionsValid(record.permissions))return fail('部門權限格式錯誤');safe.permissions=record.permissions;}
     else{if(!uuid(record.department_id))return fail('請選擇部門');safe.department_id=record.department_id;}
    }
    result=await db.rpc('staff_structure_action',{p_action:body.action,p_record:safe,p_actor:actor});
   }else{
    if(!['insert','update'].includes(body.action)||body.table!=='admin_users')return fail('不支援的員工操作');
    const safe=Object.fromEntries(['name','active','permissions','avatar_url','avatar_name','department_id','job_title_id','permission_mode'].filter(key=>Object.hasOwn(record,key)).map(key=>[key,record[key]]));
    if(Object.hasOwn(safe,'name')&&(typeof safe.name!=='string'||!safe.name.trim()||safe.name.length>100))return fail('請填寫姓名');
    if(Object.hasOwn(safe,'active')&&typeof safe.active!=='boolean'||Object.hasOwn(safe,'permissions')&&!permissionsValid(safe.permissions))return fail('員工權限格式錯誤');
    if(Object.hasOwn(safe,'permission_mode')&&!['personal','department'].includes(safe.permission_mode))return fail('權限來源錯誤');
    for(const key of ['department_id','job_title_id'])if(safe[key]&&!uuid(safe[key]))return fail('請重新選擇部門與職稱');
    for(const key of ['avatar_url','avatar_name'])if(safe[key]!=null&&(typeof safe[key]!=='string'||safe[key].length>(key==='avatar_url'?1000000:200)))return fail('頭像資料格式錯誤');
    if(body.action==='insert'&&(!safe.name||!record.login_code))return fail('請填寫姓名與登入代碼');
    if(record.login_code){safe.extension=normalizeLoginCode(record.login_code);if(!safe.extension||safe.extension==='0000'||safe.extension.length>64)return fail('請使用有效的登入代碼');safe.login_code_hash=await hashCode(record.login_code);}
    if(body.action==='update'&&(!uuid(body.id)||!Object.hasOwn(body,'staff_expected_updated_at')||(body.staff_expected_updated_at!==null&&(typeof body.staff_expected_updated_at!=='string'||!Number.isFinite(Date.parse(body.staff_expected_updated_at))))))return fail('請重新開啟員工編輯後儲存',409);
    result=await db.rpc('staff_employee_save',{p_id:body.action==='update'?body.id:null,p_record:safe,p_expected:body.staff_expected_updated_at||null,p_actor:actor});
   }
   if(result.error)throw result.error;return {body:{data:result.data},status:200};
  }catch(error){const message=String(error.message||error);if(error.code==='23505')return fail('名稱或登入代碼已使用，請確認後再儲存',409);return fail(message,/已更新/.test(message)?409:400);}
 };
}
