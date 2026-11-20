const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),port=4193,base='http://127.0.0.1:'+port;
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const dealer=id(1),other=id(2),driver='20000000-0000-4000-8000-000000000001';
const alternateDriver='20000000-0000-4000-8000-000000000002';
const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(new Date());
const fixture={
 dealers:[{id:dealer,name:'亞菲得股份有限公司',partner_type:'dealer',active:true},{id:other,name:'士弘國際租賃有限公司',partner_type:'dealer',active:true}],
 vehicles:[1,2].map((n)=>({id:id(10+n),plate_no:n===1?'RFS-3203':'RFS-3204',dealer_partner_id:dealer,brand:'Toyota',model:'測試車型',current_driver_id:driver,assigned_driver_names:'測試司機',show_idle_report:true,show_maintenance_report:true,driver_history:[{driver_id:driver,driver_name:'測試司機'}],vehicle_files:[],updated_at:null})),
 fines:[],updates:[],files:[],idle:[{vehicle_id:id(11),record_date:today,drive_mins:600,idle_mins:70,mileage:300,driver_name:'測試司機'}],
 fuel:[{vehicle_id:id(11),last_fill_date:today,last_fill_mileage:100000,avg_daily_km:300}],
 policies:[{id:id(30),vehicle_id:id(11),company:'測試保險公司',insurance_type:'任意險'}],
 calendar:[{id:id(31),vehicle_id:id(11),plate_no:'RFS-3203',event_type:'maintenance',event_date:today,driver_id:driver,vendor:'測試保養廠',content:'十萬公里保養'}],
 baselines:[{id:id(40),vehicle_id:id(11),plate_no:'RFS-3203',record_type:'定期保養',service_date:today,odometer:90000,complaint:'定期保養需求',actual_work_performed:'更換機油與濾芯',total_cost:3650,tax_mode:'未稅',parts_json:[{record_type:'定期保養',part_no:'OIL-001',name:'長名稱保養用機油與濾芯測試文字',quantity:1,unit_price:3650,amount:3650}]}],
 staff_users:[{id:id(50),name:'測試夥伴',active:true,permissions:{fleetOperations:false},extension:'1234'}]
};
fixture.baselines[0].service_date=new Date(Date.parse(today)-40*86400000).toISOString().slice(0,10);
fixture.vehicles[1].current_driver_id=alternateDriver;
fixture.vehicles[1].driver_history=[];
fixture.drivers=[
 {id:driver,name:'測試司機一',dealer_partner_id:dealer,fleet_name:'亞菲得股份有限公司',driver_status:'待上線',onboarding_progress:{notes:'原始進度備註',unknown_field:'保留'},updated_at:null},
 {id:alternateDriver,name:'測試司機二',dealer_partner_id:dealer,fleet_name:'亞菲得股份有限公司',driver_status:'跑趟中',onboarding_progress:{notes:'原始進度備註'},updated_at:null},
 {id:'20000000-0000-4000-8000-000000000003',name:'測試待上線司機',dealer_partner_id:dealer,fleet_name:'亞菲得股份有限公司',driver_status:'待上線',onboarding_progress:{notes:'原始進度備註'},updated_at:null}
];
async function main(){
 const dataFile=path.join(root,'.fleet-preview','qa-workspace-'+process.pid+'.json');fs.writeFileSync(dataFile,JSON.stringify(fixture));
 const child=spawn(process.execPath,['scripts/preview-fleet-workspace.cjs'],{cwd:root,env:{...process.env,FLEET_PREVIEW_PORT:String(port),FLEET_PREVIEW_DATA:dataFile,REPORTING_PREVIEW_DB:'memory'},stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',s=>logs+=s);child.stderr.on('data',s=>logs+=s);
 let browser;
 const api=async(action,body={},token='preview-admin')=>{
   const response=await fetch(base+'/__preview_api',{method:'POST',headers:{'content-type':'application/json','x-afide-session':token},body:JSON.stringify({action,...body})});
   const value=await response.json();assert(response.ok,JSON.stringify(value));return value;
 };
 try{
  for(let i=0;i<100;i++){try{if((await fetch(base)).ok)break;}catch{}if(child.exitCode!==null)throw Error(logs);await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/?review=admin');await page.locator('[data-admin-view="vehicles"]').waitFor({state:'attached'});
  const nav=async name=>{await page.evaluate(key=>document.querySelector('[data-admin-view="'+key+'"]').click(),name);};
  await nav('adminUsers');await page.locator('[data-modal="adminUser"][data-id]').click();
  const permission=page.locator('#modalForm input[type=checkbox][name="permission_fleetOperations"]');await permission.check();
  await page.locator('#modalForm [type=submit]').click();await page.locator('#modalForm').waitFor({state:'hidden'});
  await page.locator('[data-modal="adminUser"][data-id]').click();assert(await permission.isChecked());await page.locator('#modalForm [data-close-modal]').click();
  assert((await api('load')).data.admin_users[0].permissions.fleetOperations);
  await nav('vehicles');const menu=page.locator('[aria-controls="adminSidebar"]');if(await menu.getAttribute('aria-expanded')==='false')await menu.click();
  const scrolled=await page.evaluate(()=>{const nav=document.querySelector('.side-nav');nav.scrollTop=200;const side=document.querySelector('.admin-sidebar');side.scrollTop=200;return [nav.scrollTop,side.scrollTop];});assert(scrolled.some(value=>value>0),'sidebar was actually scrolled');
  await nav('serviceRecords');assert.deepEqual(await page.evaluate(()=>[document.querySelector('.side-nav').scrollTop,document.querySelector('.admin-sidebar').scrollTop]),scrolled);
  if(await menu.getAttribute('aria-expanded')==='true')await menu.click();
  for(const width of [320,390,768,1440]){
   await page.setViewportSize({width,height:900});await nav('vehicles');const actions=page.locator('.vehicle-row-actions').first();await actions.waitFor();
   assert.deepEqual((await actions.locator('button').allTextContents()).map(s=>s.trim()),['資料','保單','罰單','編輯']);
   const tops=await actions.locator('button').evaluateAll(buttons=>buttons.map(b=>b.getBoundingClientRect().top));assert(Math.max(...tops)-Math.min(...tops)<2);
   assert.equal(await actions.locator('[data-delete]').count(),0);await actions.locator('[data-modal="vehicle"]').click();assert.equal(await page.locator('#modalForm [data-delete^="vehicles:"]').count(),1);await page.locator('#modalForm [data-close-modal]').click();
   await nav('serviceRecords');await page.locator('.service-record-row').waitFor();assert((await page.locator('.service-record-main').innerText()).includes('送修原因'));assert((await page.locator('.service-record-main').innerText()).includes('實際維修'));
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'viewport '+width);
   assert(await page.locator('.service-parts-summary').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'parts fit '+width);
   await page.locator('.service-record-row [data-modal="serviceRecord"]').click();
   assert(await page.locator('.service-editor-modal').evaluate(el=>el.getBoundingClientRect().right<=innerWidth+1),'editor fits '+width);
   assert(await page.locator('.service-parts-editor').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'parts editor fits '+width);
   await page.locator('#modalForm [data-close-modal]').click();
  }
  await page.setViewportSize({width:1440,height:900});await nav('idleManagement');await page.locator('.fleet-idle-table').waitFor();assert.equal(await page.getByText('車輛怠速週報',{exact:true}).count(),0);
  assert.equal(await page.locator('.fleet-frozen-column').first().evaluate(el=>getComputedStyle(el).textAlign),'center');
  await page.locator('.userbox [data-own-avatar]').click();const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=40;const x=c.getContext('2d');x.fillStyle='#b68a46';x.fillRect(0,0,40,40);return c.toDataURL('image/png');});
  await page.locator('[data-own-avatar-file]').setInputFiles({name:'test-avatar.png',mimeType:'image/png',buffer:Buffer.from(image.split(',')[1],'base64')});await page.locator('[data-own-avatar-save]:not([disabled])').waitFor();await page.locator('[data-own-avatar-save]').click();await page.locator('.own-avatar-editor').waitFor({state:'hidden'});assert((await page.locator('.userbox [data-own-avatar] img').getAttribute('src')).startsWith('data:image/jpeg'));
  await nav('maintenanceManagement');await page.locator('[data-fleet-forecast-layout=table]').click();await page.locator('.forecast-ledger').waitFor();assert.equal(await page.locator('.forecast-ledger thead th').count(),17);assert.equal(await page.locator('.forecast-ledger td[data-kind=maintenance]').first().evaluate(el=>getComputedStyle(el).whiteSpace),'nowrap');assert(await page.locator('.fleet-forecast-scroll').evaluate(el=>el.scrollHeight<=el.clientHeight+1),'no nested vertical table scroll');await page.screenshot({path:path.join(root,'.fleet-preview/nov20-maintenance-table.png'),fullPage:true});await page.locator('[data-fleet-forecast-layout=cards]').click();await page.locator('[data-fleet-schedule]').first().waitFor();await page.locator('[data-fleet-schedule]').first().click();
  assert.equal(await page.locator('#modalForm input[name=driver_id]:checked').inputValue(),driver,'opening a schedule automatically selects the vehicle current driver');
  await page.locator('#modalForm [name=vehicle_id]').selectOption(id(12));
  assert.equal(await page.locator('#modalForm input[name=driver_id]:checked').inputValue(),alternateDriver,'changing vehicle selects its current driver');
  await page.locator('#modalForm [name=vehicle_id]').selectOption(id(11));await page.locator('#modalForm input[name=driver_id][value="'+driver+'"]').check();await page.locator('#modalForm [name=vendor]').selectOption('測試保養廠');await page.locator('#modalForm [name=content]').fill('十萬公里定期保養');await page.locator('#modalForm [type=submit]').click();await page.locator('#modalForm').waitFor({state:'hidden'});
  const scheduled=(await api('load')).data.calendar_events.find(row=>row.maintenance_notification_id);assert(scheduled);
  assert.equal(scheduled.driver_id,driver);
  await page.locator('[data-modal="calendarEvent"][data-id="'+scheduled.id+'"]').first().click();
  await page.locator('#modalForm input[name=driver_id][value="'+alternateDriver+'"]').check();
  await page.locator('#modalForm [type=submit]').click();await page.locator('#modalForm').waitFor({state:'hidden'});
  await page.locator('[data-modal="calendarEvent"][data-id="'+scheduled.id+'"]').first().click();
  assert.equal(await page.locator('#modalForm input[name=driver_id]:checked').inputValue(),alternateDriver,'editing preserves the previously selected alternate driver');
  await page.locator('#modalForm [data-close-modal]').click();
  assert.equal((await api('load')).data.vehicles.find(row=>row.id===id(11)).current_driver_id,driver,'reassigning maintenance leaves vehicle driver unchanged');
  const driverPage=await browser.newPage({viewport:{width:390,height:844}});await driverPage.goto(base+'/?review=driver2');await driverPage.locator('[data-view="maintenance"]').click();await driverPage.locator('[data-task-status$=":completed"]').click();await driverPage.locator('.benefit-photo-modal [name=odometer]').fill('100000');
  for(const [i,slot]of ['tire_fl','tire_fr','tire_rl','tire_rr','work_order'].entries()){const bytes=await driverPage.evaluate(index=>{const c=document.createElement('canvas');c.width=c.height=80;const x=c.getContext('2d');x.fillStyle='hsl('+(index*55)+',70%,50%)';x.fillRect(0,0,80,80);return c.toDataURL('image/jpeg').split(',')[1];},i);const saved=driverPage.waitForResponse(r=>r.url().endsWith('/__preview_api')&&r.request().postDataJSON()?.action==='operation_photo');await driverPage.locator('[data-benefit-photo='+slot+']').setInputFiles({name:slot+'.jpg',mimeType:'image/jpeg',buffer:Buffer.from(bytes,'base64')});assert.equal((await saved).status(),200);await driverPage.locator('[data-photo-tile='+slot+'] [data-photo-status]').filter({hasText:'已保存'}).waitFor();}
  await driverPage.locator('.benefit-photo-modal [type=submit]').click();await driverPage.locator('.benefit-photo-modal').waitFor({state:'detached'});
  await driverPage.locator('[data-task-status$=":completed"]').waitFor({state:'hidden'});
  const loaded=(await api('load')).data;assert(loaded.calendar_events.find(row=>row.id===scheduled.id).completed_at);assert.equal(loaded.vehicle_service_records.length,1,'driver completion did not create history');
  await page.reload();await page.locator('[data-admin-view="serviceRecords"]').waitFor({state:'attached'});await nav('maintenanceManagement');await page.getByText('已完成・待工單',{exact:true}).first().waitFor();await page.locator('[data-fleet-forecast-layout=table]').click();await page.locator('.forecast-ledger [data-workorder-schedule="'+scheduled.id+'"]').waitFor();await nav('serviceRecords');await page.locator('[data-workorder-schedule="'+scheduled.id+'"]').click();await page.locator('#modalForm [name=complaint]').fill('定期保養');await page.locator('#modalForm [type=submit]').click();await page.locator('#modalForm').waitFor({state:'hidden'});
  assert.equal(await page.locator('[data-workorder-schedule="'+scheduled.id+'"]').count(),0);
  assert.equal((await api('load')).data.vehicle_service_records.length,2);
  await page.reload();await page.locator('[data-admin-view="adminUsers"]').waitFor({state:'attached'});await nav('adminUsers');await page.locator('[data-modal="adminUser"][data-id]').click();assert(await permission.isChecked());
  await page.locator('#modalForm [data-close-modal]').click();
  await page.reload();await page.locator('[data-admin-view=driverOnboarding]').waitFor({state:'attached'});await page.setViewportSize({width:390,height:900});await nav('driverOnboarding');
  await page.locator('[data-onboarding-close="'+'20000000-0000-4000-8000-000000000003'+'"]').click();
  assert.equal(await page.locator('[data-onboarding-close-form] [name="driver_status"]').inputValue(),'');
  assert(await page.locator('.onboarding-close-dialog').evaluate(el=>el.getBoundingClientRect().right<=innerWidth+1));
  await page.locator('[data-onboarding-close-cancel]').click();assert.equal((await api('load')).data.drivers.find(row=>row.id==='20000000-0000-4000-8000-000000000003').driver_status,'待上線');
  await page.locator('[data-onboarding-close="'+'20000000-0000-4000-8000-000000000003'+'"]').click();
  await page.locator('[data-onboarding-close-form] [name="driver_status"]').selectOption('跑趟中');
  await page.locator('[data-onboarding-close-form] [type="submit"]').click();await page.locator('.onboarding-row.is-completed').waitFor();
  const finished=(await api('load')).data.drivers.find(row=>row.id==='20000000-0000-4000-8000-000000000003');assert.equal(finished.driver_status,'跑趟中');assert(finished.onboarding_completed_at);assert.equal(finished.onboarding_progress.notes,'原始進度備註');
  await page.locator('[data-onboarding-filter="active"]').click();await page.locator('[data-modal="driverOnboarding"][data-id="'+driver+'"]').click();
  await page.locator('#modalForm [name="onboarding_completed_at"]').fill(today);await page.locator('#modalForm [type=submit]').click();
  assert.equal(await page.locator('.modal-backdrop:visible').count(),1,'status selection replaces the visible progress editor');
  await page.locator('[data-onboarding-close-cancel]').click();await page.locator('#modalForm').waitFor();
  assert.equal((await api('load')).data.drivers.find(row=>row.id===driver).driver_status,'待上線');
  await page.setViewportSize({width:320,height:900});await page.locator('#modalForm [type=submit]').click();
  assert(await page.locator('.onboarding-close-dialog').evaluate(el=>el.getBoundingClientRect().right<=innerWidth+1));
  await page.locator('[data-onboarding-close-form] [name="driver_status"]').selectOption('停派中');await page.locator('[data-onboarding-close-form] [type=submit]').click();await page.locator('#modalForm').waitFor({state:'hidden'});
  const stopped=(await api('load')).data.drivers.find(row=>row.id===driver);assert.equal(stopped.driver_status,'停派中');assert.equal(stopped.onboarding_progress.unknown_field,'保留');
  const report=await api('load_driver_reporting',{month:today.slice(0,7)});assert(!report.data.rows.some(row=>row.driver_id===driver),'status change immediately updates reporting eligibility');assert(report.data.rows.some(row=>row.driver_id==='20000000-0000-4000-8000-000000000003'));
  assert.deepEqual(errors,[]);console.log('PASS: workspace permissions, responsive fleet UI, maintenance completion flow, onboarding status selection/cancellation, progress-editor closure and immediate reporting eligibility update.');
 }finally{if(browser)await browser.close();child.kill();await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));fs.unlinkSync(dataFile);const photoFolder=path.resolve(dataFile+'.benefit-files');if(!photoFolder.startsWith(path.join(root,'.fleet-preview')+path.sep)||!photoFolder.endsWith('qa-workspace-'+process.pid+'.json.benefit-files'))throw Error('Unsafe test cleanup');fs.rmSync(photoFolder,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
