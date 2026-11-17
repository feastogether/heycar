const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('../.fleet-preview/node_modules/@electric-sql/pglite');
const {createLoanActionHandler}=require('../supabase/functions/data-api/vehicle-loans.mjs');
module.exports=function createLoanPreview(fixture){
 const db=new PGlite(),rows=fixture.vehicle_loans ||= [],audit=fixture.vehicle_loan_actions ||= [];
 const ready=(async()=>{await db.waitReady;await db.exec(`create role anon;create role authenticated;create role service_role;
 create table vehicle_loans(id uuid primary key,requested_by_admin_id uuid,requested_by_name text,vehicle_id uuid,plate_no text,borrow_at timestamptz,return_at timestamptz,purpose text,notes text,status text,created_at timestamptz,updated_at timestamptz,approved_at timestamptz,actual_return_at timestamptz,closed_at timestamptz,requested_by_type text);`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261117020000_vehicle_loan_actions.sql'),'utf8'));
 for(const row of rows)await db.query('insert into vehicle_loans select * from jsonb_populate_record(null::vehicle_loans,$1::jsonb)',[JSON.stringify(row)]);
 for(const row of audit)await db.query('insert into vehicle_loan_actions(id,loan_id,action,actor,from_status,to_status,created_at)overriding system value values($1,$2,$3,$4,$5,$6,$7)',[row.id,row.loan_id,row.action,JSON.stringify(row.actor),row.from_status,row.to_status,row.created_at]);
 if(audit.length)await db.query("select setval(pg_get_serial_sequence('vehicle_loan_actions','id'),$1)",[Math.max(...audit.map(row=>Number(row.id)))]);
 })();
 let queue=Promise.resolve();const seen=new Map();
 async function sync(){await ready;for(const row of rows){const text=JSON.stringify(row);if(seen.get(row.id)===text)continue;
  await db.query(`insert into vehicle_loans select * from jsonb_populate_record(null::vehicle_loans,$1::jsonb) on conflict(id)do update set requested_by_admin_id=excluded.requested_by_admin_id,requested_by_name=excluded.requested_by_name,vehicle_id=excluded.vehicle_id,plate_no=excluded.plate_no,borrow_at=excluded.borrow_at,return_at=excluded.return_at,purpose=excluded.purpose,notes=excluded.notes,status=excluded.status,created_at=excluded.created_at,updated_at=excluded.updated_at,approved_at=excluded.approved_at,actual_return_at=excluded.actual_return_at,closed_at=excluded.closed_at`,[text]);seen.set(row.id,text);
 }}
 const api={async rpc(name,args){try{await sync();const data=(await db.query('select apply_vehicle_loan_action($1::uuid,$2::text,$3::timestamptz,$4::timestamptz,$5::jsonb,$6::boolean) as data',[args.p_id,args.p_action,args.p_expected,args.p_returned,JSON.stringify(args.p_actor),args.p_super])).rows[0].data;
 const index=rows.findIndex(row=>row.id===data.id);rows[index]=data;seen.set(data.id,JSON.stringify(data));
 audit.splice(0,audit.length,...JSON.parse(JSON.stringify((await db.query('select * from vehicle_loan_actions order by id')).rows)));return {data};}catch(error){return {error:{code:error.code,message:error.message}};}}};
 const handler=createLoanActionHandler({db:api});
 return {db,async handle(body,session){const pending=queue.then(()=>handler(body,session));queue=pending.catch(()=>{});return pending;},async close(){await ready;await db.close();}};
};
