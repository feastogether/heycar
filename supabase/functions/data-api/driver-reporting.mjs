export const reportingActions = ['load_driver_reporting','save_driver_reporting_month','submit_driver_reporting','review_driver_reporting','admin_edit_driver_reporting'];

export function createDriverReportingHandler({ db, adminCan }) {
  return async function handle(body, session) {
    const fail = (error, status = 400) => ({ body: { error }, status });
    const driver = session.session_type === 'driver';
    if (!reportingActions.includes(body.action)) return fail('ACTION_NOT_ALLOWED');
    if (!driver && (session.session_type !== 'admin' || !await adminCan(session, 'driverReporting'))) {
      return fail('沒有司機報班管理權限', 403);
    }
    if (driver && !['load_driver_reporting','submit_driver_reporting'].includes(body.action)) return fail('沒有管理權限',403);
    if (!driver && body.action === 'submit_driver_reporting') return fail('請由司機本人送出報班',403);
    const month = String(body.month || '');
    if (!['review_driver_reporting','admin_edit_driver_reporting'].includes(body.action) && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail('請選擇有效月份');
    const actor = { role: 'admin', id: session.admin_user_id || 'super-admin', name: session.admin_name || '最高管理員' };
    let rpc, args;
    if (body.action === 'load_driver_reporting') {
      rpc = 'driver_reporting_load'; args = { p_month: month + '-01', p_driver: driver ? session.driver_id : null };
    } else if (body.action === 'save_driver_reporting_month') {
      const c = body.config || {};
      if (typeof c.is_open !== 'boolean' || !Number.isInteger(c.allowed_days) || c.allowed_days < 0 || c.allowed_days > 31 ||
          !Array.isArray(c.blocked_dates) || !Number.isInteger(body.revision) || body.revision < 0) return fail('月份設定格式錯誤');
      if(c.range_rules!==undefined&&(!Array.isArray(c.range_rules)||c.range_rules.length>20))return fail('條件限休最多設定20組');
      rpc = 'driver_reporting_save_month';
      args = { p_month: month + '-01', p_config: { is_open: c.is_open, opens_on: c.opens_on, closes_on: c.closes_on,
        allowed_days: c.allowed_days, blocked_dates: c.blocked_dates, ...(c.range_rules===undefined?{}:{range_rules:c.range_rules}) }, p_revision: body.revision, p_actor: actor };
    } else if (body.action === 'submit_driver_reporting') {
      if (!session.driver_id) return fail('SESSION_EXPIRED',401);
      if (!Array.isArray(body.dates) || body.dates.length > 31 || body.confirmed !== true || !Number.isInteger(body.revision)) return fail('請確認休假日期與送出聲明');
      rpc = 'driver_reporting_submit';
      args = { p_month: month + '-01', p_driver: session.driver_id, p_dates: body.dates, p_revision: body.revision };
    } else if(body.action==='admin_edit_driver_reporting') {
      if(!/^[0-9a-f-]{36}$/i.test(String(body.id||''))||!Array.isArray(body.dates)||body.dates.length>31||!Number.isInteger(body.revision)||body.confirmed!==true)return fail('請確認日曆修改內容');
      rpc='driver_reporting_admin_edit';args={p_id:body.id,p_dates:body.dates,p_revision:body.revision,p_note:String(body.note||'').trim(),p_actor:actor};
    } else {
      if (!/^[0-9a-f-]{36}$/i.test(String(body.id || '')) || !['approved','rejected'].includes(body.status) ||
          !Number.isInteger(body.revision) || body.confirmed !== true) return fail('請確認審核操作');
      rpc = 'driver_reporting_review';
      args = { p_id: body.id, p_status: body.status, p_reason: String(body.reason || '').trim(), p_revision: body.revision, p_actor: actor };
    }
    const { data, error } = await db.rpc(rpc, args);
    if (error) {
      if (['42883','42P01','PGRST202'].includes(error.code)) return fail('司機報班尚未完成資料庫安裝，請先套用本機 migration',503);
      return fail(error.message || '報班處理失敗，請重新整理', error.code === 'P0001' ? 409 : 400);
    }
    return { body: { data }, status: 200 };
  };
}
