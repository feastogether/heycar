const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {PGlite}=require('../.fleet-preview/node_modules/@electric-sql/pglite');
const {createInspectionHandler,inspectionActions}=require('../supabase/functions/data-api/vehicle-inspections.mjs');
const uuid=value=>/^[0-9a-f-]{36}$/i.test(String(value||''));
module.exports=function createInspectionsPreview({vehicles,drivers,directory,port,dbPath,filesPath}){
 const root=path.resolve(__dirname,'..');
 const db=new PGlite(dbPath||((process.env.INSPECTION_PREVIEW_DB==='memory'||process.env.REPORTING_PREVIEW_DB==='memory')?undefined:path.join(root,'.fleet-preview/inspection-data')));
 const folder=filesPath||process.env.INSPECTION_PREVIEW_FILES||path.join(root,'.fleet-preview/inspection-files');
 const signatures={inspection_start:['uuid','uuid','bigint'],inspection_create:['uuid','text','text','timestamptz','jsonb','jsonb'],inspection_load:['uuid','uuid','uuid','text','integer','boolean'],inspection_save_photo:['uuid','uuid','bigint','jsonb'],inspection_submit:['uuid','uuid','bigint','bigint','text','boolean'],inspection_review:['uuid','bigint','text','text','text[]','jsonb']};
 const ready=(async()=>{
  await db.waitReady;
  if(!(await db.query("select to_regclass('public.vehicle_inspection_tasks') as name")).rows[0].name){
   await db.exec(`create role anon;create role authenticated;create role service_role;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table insurance_partners(id uuid primary key,name text);
    create table drivers(id uuid primary key,name text,dealer_partner_id uuid,driver_status text,login_enabled boolean);
    create table vehicles(id uuid primary key,plate_no text,current_driver_id uuid,driver_history jsonb,assigned_driver_names text,dealer_partner_id uuid,status text,lease_status text);`);
   await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261117010000_vehicle_inspections.sql'),'utf8'));
  }
  if(!(await db.query("select 1 from information_schema.columns where table_name='vehicle_inspection_tasks'and column_name='eligible_driver_ids'")).rows.length)await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261117050000_shared_vehicle_inspections.sql'),'utf8'));
 })();
 const seen=new Map();
 async function sync(){await ready;
  for(const row of directory.filter(row=>uuid(row.id))){const values=[row.id,row.name];if(seen.get('p'+row.id)===JSON.stringify(values))continue;await db.query('insert into insurance_partners values($1,$2)on conflict(id)do update set name=excluded.name',values);seen.set('p'+row.id,JSON.stringify(values));}
  for(const row of drivers){const values=[row.id,row.name,row.dealer_partner_id||null,row.driver_status||'待上線',row.login_enabled!==false];if(seen.get('d'+row.id)===JSON.stringify(values))continue;await db.query('insert into drivers values($1,$2,$3,$4,$5)on conflict(id)do update set name=excluded.name,dealer_partner_id=excluded.dealer_partner_id,driver_status=excluded.driver_status,login_enabled=excluded.login_enabled',values);seen.set('d'+row.id,JSON.stringify(values));}
  for(const row of vehicles){let history=row.driver_history;try{if(typeof history==='string')history=JSON.parse(history);}catch{history=[];}const values=[row.id,row.plate_no,row.current_driver_id||null,JSON.stringify(Array.isArray(history)?history:[]),row.assigned_driver_names||'',row.dealer_partner_id||null,row.status||'',row.lease_status||''];if(seen.get('v'+row.id)===JSON.stringify(values))continue;await db.query('insert into vehicles values($1,$2,$3,$4,$5,$6,$7,$8)on conflict(id)do update set plate_no=excluded.plate_no,current_driver_id=excluded.current_driver_id,driver_history=excluded.driver_history,assigned_driver_names=excluded.assigned_driver_names,dealer_partner_id=excluded.dealer_partner_id,status=excluded.status,lease_status=excluded.lease_status',values);seen.set('v'+row.id,JSON.stringify(values));}
 }
 const tokens=new Map();
 function filePath(value){if(!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png)$/i.test(value))throw Error('Invalid inspection file path');const resolved=path.resolve(folder,value);if(!resolved.startsWith(path.resolve(folder)+path.sep))throw Error('Invalid path');return resolved;}
 const bucket={
  async upload(name,bytes){const file=filePath(name);try{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes,{flag:'wx'});return {};}catch(error){return {error:{message:error.code==='EEXIST'?'照片檔案已存在':error.message}};}},
  async remove(names){for(const name of names){try{fs.unlinkSync(filePath(name));}catch(error){if(error.code!=='ENOENT')throw error;}}return {};},
  async createSignedUrls(names,ttl){return {data:names.map(name=>{const token=randomUUID();tokens.set(token,{file:filePath(name),expires:Date.now()+ttl*1000,mime:name.endsWith('.png')?'image/png':'image/jpeg'});return {path:name,signedUrl:'http://127.0.0.1:'+port+'/__inspection_file/'+token};})};}
 };
 const api={
  storage:{from:()=>bucket},
  async rpc(name,args){try{await sync();const types=signatures[name],values=Object.values(args).map((value,i)=>types[i]==='jsonb'?JSON.stringify(value):value);const data=(await db.query(`select public.${name}(${types.map((type,i)=>'$'+(i+1)+'::'+type).join(',')}) as result`,values)).rows[0].result;if(name!=='inspection_load')await db.exec('checkpoint');return {data};}catch(error){return {error:{code:error.code,message:error.message}};}},
  from(table){if(!['vehicle_inspection_tasks','vehicle_inspection_photos'].includes(table))throw Error('Unknown inspection table');const filters=[],values=[];let fields='*';return {select(value){fields=value;return this;},eq(key,value){if(!['id','task_id','driver_id'].includes(key))throw Error('Unknown filter');values.push(value);filters.push('"'+key+'"=$'+values.length);return this;},async maybeSingle(){await ready;const rows=(await db.query('select '+(fields==='*'?'*':fields)+' from '+table+' where '+filters.join(' and '),values)).rows;return {data:rows[0]?JSON.parse(JSON.stringify(rows[0])):null};}};}
 };
 const handle=createInspectionHandler({db:api,adminCan:async session=>session.is_super_admin===true||session.permissions?.vehicleInspections===true});
 return {handle,actions:inspectionActions,db,api,sync,async close(){await ready;await db.close();},file(token){const item=tokens.get(token);if(!item||item.expires<Date.now()||!fs.existsSync(item.file))return null;return {bytes:fs.readFileSync(item.file),mime:item.mime};}};
};
