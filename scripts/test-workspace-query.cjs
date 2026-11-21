const assert=require('node:assert/strict'),{randomUUID}=require('crypto');
const {fixture:base,today}=require('./test-local-fixture.cjs');
(async()=>{
 const fixture=structuredClone(base);fixture.payment_notices=Array.from({length:123},(_,i)=>({id:randomUUID(),driver_id:fixture.drivers[i%3].id,fee_type:i%2?'薪資':'通行費',amount:i+1,status:i%3?'pending':'paid',due_date:today,created_at:new Date().toISOString(),content:i===0?'_% literal':'測試'}));
 fixture.calendar.push({id:randomUUID(),plate_no:'TEST-0000',event_type:'maintenance',event_date:'2026-11-21',completed_at:'2026-11-20T17:00:00Z'});
 fixture.insurance_requests=[{id:randomUUID(),plate_no:'TEST-0001',status:'broker_returned'}];
 fixture.fines=[{id:randomUUID(),plate_no:'TEST-0002',status:'已繳待核對',review_state:'verified',paid_date:today,due_date:'2020-01-01'},{id:randomUUID(),plate_no:'TEST-0003',status:'已繳',review_state:'verified'}];
 const db=require('./preview-office-db.cjs')(fixture),{createWorkspaceQueryHandler,workspaceViews}=await import('../supabase/functions/data-api/workspace-query.mjs');
 const handler=createWorkspaceQueryHandler({db,adminCan:async(s,p)=>s.permissions.includes(p)}),admin={session_type:'admin',permissions:['payments','fleetCases','insuranceCenter','serviceRecords','maintenanceManagement']};
 try{
  assert.deepEqual(workspaceViews.payments,[]);assert(!workspaceViews.vehicles.includes('payment_notices'));assert(!workspaceViews.vehicles.includes('insurance_requests'));
  const call=(body,s=admin)=>handler(body,s);
  assert.equal((await call({action:'payment_page'}, {...admin,session_type:'driver'})).status,403);
  assert.equal((await call({action:'payment_page'}, {...admin,permissions:[]})).status,403);
  for(const bad of [{page:-1},{page:1.5},{filters:{status:'bad'}},{filters:{dealer:'bad'}},{filters:{from:'2026-13-40'}},{filters:{query:'x'.repeat(121)}}]){
   const result=await call({action:'payment_page',...bad});assert.equal(result.status,400);
  }
  const recordHandler=createWorkspaceQueryHandler({db:{from:()=>({select(){return this;},eq(){return this;},single:async()=>({data:{id:fixture.drivers[0].id,photo_url:'original',id_card_files:['keep']}})})},adminCan:async(s,p)=>s.permissions.includes(p)});
  assert.equal((await recordHandler({action:'workspace_record',table:'drivers',id:fixture.drivers[0].id},admin)).status,403);
  const record=(await recordHandler({action:'workspace_record',table:'drivers',id:fixture.drivers[0].id},{...admin,permissions:['drivers']})).body.data;assert.deepEqual(record.id_card_files,['keep']);
  const one=(await call({action:'payment_page',page:1,directory:true})).body,two=(await call({action:'payment_page',page:2})).body;
  assert.equal(one.rows.length,50);assert.equal(one.total,123);assert.equal(one.drivers.length,3);assert(!('drivers'in two));assert.equal(two.rows.length,50);assert(!one.rows.some(row=>two.rows.some(other=>other.id===row.id)));
  assert.equal(one.pending_amount,fixture.payment_notices.filter(row=>row.status==='pending').reduce((sum,row)=>sum+row.amount,0));
  assert.equal((await call({action:'payment_page',filters:{query:'_%'}})).body.total,1,'search punctuation is literal');
  const dealer=fixture.dealers[1].id;assert.equal((await call({action:'payment_page',filters:{dealer}})).body.total,41);
  assert.equal((await call({action:'payment_page',page:100})).body.page,3);
  let todos=(await call({action:'office_todos'})).body;assert.equal(todos.groups.find(g=>g.key==='service_orders').items[0].date,'2026-11-21','completion day is Taipei rather than UTC');assert.equal(todos.groups.find(g=>g.key==='insurance').count,1);const fines=todos.groups.find(g=>g.key==='fines');assert.equal(fines.count,1);assert.equal(fines.items[0].urgency,'normal','reported paid needs review rather than false overdue');
  todos=(await call({action:'office_todos'}, {...admin,permissions:[]})).body;assert.equal(todos.groups.length,0,'no unauthorized counts or records');
  const count=await db.db.query('select count(*)::integer as n from payment_notices');assert.equal(count.rows[0].n,123);
  console.log('PASS: read-only SQL paging/filtered totals/literal query/stable pages/permission-aware todos and preserved records');
 }finally{await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
