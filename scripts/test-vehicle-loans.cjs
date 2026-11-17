const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const preview=require('./preview-loans-db.cjs');
async function main(){
 const owner=randomUUID(),other=randomUUID(),vehicle=randomUUID(),before=new Date(Date.now()-3600000).toISOString(),after=new Date(Date.now()+3600000).toISOString();
 const fixture={vehicle_loans:[{id:randomUUID(),vehicle_id:vehicle,requested_by_admin_id:owner,requested_by_name:'測試同仁',borrow_at:before,return_at:after,status:'pending_approval',updated_at:null}],vehicles:[{id:vehicle,driver_history:[{driver_name:'原駕駛'}],current_driver_id:other}]};
 const original=JSON.stringify(fixture.vehicles),helper=preview(fixture),admin={session_type:'admin',is_super_admin:true},own={session_type:'admin',admin_user_id:owner,admin_name:'測試同仁'},foreign={session_type:'admin',admin_user_id:other};
 let row=fixture.vehicle_loans[0];const call=(operation,extra={},session=admin)=>helper.handle({id:row.id,operation,expected_updated_at:row.updated_at,...extra},session);
 try{
  assert.equal((await call('approve',{},own)).status,403);
  assert.equal((await call('return',{actual_return_at:new Date().toISOString()},own)).status,409);
  assert.equal((await call('approve',{}, {session_type:'driver',driver_id:owner})).status,403);
  let result=await call('approve');assert.equal(result.status,200,JSON.stringify(result));row=result.body.data;
  assert.equal((await call('approve')).status,200);assert.equal(fixture.vehicle_loan_actions.length,1);
  assert.equal((await call('return',{actual_return_at:new Date().toISOString()},foreign)).status,403);
  assert.equal((await call('return',{actual_return_at:before,expected_updated_at:null},own)).status,409);
  assert.equal((await call('return',{actual_return_at:new Date(Date.now()+3600000).toISOString()},own)).status,400);
  assert.equal((await call('return',{actual_return_at:new Date(Date.now()-7200000).toISOString()},own)).status,400);
  result=await call('return',{actual_return_at:new Date().toISOString()},own);assert.equal(result.status,200,JSON.stringify(result));row=result.body.data;
  assert.equal(row.status,'return_pending');assert.equal(fixture.vehicle_loans.length,1);
  assert.equal((await call('close',{},own)).status,403);
  result=await call('close');assert.equal(result.status,200);row=result.body.data;assert.equal(row.status,'completed');
  assert.equal((await call('close')).status,200);assert.equal(fixture.vehicle_loan_actions.length,3);
  const second={...row,id:randomUUID(),status:'approved',updated_at:null,actual_return_at:null,closed_at:null};fixture.vehicle_loans.push(second);row=second;
  result=await call('return',{actual_return_at:new Date().toISOString()});assert.equal(result.status,200,'super-admin can register a return on behalf of staff');
  fixture.vehicle_loans.push({...second,id:randomUUID(),status:'pending_approval'});row=fixture.vehicle_loans.at(-1);
  assert.equal((await call('approve')).status,400,'a vehicle awaiting return closure is not available for another overlapping approval');
  assert.equal(JSON.stringify(fixture.vehicles),original,'loans never alter assigned drivers or history');
  await helper.db.exec('set role authenticated');
  await assert.rejects(helper.db.query('select * from vehicle_loan_actions'),/permission denied/);
  await assert.rejects(helper.db.query("select apply_vehicle_loan_action(null,'close',null,null,'{}',true)"),/permission denied/);
  await helper.db.exec('reset role');
  console.log('PASS: loan owner/super-admin returns, permissions, chronological dates, stale updates, duplicate clicks, conflict approval, closure and preserved driver history.');
 }finally{await helper.close();}
 // Simulate restarting the preview with its saved fixture and audit history.
 const restored=preview(fixture);try{const done=fixture.vehicle_loans.find(row=>row.status==='completed');const response=await restored.handle({id:done.id,operation:'close',expected_updated_at:done.updated_at},admin);assert.equal(response.status,200);assert.equal(fixture.vehicle_loan_actions.length,4);}finally{await restored.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
