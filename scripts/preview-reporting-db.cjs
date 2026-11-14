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
    await db.exec("alter table drivers add column if not exists driver_status text default '待上線'");
    if(sourceDrivers) await db.query("update drivers set driver_status='停派中' where id=any($1::uuid[])",[examples.map(row=>row.id)]);
    for(const row of drivers)await db.query('insert into drivers(id,name,dealer_partner_id,fleet_name,driver_status) values($1,$2,$3,$4,$5) on conflict(id) do update set driver_status=excluded.driver_status,name=excluded.name,dealer_partner_id=excluded.dealer_partner_id,fleet_name=excluded.fleet_name',[row.id,row.name,row.dealer_partner_id,row.fleet_name,row.driver_status]);
    const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261113010000_driver_reporting.sql'),'utf8');
    for(const name of ['driver_reporting_dealer','driver_reporting_load']) {
      const start=sql.indexOf('create function public.'+name+'('),end=sql.indexOf('$$;',start)+3;
      await db.exec(sql.slice(start,end).replace('create function','create or replace function'));
    }
  })();
  const signature={driver_reporting_load:['date','uuid'],driver_reporting_save_month:['date','jsonb','bigint','jsonb'],driver_reporting_submit:['date','uuid','date[]','bigint'],driver_reporting_review:['uuid','text','text','bigint','jsonb']};
  const handle=createDriverReportingHandler({adminCan:async session=>session.is_super_admin,db:{rpc:async(name,args)=>{
    await ready;
    for(const row of directory.filter(row=>row.partner_type==='dealer'))await db.query('insert into insurance_partners values($1,$2,$3,$4,$5) on conflict(id) do update set name=excluded.name,partner_type=excluded.partner_type,active=excluded.active,frontend_permissions=excluded.frontend_permissions',[row.id,row.name,row.partner_type,row.active!==false,JSON.stringify(row.frontend_permissions||{})]);
    try {
      const values=Object.values(args).map((value,index)=>signature[name][index]==='jsonb'?JSON.stringify(value):value);
      const result=(await db.query(`select public.${name}(${signature[name].map((type,index)=>`$${index+1}::${type}`).join(',')}) as result`,values)).rows[0].result;
      if(name!=='driver_reporting_load')await db.exec('checkpoint');
      return {data:result};
    }catch(error){return {error:{code:error.code,message:error.message}};}
  }}});
  return {drivers,handle,actions:reportingActions,close:async()=>{await ready;await db.close();}};
};
