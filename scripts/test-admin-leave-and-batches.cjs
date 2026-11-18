const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const reporting=require('./preview-reporting-db.cjs'),inspection=require('./preview-inspections-db.cjs');
async function main(){
 process.env.REPORTING_PREVIEW_DB='memory';process.env.INSPECTION_PREVIEW_DB='memory';
 const root=path.resolve(__dirname,'..'),folder=path.join(root,'.fleet-preview','admin-actions-test-'+process.pid),dealer=randomUUID(),other=randomUUID(),driver=randomUUID(),vehicle=randomUUID();
 const drivers=[{id:driver,name:'測試司機',dealer_partner_id:dealer,driver_status:'跑趟中'}],directory=[{id:dealer,name:'亞菲得股份有限公司',partner_type:'dealer',active:true},{id:other,name:'其他車商',partner_type:'dealer',active:true}],admin={session_type:'admin',is_super_admin:true,admin_name:'測試督導'},person={session_type:'driver',driver_id:driver};
 const reports=reporting(directory,drivers),photos=inspection({vehicles:[{id:vehicle,plate_no:'TEST-001',current_driver_id:driver}],drivers,directory,port:4996,filesPath:folder});
 try{
  const now=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(new Date()),month=now.slice(0,7),date=n=>month+'-'+String(n).padStart(2,'0');
  const report=(action,body={},session=admin)=>reports.handle({action,...body},session);
  const config={is_open:true,opens_on:now,closes_on:now,allowed_days:4,blocked_dates:[date(9)],range_rules:[{start_on:date(1),end_on:date(10),max_days:1}]};
  let result=await report('save_driver_reporting_month',{month,revision:0,config});assert.equal(result.status,200);let policy=result.body.data;
  result=await report('submit_driver_reporting',{month,revision:policy.revision,dates:[date(1)],confirmed:true},person);let saved=result.body.data;assert.equal(result.status,200);
  result=await report('review_driver_reporting',{id:saved.id,status:'approved',revision:saved.revision,confirmed:true});saved=result.body.data;
  result=await report('save_driver_reporting_month',{month,revision:policy.revision,config:{...config,is_open:false}});policy=result.body.data;assert.equal(result.status,200);
  const edit={id:saved.id,revision:saved.revision,dates:[date(1),date(2),date(3),date(4),date(9)],note:'後台臨時調休',confirmed:true};
  assert.equal((await report('admin_edit_driver_reporting',edit,person)).status,403);
  result=await report('admin_edit_driver_reporting',edit);assert.equal(result.status,200,JSON.stringify(result));const changed=result.body.data;assert.equal(changed.status,'approved');assert.equal(changed.submitted_at,saved.submitted_at);assert.equal(changed.reviewer_name,saved.reviewer_name);assert.equal(changed.off_dates.length,5,'admin overrides closed period, monthly/range caps and blocked day');assert(changed.admin_edited_at);
  assert.equal((await report('admin_edit_driver_reporting',edit)).status,409,'stale edits cannot overwrite newer dates');
  const audit=(await report('load_driver_reporting',{month})).body.data.audit.find(row=>row.action==='admin_edited');assert.deepEqual(audit.details.before.off_dates,[date(1)]);assert.deepEqual(audit.details.after.off_dates,edit.dates);assert.equal(audit.actor.name,'測試督導');
  result=await report('save_driver_reporting_month',{month,revision:policy.revision,config:{...config,is_open:false}});assert.equal(result.status,200,'individual admin exceptions do not invalidate the general month policy');
  assert.equal((await report('admin_edit_driver_reporting',{...edit,revision:changed.revision,dates:['2030-01-01']})).status,409,'editing cannot move dates into another month');
  const call=(action,body={},session=admin)=>photos.handle({action,...body},session),create={request_id:randomUUID(),title:'測試批次',instructions:'外觀檢查',due_on:new Date(Date.now()+86400000).toISOString().slice(0,10),targets:[{vehicle_id:vehicle,driver_id:driver}]};
  result=await call('inspection_create',create);assert.equal(result.status,200);assert(/^\d{8}-\d{3,}$/.test(result.body.data.batch_no));const first=result.body.data;
  const next=await call('inspection_create',{...create,request_id:randomUUID()});assert.notEqual(next.body.data.batch_no,first.batch_no);assert.equal((await call('inspection_create',create)).body.data.batch_no,first.batch_no,'retry preserves the same date reference');
  assert.equal((await call('inspection_batches',{},person)).status,403);let batch=(await call('inspection_batches')).body.data.rows.find(row=>row.id===first.batch_id);const task=(await call('inspection_load',{batch_id:batch.id})).body.data.tasks[0].task;
  const action={batch_id:batch.id,revision:batch.revision,operation:'delete',reason:'誤發',confirmed:true};assert.equal((await call('inspection_batch_action',action,person)).status,403);result=await call('inspection_batch_action',action);assert.equal(result.status,200);batch=result.body.data.batch;
  assert.equal((await call('inspection_load',{batch_id:batch.id},person)).body.data.total,0,'deleted batch disappears from driver lists');assert.equal((await call('inspection_load',{task_id:task.id},person)).status,404);assert.equal((await call('inspection_start',{task_id:task.id,revision:task.revision},person)).status,409,'deleted batch rejects writes');
  assert.equal((await call('inspection_batch_action',action)).status,200,'delete retries are idempotent');assert.equal((await call('inspection_batches',{deleted:true})).body.data.total,1);
  result=await call('inspection_batch_action',{...action,operation:'restore',revision:batch.revision});assert.equal(result.status,200);batch=result.body.data.batch;assert.equal((await call('inspection_load',{batch_id:batch.id},person)).body.data.total,1);
  assert.equal((await call('inspection_batch_action',{...action,operation:'cancel',revision:1})).status,409);result=await call('inspection_batch_action',{...action,operation:'cancel',revision:batch.revision});assert.equal(result.status,200);batch=result.body.data.batch;assert.equal((await call('inspection_load',{task_id:task.id},person)).body.data.task.status,'cancelled');
  assert.equal((await photos.db.query('select count(*)::int as count from vehicle_inspection_tasks')).rows[0].count,2,'cancel/delete never delete tasks');
  const newest=await call('inspection_create',{...create,request_id:randomUUID()});assert.notEqual(newest.body.data.batch_no,first.batch_no,'deleted/cancelled date references are never reused');
  console.log('PASS: unrestricted audited admin leave edits, preserved review/submit metadata, stale guards and policy exceptions; date-based batch numbers, reversible deletion, cancel, restore, permission checks and write blocking.');
 }finally{await reports.close();await photos.close();const safe=path.resolve(folder);if(!safe.startsWith(path.join(root,'.fleet-preview')+path.sep)||!safe.endsWith('admin-actions-test-'+process.pid))throw Error('Unsafe cleanup');fs.rmSync(safe,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
