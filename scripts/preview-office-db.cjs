const fs=require('fs'),path=require('path');
const {PGlite}=require('../.fleet-preview/node_modules/@electric-sql/pglite');
module.exports=function createOffice(fixture){
 const db=new PGlite(),ready=(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table drivers(id uuid primary key,name text,phone text,dealer_partner_id uuid);
 create table insurance_partners(id uuid primary key,name text,partner_type text);
 create table payment_notices(id uuid primary key,driver_id uuid,fee_type text,amount numeric,due_date date,content text,status text,created_at timestamptz,updated_at timestamptz,attachment_url text,attachment_name text);
 create table calendar_events(id uuid,plate_no text,completed_at timestamptz,service_record_id uuid,status text,event_type text,event_date date);
 create table insurance_requests(id uuid,plate_no text,status text);
 create table fleet_fines(id uuid,plate_no text,review_state text,due_date date,paid_date date,status text,archived_at timestamptz);
 `);
 for(const file of ['20261121010000_workspace_read_queries.sql','20261121020000_office_completion_timezone.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',file),'utf8'));
 })();
 const columns={drivers:['id','name','phone','dealer_partner_id'],insurance_partners:['id','name','partner_type'],payment_notices:['id','driver_id','fee_type','amount','due_date','content','status','created_at','updated_at','attachment_url','attachment_name'],calendar_events:['id','plate_no','completed_at','service_record_id','status','event_type','event_date'],insurance_requests:['id','plate_no','status'],fleet_fines:['id','plate_no','review_state','due_date','paid_date','status','archived_at']};
 async function sync(){await ready;const source={drivers:fixture.drivers,insurance_partners:fixture.dealers,payment_notices:fixture.payment_notices,calendar_events:fixture.calendar,insurance_requests:fixture.insurance_requests,fleet_fines:fixture.fines};for(const [table,fields]of Object.entries(columns)){await db.exec('delete from '+table);const rows=(source[table]||[]).map(row=>Object.fromEntries(fields.map(key=>[key,row[key]??null])));if(rows.length)await db.query('insert into '+table+' select '+fields.join(',')+' from jsonb_populate_recordset(null::'+table+',$1::jsonb)',[JSON.stringify(rows)]);}}
 return {db,ready,async rpc(name,args){await sync();try{return {data:(await db.query(name==='office_payment_page'?'select office_payment_page($1::jsonb,$2::integer,$3::boolean)as data':'select office_todo_summary($1::text[])as data',name==='office_payment_page'?[JSON.stringify(args.p_filters),args.p_page,args.p_directory]:[args.p_permissions])).rows[0].data};}catch(error){return {error};}},async close(){await ready;await db.close();}};
};
