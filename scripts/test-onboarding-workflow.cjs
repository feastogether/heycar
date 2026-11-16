const assert=require('node:assert/strict');
const {PGlite}=require('../.fleet-preview/node_modules/@electric-sql/pglite');
const {createOnboardingHandler}=require('../supabase/functions/data-api/onboarding-workflow.mjs');
async function main(){
 const sql=new PGlite(),id='50000000-0000-4000-8000-000000000001',race='50000000-0000-4000-8000-000000000002';
 const encode=value=>JSON.parse(JSON.stringify(value));
 const db={from(table){assert.equal(table,'drivers');let patch=null,where=[],params=[];return {
  select(){return this;},update(value){patch=value;return this;},eq(key,value){params.push(value);where.push(`"${key}"=$${params.length}`);return this;},is(key,value){assert.equal(value,null);where.push(`"${key}" is null`);return this;},
  async maybeSingle(){
   let query;
   if(patch){const sets=Object.entries(patch).map(([key,value])=>{params.push(key==='onboarding_progress'?JSON.stringify(value):value);return `"${key}"=$${params.length}`;});query=`update drivers set ${sets.join(',')} where ${where.join(' and ')} returning *`;}
   else query=`select * from drivers where ${where.join(' and ')}`;
   const rows=(await sql.query(query,params)).rows;return {data:rows[0]?encode(rows[0]):null};
  }
 };}};
 try{
  await sql.exec(`create table drivers(id uuid primary key,name text,phone text,notes text,photo_url text,driver_status text,onboarding_progress jsonb,onboarding_completed_at timestamptz,updated_at timestamptz);
   insert into drivers values('${id}','測試司機','0900000000','保留原備註','original-photo.jpg','待上線','{"files_confirmed_at":"2026-11-01","unknown_extension":{"keep":true}}',null,'2026-11-16T10:00:00Z');
   insert into drivers select '${race}',name,phone,notes,photo_url,driver_status,onboarding_progress,onboarding_completed_at,updated_at from drivers;`);
  const read=async key=>encode((await sql.query('select * from drivers where id=$1',[key])).rows[0]);
  const before=await read(id),actor={session_type:'admin',admin_user_id:'staff-001',admin_name:'督導',permissions:{driverOnboarding:true}};
  const handle=createOnboardingHandler({db,adminCan:async(s,p)=>s.permissions?.[p]===true,now:()=>new Date('2026-11-16T10:00:00Z')});
  const request={action:'complete_driver_onboarding',id,status:'跑趟中',completed_on:'2026-11-16',expected_updated_at:before.updated_at};
  assert.equal((await handle(request,{session_type:'driver',driver_id:id})).status,403);
  assert.equal((await handle(request,{session_type:'admin',permissions:{drivers:true}})).status,403);
  assert.equal((await handle({...request,status:'不存在的狀態'},actor)).status,400);
  assert.equal((await handle({...request,expected_updated_at:null},actor)).status,409);
  const saved=await handle({action:'save_driver_onboarding',id,expected_updated_at:before.updated_at,progress:{training_at:'2026-11-10',driver_status:'已離職',completed_by:'fake'}},actor);
  assert.equal(saved.status,200);assert.equal(saved.body.data.driver_status,'待上線');assert.deepEqual(saved.body.data.onboarding_progress.unknown_extension,{keep:true});
  assert.equal((await handle({...request,expected_updated_at:saved.body.data.updated_at,progress:{notes:'結案備註',phone:'不能覆蓋'}},actor)).status,200);
  const done=await read(id);assert.equal(done.driver_status,'跑趟中');assert(done.onboarding_completed_at);assert.equal(done.onboarding_progress.completed_by.id,'staff-001');assert.equal(done.onboarding_progress.training_at,'2026-11-10');
  for(const key of ['phone','notes','photo_url','name'])assert.equal(done[key],before[key]);
  assert.equal((await handle({...request,expected_updated_at:done.updated_at},actor)).status,409);
  const edited=await handle({action:'save_driver_onboarding',id,expected_updated_at:done.updated_at,progress:{completed_at:'',notes:'補上說明'}},actor);assert.equal(edited.status,200);assert.equal(edited.body.data.onboarding_completed_at,done.onboarding_completed_at);assert.equal(edited.body.data.driver_status,'跑趟中');
  const version=(await read(race)).updated_at;
  const results=await Promise.all([handle({...request,id:race,status:'停派中',expected_updated_at:version},actor),handle({...request,id:race,status:'跑趟中',expected_updated_at:version},actor)]);
  assert.equal(results.filter(result=>result.status===200).length,1);assert.equal(results.filter(result=>result.status===409).length,1);
  console.log('PASS: onboarding-only permissions, selected close status, atomic completion, stale/racing updates, preserved unknown progress and untouched driver details.');
 }finally{await sql.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
