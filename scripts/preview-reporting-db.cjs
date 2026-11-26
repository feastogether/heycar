const { PGlite } = require('../.fleet-preview/node_modules/@electric-sql/pglite');
const { createDriverReportingHandler, reportingActions } = require('../supabase/functions/data-api/driver-reporting.mjs');
const fs=require('node:fs'),path=require('node:path');
module.exports=function createReportingPreview(directory, sourceDrivers = null) {
  const dealer=directory.find(row=>row.name==='亞菲得股份有限公司');
  const other=directory.find(row=>row.name!=='亞菲得股份有限公司'&&row.partner_type==='dealer');
  const examples=[
    {id:'20000000-0000-4000-8000-000000000001',name:'報班示範・王司機',dealer_partner_id:dealer.id,fleet_name:dealer.name},
    {id:'20000000-0000-4000-8000-000000000002',name:'報班示範・林司機',dealer_partner_id:dealer.id,fleet_name:dealer.name},
    {id:'20000000-0000-4000-8000-000000000003',name:'報班示範・其他車商',dealer_partner_id:other.id,fleet_name:other.name}
  ];
  const db=new PGlite(process.env.REPORTING_PREVIEW_DB === 'memory' ? undefined : path.join(__dirname,'../.fleet-preview/driver-reporting-data'));
  examples.forEach((row,index)=>row.driver_status=index===1?'待上線':'跑趟中');
  const drivers = sourceDrivers ? [...sourceDrivers].sort((a,b)=>Number(b.dealer_partner_id===dealer.id&&['跑趟中','待上線'].includes(b.driver_status))-Number(a.dealer_partner_id===dealer.id&&['跑趟中','待上線'].includes(a.driver_status))) : examples;
  const ready=(async()=>{
    await db.waitReady;
    const exists=(await db.query("select to_regclass('public.driver_reporting_months') as name")).rows[0].name;
    if (!exists) {
      await db.exec(`create role anon;create role authenticated;create role service_role;
        create table public.insurance_partners(id uuid primary key,name text,partner_type text,active boolean,frontend_permissions jsonb default '{}');
        create table public.drivers(id uuid primary key,name text,dealer_partner_id uuid,fleet_name text,driver_status text);`);
      await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261113010000_driver_reporting.sql'),'utf8'));
    }
    if(!(await db.query("select 1 from information_schema.columns where table_name='driver_reporting_months'and column_name='range_rules'")).rows.length)await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261117040000_driver_reporting_range_rules.sql'),'utf8'));
    if(!(await db.query("select 1 from information_schema.columns where table_name='driver_reporting_submissions'and column_name='admin_edited_at'")).rows.length)await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261118010000_reporting_admin_calendar_edit.sql'),'utf8'));
    await db.exec("alter table drivers add column if not exists driver_status text default '待上線'");
    if(sourceDrivers) await db.query("update drivers set driver_status='停派中' where id=any($1::uuid[])",[examples.map(row=>row.id)]);
    for(const row of drivers)await db.query('insert into drivers(id,name,dealer_partner_id,fleet_name,driver_status) values($1,$2,$3,$4,$5) on conflict(id) do update set driver_status=excluded.driver_status,name=excluded.name,dealer_partner_id=excluded.dealer_partner_id,fleet_name=excluded.fleet_name',[row.id,row.name,row.dealer_partner_id,row.fleet_name,row.driver_status]);
    const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261113010000_driver_reporting.sql'),'utf8');
    for(const name of (await db.query("select to_regclass('public.vehicle_change_jobs')as name")).rows[0].name?[]:['driver_reporting_dealer','driver_reporting_load']) {
      const start=sql.indexOf('create function public.'+name+'('),end=sql.indexOf('$$;',start)+3;
      await db.exec(sql.slice(start,end).replace('create function','create or replace function'));
    }
  await db.exec("create table if not exists calendar_events(id uuid primary key,driver_id uuid,event_date date,event_type text,plate_no text,completed_at timestamptz)");
    if(!(await db.query("select to_regclass('public.driver_roster_notes')as name")).rows[0].name){const roster=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261123010000_roster_chat_updates.sql'),'utf8');await db.exec(roster.slice(roster.indexOf('create table public.driver_roster_notes')));}
await db.exec("create table if not exists vehicles(id uuid primary key,plate_no text,current_driver_id uuid,assigned_driver_names text,driver_history jsonb default '[]');create table if not exists calendar_events(id uuid primary key,driver_id uuid,event_date date,event_type text,plate_no text,completed_at timestamptz);alter table calendar_events add column if not exists vendor text;alter table calendar_events add column if not exists event_time text;");if(!(await db.query("select to_regclass('public.driver_roster_shifts')as name")).rows[0].name)await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261123030000_roster_workspace.sql'),'utf8'));
    if(!(await db.query("select 1 from information_schema.columns where table_name='driver_roster_notes'and column_name='color'")).rows.length)await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261123050000_roster_colors.sql'),'utf8'));
    await db.exec("alter table calendar_events add column if not exists status text");
    const cancelSql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261123060000_service_schedule_cancel.sql'),'utf8');await db.exec(cancelSql.slice(cancelSql.indexOf('create or replace function public.driver_roster_load')));
    await db.exec("alter table vehicles add column if not exists model text");
    if(!(await db.query("select to_regclass('public.driver_roster_profiles')as name")).rows[0].name)await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261124010000_roster_quick_edit.sql'),'utf8'));
    await db.exec("alter table vehicles add column if not exists brand text;alter table vehicles add column if not exists status text;alter table vehicles add column if not exists lease_status text;alter table vehicles add column if not exists updated_at timestamptz;");
    if(!(await db.query("select to_regclass('public.vehicle_change_jobs')as name")).rows[0].name)await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261124020000_vehicle_assignment_timeline.sql'),'utf8'));
    await db.exec("alter table drivers add column if not exists region text");for(const d of drivers)await db.query('update drivers set region=$1 where id=$2',[d.region||'',d.id]);
    if(!(await db.query("select to_regprocedure('public.driver_roster_page(date,text)')as name")).rows[0].name)await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261125020000_roster_page_query.sql'),'utf8'));
    await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261125030000_roster_month_stamp.sql'),'utf8'));
    await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261126030000_roster_assignment_query.sql'),'utf8'));
  })();
  const signature={driver_roster_page:["date","text"],vehicle_change_directory:[],vehicle_change_preview:["uuid","uuid","date","text"],save_vehicle_change:["uuid","uuid","uuid","date","text","jsonb","text","jsonb"],cancel_vehicle_change:["uuid","integer","text","jsonb"],driver_vehicle_snapshot:["uuid","text"],driver_roster_profile_save:["uuid","text","integer","jsonb"],driver_roster_cells_save:["date","jsonb","jsonb"],driver_roster_details:["date"],driver_roster_save_color:["uuid","date","text","text","integer","jsonb"],driver_roster_shift_save:["date","uuid","text","integer","jsonb"],driver_reporting_admin_set:["date","uuid","date[]","bigint","text","jsonb"],driver_roster_stamp:["date"],driver_roster_load:["date"],driver_roster_save:["uuid","date","text","integer","jsonb"],driver_reporting_admin_edit:['uuid','date[]','bigint','text','jsonb'],driver_reporting_load:['date','uuid'],driver_reporting_save_month:['date','jsonb','bigint','jsonb'],driver_reporting_submit:['date','uuid','date[]','bigint'],driver_reporting_review:['uuid','text','text','bigint','jsonb']};
  const handle=createDriverReportingHandler({adminCan:async session=>session.is_super_admin,db:{from:()=>({select(){return this;},in(key,ids){return Promise.resolve({data:drivers.filter(row=>ids.includes(row.id)).map(row=>({id:row.id,region:row.region||''}))});}}),rpc:async(name,args)=>{
    await ready;
    for(const row of directory.filter(row=>row.partner_type==='dealer'))await db.query('insert into insurance_partners values($1,$2,$3,$4,$5) on conflict(id) do update set name=excluded.name,partner_type=excluded.partner_type,active=excluded.active,frontend_permissions=excluded.frontend_permissions',[row.id,row.name,row.partner_type,row.active!==false,JSON.stringify(row.frontend_permissions||{})]);
    try {
      const values=Object.values(args).map((value,index)=>signature[name][index]==='jsonb'?JSON.stringify(value):value);
      const result=(await db.query(`select public.${name}(${signature[name].map((type,index)=>`$${index+1}::${type}`).join(',')}) as result`,values)).rows[0].result;
      if(name!=='driver_reporting_load')await db.exec('checkpoint');
      return {data:result};
    }catch(error){return {error:{code:error.code,message:error.message}};}
  }}});
  return {query:async(sql,args=[])=>{await ready;return db.query(sql,args);},assignmentRpc:async(name,args)=>{await ready;try{const types=signature[name],values=Object.values(args).map((value,i)=>types[i]==='jsonb'?JSON.stringify(value):value);return{data:(await db.query('select public.'+name+'('+types.map((t,i)=>'$'+(i+1)+'::'+t).join(',')+')as result',values)).rows[0].result};}catch(e){return{error:{code:e.code,message:e.message}};}},drivers,handle,actions:reportingActions,syncVehicles:async vehicles=>{await ready;for(const v of vehicles)await db.query('insert into vehicles(id,plate_no,current_driver_id,assigned_driver_names,driver_history,model) values($1,$2,$3,$4,$5,$6) on conflict(id)do update set plate_no=excluded.plate_no,current_driver_id=excluded.current_driver_id,assigned_driver_names=excluded.assigned_driver_names,driver_history=excluded.driver_history,model=excluded.model',[v.id,v.plate_no,v.current_driver_id||null,v.assigned_driver_names||'',JSON.stringify(v.driver_history||[]),v.model||'']);},syncCalendar:async events=>{await ready;await db.exec('delete from calendar_events');for(const e of events)await db.query('insert into calendar_events(id,driver_id,event_date,event_type,plate_no,completed_at,vendor,event_time,status)values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[e.id,e.driver_id,e.event_date,e.event_type,e.plate_no,e.completed_at||null,e.vendor||'',e.event_time||'',e.status||'']);},syncDriver:async driver=>{await ready;await db.query('update drivers set name=$1,dealer_partner_id=$2,fleet_name=$3,driver_status=$4 where id=$5',[driver.name,driver.dealer_partner_id,driver.fleet_name,driver.driver_status,driver.id]);await db.exec('checkpoint');},close:async()=>{await ready;await db.close();}};
};
