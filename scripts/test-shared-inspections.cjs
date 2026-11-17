const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const createPreview=require('./preview-inspections-db.cjs'),{inspectionSlots}=require('../supabase/functions/data-api/vehicle-inspections.mjs');
async function main(){
 process.env.INSPECTION_PREVIEW_DB='memory';const root=path.resolve(__dirname,'..'),folder=path.join(root,'.fleet-preview','shared-inspection-test-'+process.pid);
 const dealer=randomUUID(),vehicle=randomUUID(),d1=randomUUID(),d2=randomUUID(),third=randomUUID();
 const drivers=[{id:d1,name:'甲司機',driver_status:'跑趟中',dealer_partner_id:dealer},{id:d2,name:'乙司機',driver_status:'跑趟中',dealer_partner_id:dealer},{id:third,name:'其他司機',driver_status:'跑趟中',dealer_partner_id:dealer}];
 const vehicles=[{id:vehicle,plate_no:'TEST-001',dealer_partner_id:dealer,driver_history:[{driver_id:d1,driver_name:'甲司機'},{driver_id:d2,driver_name:'乙司機'}]}];
 const before=JSON.stringify(vehicles),helper=createPreview({vehicles,drivers,directory:[{id:dealer,name:'測試車商'}],port:4998,filesPath:folder});
 const admin={session_type:'admin',is_super_admin:true},one={session_type:'driver',driver_id:d1},two={session_type:'driver',driver_id:d2};
 const call=(action,body={},session=admin)=>helper.handle({action,...body},session);
 try{
  const targets=[{vehicle_id:vehicle,driver_id:d1},{vehicle_id:vehicle,driver_id:d2}];const create={request_id:randomUUID(),title:'同車檢查',instructions:'任一司機完成即可',due_on:new Date(Date.now()+86400000).toISOString().slice(0,10),targets};
  let result=await call('inspection_create',create);assert.equal(result.status,200);assert.equal(result.body.data.count,1,'two current drivers create just one vehicle task');
  const list1=(await call('inspection_load',{status:'todo'},one)).body.data,list2=(await call('inspection_load',{status:'todo'},two)).body.data;assert.equal(list1.total,1);assert.equal(list2.total,1);let task=list1.tasks[0].task;assert.equal(task.id,list2.tasks[0].task.id);assert.equal(task.eligible_driver_ids.length,2);
  const taskId=task.id;result=await call('inspection_start',{task_id:taskId,revision:task.revision},two);assert.equal(result.status,200);task=result.body.data.task;assert.equal(task.claimed_by,d2);assert.equal((await call('inspection_start',{task_id:taskId,revision:1},one)).status,409);assert.equal((await call('inspection_start',{task_id:taskId,revision:task.revision},two)).status,200,'starting twice is idempotent');
  assert.equal((await call('inspection_load',{task_id:taskId},{session_type:'driver',driver_id:third})).status,404);
  const image=n=>Buffer.from([255,216,255,n,1,2,3,255,217]).toString('base64');
  assert.equal((await call('inspection_photo',{task_id:taskId,revision:task.revision,slot:'front',request_id:randomUUID(),base64:image(99)},one)).status,409,'the other driver cannot overwrite or mix the claimed task photos');
  for(const [index,slot]of inspectionSlots.entries()){result=await call('inspection_photo',{task_id:taskId,revision:task.revision,slot,request_id:randomUUID(),base64:image(index)},two);assert.equal(result.status,200,JSON.stringify(result));task=result.body.data.task;}
  result=await call('inspection_submit',{task_id:taskId,revision:task.revision,odometer:120000,notes:'已檢查',},two);assert.equal(result.status,200);task=result.body.data.task;
  result=await call('inspection_review',{task_id:taskId,revision:task.revision,status:'approved',reason:'',slots:[]});assert.equal(result.status,200);
  for(const session of [one,two]){assert.equal((await call('inspection_load',{status:'todo'},session)).body.data.total,0);assert.equal((await call('inspection_load',{status:'approved'},session)).body.data.total,1,'both drivers see the same approved result');}
  assert.equal(JSON.stringify(vehicles),before,'shared inspections never change vehicle assignments');
  // Upgrade only untouched duplicate tasks, retaining both rows and an audit trail.
  result=await call('inspection_create',{...create,request_id:randomUUID()});const fresh=(await call('inspection_load')).body.data.tasks.find(row=>row.task.batch_id===result.body.data.batch_id).task;
  const duplicate=randomUUID(),alternate=fresh.driver_id===d1?d2:d1;
  await helper.db.query("update vehicle_inspection_tasks set eligible_driver_ids=null where id=$1",[fresh.id]);
  await helper.db.query("insert into vehicle_inspection_tasks(id,batch_id,vehicle_id,driver_id,plate_no,driver_name,dealer_name)values($1,$2,$3,$4,'TEST-001','舊任務','測試車商')",[duplicate,fresh.batch_id,vehicle,alternate]);
  const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261117050000_shared_vehicle_inspections.sql'),'utf8'),start=sql.indexOf('do $$'),end=sql.indexOf('end;$$;',start)+7;await helper.db.exec(sql.slice(start,end));
  const retained=(await helper.db.query('select * from vehicle_inspection_tasks where batch_id=$1',[fresh.batch_id])).rows;assert.equal(retained.length,2);assert.equal(retained.filter(row=>row.superseded_by).length,1);assert.equal(retained.find(row=>!row.superseded_by).eligible_driver_ids.length,2);
  console.log('PASS: one shared vehicle task, driver claim ownership, no mixed/duplicate uploads, partner visibility, shared approval, safe untouched-task consolidation, retained task/audit history and unchanged vehicle assignments.');
 }finally{await helper.close();const safe=path.resolve(folder);if(!safe.startsWith(path.join(root,'.fleet-preview')+path.sep)||!safe.endsWith('shared-inspection-test-'+process.pid))throw Error('Unsafe cleanup');fs.rmSync(safe,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
