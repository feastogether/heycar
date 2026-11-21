// View dependencies are explicit; never accept table names from the browser.
const vehicle=['vehicles','vehicle_types','drivers','insurance_partners'];
const fleet=[...vehicle,'vehicle_service_records','calendar_events','maintenance_notifications','maintenance_notification_batches'];
export const workspaceViews={
 home:['admin_users','staff_announcements','staff_calendar_events','staff_notes'],
 vehicles:vehicle,drivers:[...vehicle],driverOnboarding:[...vehicle,'admin_users'],vehicleTypes:['vehicle_types'],
 dispatchCenter:[...vehicle,'dispatch_orders'],calendar:[...vehicle,'calendar_events','maintenance_notifications'],
 serviceRecords:[...fleet],maintenanceManagement:fleet,idleManagement:fleet,fleetOperations:fleet,
 fleetCases:['insurance_partners','vehicles','drivers'],fleetPolicies:['vehicles','insurance_partners'],
 insuranceCenter:[...vehicle,'insurance_requests'],insurancePartners:['insurance_partners'],
 vehicleLoans:[...vehicle,'vehicle_loans','key_access_codes'],payments:[],
 adminUsers:['admin_users'],loginHistory:[],storage:[],trafficMonitor:[],satelliteMonitor:['vehicles','drivers'],
 announcements:['announcements','announcement_reads','insurance_partners'],personalMessages:['personal_messages','drivers'],
 feedbacks:['feedbacks','drivers'],driverHelperArticles:['driver_helper_articles'],marquee:['marquee_messages'],loginSlogans:['login_slogans'],emergencyEvents:['emergency_events'],
 mailManagement:['mail_recipients','mail_shipments'],bom:['bom_parts','bom_packages'],hiringManagement:['hiring_pages','hiring_applications'],
 heyPoints:[],equipmentManagement:[],vehicleInspections:[],driverReporting:[],boardManagement:[]
};
export function createWorkspaceQueryHandler({db,adminCan,sign=async value=>value}){
 return async(body,session)=>{
  if(!['payment_page','office_todos','workspace_record'].includes(body.action))return null;
  const fail=(error,status=400)=>({body:{error},status});
  if(session.session_type!=='admin')return fail('ADMIN_PERMISSION_DENIED',403);
  if(body.action==='workspace_record'){
   if(!['drivers','vehicles'].includes(body.table)||!await adminCan(session,body.table))return fail('ADMIN_PERMISSION_DENIED',403);
   if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.id||''))return fail('INVALID_RECORD_ID');
   const result=await db.from(body.table).select('*').eq('id',body.id).single();if(result.error)throw result.error;
   return {body:await sign({data:result.data}),status:200};
  }
  if(body.action==='office_todos'){
   const permissions=[];for(const name of ['serviceRecords','maintenanceManagement','insuranceCenter','fleetCases'])if(await adminCan(session,name))permissions.push(name);
   const result=await db.rpc('office_todo_summary',{p_permissions:permissions});if(result.error)throw result.error;return {body:result.data,status:200};
  }
  if(!await adminCan(session,'payments'))return fail('ADMIN_PERMISSION_DENIED',403);
  const filters=body.filters||{},page=Number(body.page||1),keys=['query','status','type','dealer','from','to'];
  if(!filters||Array.isArray(filters)||typeof filters!=='object'||!Number.isInteger(page)||page<1||page>100000||keys.some(key=>typeof(filters[key]??'')!=='string'||String(filters[key]||'').length>(key==='query'?120:100)))return fail('INVALID_PAYMENT_FILTER');
  if(!['','pending','paid','returned'].includes(filters.status||'')||filters.dealer&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(filters.dealer)||['from','to'].some(key=>filters[key]&&(!/^\d{4}-\d{2}-\d{2}$/.test(filters[key])||!Number.isFinite(Date.parse(filters[key]+'T00:00:00Z'))||new Date(filters[key]+'T00:00:00Z').toISOString().slice(0,10)!==filters[key]))||filters.from&&filters.to&&filters.from>filters.to)return fail('INVALID_PAYMENT_FILTER');
  const safe=Object.fromEntries(keys.map(key=>[key,String(filters[key]||'').trim()]));
  const result=await db.rpc('office_payment_page',{p_filters:safe,p_page:page,p_directory:body.directory===true});if(result.error)throw result.error;
  return {body:await sign(result.data),status:200};
 };
}
