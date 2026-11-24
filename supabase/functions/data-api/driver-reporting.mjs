export const reportingActions = ['save_driver_roster_profile','save_driver_roster_cells','load_driver_reporting','save_driver_reporting_month','submit_driver_reporting','review_driver_reporting','admin_edit_driver_reporting','save_driver_roster_note','driver_roster_stamp','save_driver_roster_shift','admin_set_driver_leave'];

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
    if (!['review_driver_reporting','admin_edit_driver_reporting','save_driver_roster_note','save_driver_roster_profile'].includes(body.action) && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail('請選擇有效月份');
    const actor = { role: 'admin', id: session.admin_user_id || 'super-admin', name: session.admin_name || '最高管理員' };
    let rpc, args;
    if(body.action==='save_driver_roster_profile'){
      if(!/^[0-9a-f-]{36}$/i.test(body.driver_id||'')||typeof body.location!=='string'||body.location.length>80||!Number.isInteger(body.revision)||body.revision<0)return fail('請確認司機與位置');
      rpc='driver_roster_profile_save';args={p_driver:body.driver_id,p_location:body.location,p_revision:body.revision,p_actor:actor};
    }else if(body.action==='save_driver_roster_cells'){
      if(!Array.isArray(body.cells)||body.cells.length<1||body.cells.length>200)return fail('一次最多編輯200個格子');
      rpc='driver_roster_cells_save';args={p_month:month+'-01',p_cells:body.cells,p_actor:actor};
    }else if(body.action==='save_driver_roster_shift'){if(!/^[0-9a-f-]{36}$/i.test(body.driver_id||'')||typeof body.label!=='string'||body.label.length>40||!Number.isInteger(body.revision)||body.revision<0)return fail('請確認司機與班別');rpc='driver_roster_shift_save';args={p_month:month+'-01',p_driver:body.driver_id,p_label:body.label,p_revision:body.revision,p_actor:actor};}else if(body.action==='admin_set_driver_leave'){if(!/^[0-9a-f-]{36}$/i.test(body.driver_id||'')||!Array.isArray(body.dates)||body.dates.length>31||!Number.isInteger(body.revision)||body.revision<0||body.confirmed!==true||typeof(body.note??'')!=='string'||String(body.note||'').length>1000)return fail('請確認後台休假安排');rpc='driver_reporting_admin_set';args={p_month:month+'-01',p_driver:body.driver_id,p_dates:body.dates,p_revision:body.revision,p_note:body.note||'',p_actor:actor};}else if(body.action==='driver_roster_stamp'){rpc='driver_roster_stamp';args={p_month:month+'-01'};}else if(body.action==='save_driver_roster_note'){
      if(!/^[0-9a-f-]{36}$/i.test(String(body.driver_id||''))||!/^\d{4}-\d{2}-\d{2}$/.test(body.date||'')||!Number.isFinite(Date.parse(body.date))||new Date(body.date).toISOString().slice(0,10)!==body.date||typeof body.note!=='string'||body.note.length>1000||!Number.isInteger(body.revision)||body.revision<0)return fail('請確認日期與班表備註');
      if(body.color!==undefined&&(typeof body.color!=='string'||!(body.color===''||/^#[0-9a-f]{6}$/i.test(body.color))))return fail('請選擇有效顏色');
      rpc=body.color===undefined?'driver_roster_save':'driver_roster_save_color';args={p_driver:body.driver_id,p_date:body.date,p_note:body.note,...(body.color===undefined?{}:{p_color:body.color}),p_revision:body.revision,p_actor:actor};
    }else if (body.action === 'load_driver_reporting') {
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
    if(body.action==='load_driver_reporting'&&!driver){const roster=await db.rpc('driver_roster_details',{p_month:month+'-01'});if(roster.error)return fail(roster.error.message,503);data.roster=roster.data;const regionRows=data.rows?.length?await db.from('drivers').select('id,region').in('id',data.rows.map(row=>row.driver_id)):{data:[]};if(regionRows.error)return fail('暫時無法讀取司機區域，請重新整理',503);const regions=new Map(regionRows.data.map(row=>[row.id,row.region]));data.rows=(data.rows||[]).map(row=>({...row,region:regions.get(row.driver_id)||'',plates:[...new Set((roster.data.vehicles||[]).filter(v=>v.driver_id===row.driver_id).map(v=>v.plate_no))]}));}
    return { body: { data }, status: 200 };
  };
}
