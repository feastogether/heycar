const fs=require('fs'),path=require('path'),{PGlite}=require('../.fleet-preview/node_modules/@electric-sql/pglite'),{createHash}=require('crypto');
module.exports=function createStaff(fixture){
 const db=new PGlite(),ready=(async()=>{await db.exec(`create role anon;create role authenticated;create role service_role;
 create table admin_users(id uuid primary key default gen_random_uuid(),name text not null,login_code_hash text unique,active boolean default true,permissions jsonb default '{}',extension text,avatar_url text,avatar_name text,created_at timestamptz default now(),updated_at timestamptz default now());`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261121030000_staff_departments.sql'),'utf8'));
 const rows=(fixture.staff_users||[]).map(row=>({...row,updated_at:row.updated_at||'2026-01-01T00:00:00Z',created_at:'2026-01-01T00:00:00Z',permission_mode:row.permission_mode||'personal'}));
 if(rows.length)await db.query('insert into admin_users select * from jsonb_populate_recordset(null::admin_users,$1::jsonb)',[JSON.stringify(rows)]);
 await sync();})();
 async function sync(){for(const [table,key]of [['admin_users','staff_users'],['staff_departments','staff_departments'],['staff_job_titles','staff_job_titles']]){const rows=(await db.query('select to_jsonb(t)'+(table==='admin_users'?"-'login_code_hash'":'')+' as row from '+table+' t'+(table==='admin_users'?'':' where deleted_at is null'))).rows.map(result=>result.row);if(!fixture[key])fixture[key]=[];fixture[key].splice(0,fixture[key].length,...rows);}}
 const api={async rpc(name,args){await ready;try{const sql=name==='staff_employee_save'?'select staff_employee_save($1::uuid,$2::jsonb,$3::timestamptz,$4::jsonb)as result':'select staff_structure_action($1::text,$2::jsonb,$3::jsonb)as result',params=name==='staff_employee_save'?[args.p_id,JSON.stringify(args.p_record),args.p_expected,JSON.stringify(args.p_actor)]:[args.p_action,JSON.stringify(args.p_record),JSON.stringify(args.p_actor)];const data=(await db.query(sql,params)).rows[0].result;await sync();return {data};}catch(error){return {error};}}};
 const handler=require('../supabase/functions/data-api/staff-management.mjs').createStaffManagementHandler({db:api,hashCode:async code=>{if(String(code)==='0000')throw Error('停用的登入代碼');return createHash('sha256').update(code).digest('hex');},normalizeLoginCode:code=>String(code).trim()});
 return {db,api,ready,handle:handler,async close(){await ready;await db.close();}};
};
