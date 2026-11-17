export function createLoanActionHandler({db}) {
 return async (body,session)=>{
  const fail=(error,status=400)=>({body:{error},status});
  if(session.session_type!=='admin')return fail('沒有車輛租借操作權限',403);
  if(!['approve','return','close'].includes(body.operation))return fail('不支援的租借操作');
  if(!session.is_super_admin&&body.operation!=='return')return fail('僅最高管理員可核准或結案',403);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id||''))return fail('租借編號錯誤');
  if(body.expected_updated_at!==null&&!Number.isFinite(Date.parse(body.expected_updated_at)))return fail('請重新整理租借紀錄',409);
  if(body.operation==='return'&&!Number.isFinite(Date.parse(body.actual_return_at)))return fail('請填寫實際還車時間');
  const result=await db.rpc('apply_vehicle_loan_action',{
   p_id:body.id,p_action:body.operation,p_expected:body.expected_updated_at,
   p_returned:body.operation==='return'?body.actual_return_at:null,
   p_actor:{id:session.admin_user_id||'super-admin',name:session.admin_name||'最高管理員'},p_super:session.is_super_admin===true
  });
  if(result.error){const message=result.error.message||'租借更新失敗';return fail(/PGRST202|42883|42P01/.test(result.error.code||'')?'本機尚未完成租借流程更新':message,/權限/.test(message)?403:/更新|狀態/.test(message)?409:400);}
  return {status:200,body:{data:result.data}};
 };
}
