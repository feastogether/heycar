const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const createPreview=require('./preview-reporting-db.cjs');
async function main(){
 process.env.REPORTING_PREVIEW_DB='memory';
 const dealer=randomUUID(),other=randomUUID(),drivers=[1,2].map(n=>({id:randomUUID(),name:'測試司機'+n,dealer_partner_id:dealer,driver_status:'跑趟中'}));
 const preview=createPreview([{id:dealer,name:'亞菲得股份有限公司',partner_type:'dealer',active:true},{id:other,name:'其他車商',partner_type:'dealer',active:true}],drivers);
 const admin={session_type:'admin',is_super_admin:true},driver={session_type:'driver',driver_id:drivers[0].id};
 const call=(action,body={},session=admin)=>preview.handle({action,...body},session);
 try{
  const month=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit'}).format(new Date());
  let data=(await call('load_driver_reporting',{month})).body.data;
  const first={start_on:month+'-01',end_on:month+'-10',max_days:1},second={start_on:month+'-05',end_on:month+'-20',max_days:2};
  const config={is_open:true,opens_on:data.server_today,closes_on:data.server_today,allowed_days:4,blocked_dates:[],range_rules:[first,second]};
  let result=await call('save_driver_reporting_month',{month,revision:0,config});assert.equal(result.status,200,JSON.stringify(result));let revision=result.body.data.revision;
  result=await call('submit_driver_reporting',{month,revision,dates:[month+'-01',month+'-02'],confirmed:true},driver);assert.equal(result.status,409,'server enforces range quota even when UI is bypassed');
  result=await call('submit_driver_reporting',{month,revision,dates:[month+'-06',month+'-11',month+'-12'],confirmed:true},driver);assert.equal(result.status,409,'overlapping range limits are enforced together');
  result=await call('submit_driver_reporting',{month,revision,dates:[month+'-01',month+'-11',month+'-12',month+'-21',month+'-22'],confirmed:true},driver);assert.equal(result.status,200,JSON.stringify(result));const saved=result.body.data;assert.equal(saved.off_dates.length,5,'monthly soft quota still allows supervisor review');assert.deepEqual(saved.range_rules,[first,second]);
  const invalid={...config,range_rules:[{start_on:month+'-01',end_on:month+'-23',max_days:1}]};assert.equal((await call('save_driver_reporting_month',{month,revision,config:invalid})).status,409,'new settings never invalidate existing submitted dates');
  const oldClient={...config};delete oldClient.range_rules;result=await call('save_driver_reporting_month',{month,revision,config:oldClient});assert.equal(result.status,200);revision=result.body.data.revision;assert.deepEqual(result.body.data.range_rules,[first,second],'an older client cannot accidentally erase range limits');
  result=await call('save_driver_reporting_month',{month,revision,config:{...config,range_rules:[{...first,max_days:3}]}});assert.equal(result.status,200);const loaded=(await call('load_driver_reporting',{month},driver)).body.data;assert.deepEqual(loaded.rows[0].submission.range_rules,[first,second],'a submitted report retains its own rule snapshot');
  assert.equal((await call('save_driver_reporting_month',{month,revision:result.body.data.revision,config:{...config,range_rules:[{...first,start_on:'2027-01-01'}]}})).status,409);
  assert.equal((await call('save_driver_reporting_month',{month,revision:result.body.data.revision,config:{...config,range_rules:[{...first,max_days:1.5}]}})).status,409);
  assert.equal((await call('save_driver_reporting_month',{month,revision,config},driver)).status,403);
  console.log('PASS: date-range hard limits, overlapping ranges, monthly soft review, legacy-client preservation, immutable submitted rule snapshots, conflict/date/number checks and role isolation.');
 }finally{await preview.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
