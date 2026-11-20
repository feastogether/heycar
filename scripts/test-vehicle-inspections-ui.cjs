const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('playwright');
const {fixture,id,today}=require('./test-local-fixture.cjs');
const root=path.resolve(__dirname,'..'),port=4194,base='http://127.0.0.1:'+port;
async function main(){
 const folder=path.join(root,'.fleet-preview','inspection-ui-'+process.pid);fs.mkdirSync(folder,{recursive:true});
 const dataFile=path.join(folder,'data.json');fs.writeFileSync(dataFile,JSON.stringify(fixture));
 const child=spawn(process.execPath,['scripts/preview-fleet-workspace.cjs'],{cwd:root,env:{...process.env,FLEET_PREVIEW_PORT:String(port),FLEET_PREVIEW_DATA:dataFile,REPORTING_PREVIEW_DB:'memory',INSPECTION_PREVIEW_DB:'memory',INSPECTION_PREVIEW_FILES:path.join(folder,'photos')},stdio:['ignore','pipe','pipe']});
 let logs='',browser;child.stdout.on('data',s=>logs+=s);child.stderr.on('data',s=>logs+=s);
 const api=async(action,body={},token='preview-admin')=>{const response=await fetch(base+'/__preview_api',{method:'POST',headers:{'content-type':'application/json','x-afide-session':token},body:JSON.stringify({action,...body})});const data=await response.json();assert(response.ok,JSON.stringify(data));return data;};
 try{
  for(let i=0;i<150;i++){try{if((await fetch(base)).ok)break;}catch{}if(child.exitCode!==null)throw Error(logs);await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({channel:'msedge',headless:true});
  const admin=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];admin.on('pageerror',e=>errors.push(e.message));
  await admin.goto(base+'/?review=admin');await admin.locator('[data-admin-view="vehicleInspections"]').waitFor({state:'attached'});
  const nav=async name=>admin.evaluate(key=>document.querySelector('[data-admin-view="'+key+'"]').click(),name);
  await nav('vehicleInspections');await admin.locator('[data-i="new"]').click();await admin.locator('[data-i-create]').waitFor();
  for(const width of [320,390,768,1440]){
    await admin.setViewportSize({width,height:960});
    const dimensions=await admin.locator('[data-i-target]').first().evaluate(input=>{const box=input.getBoundingClientRect(),text=input.nextElementSibling.getBoundingClientRect(),label=input.parentElement.getBoundingClientRect();return {width:box.width,height:box.height,textLeft:text.left,boxRight:box.right,textRight:text.right,labelRight:label.right};});
    assert.equal(dimensions.width,18,'target checkbox width at '+width);assert.equal(dimensions.height,18,'target checkbox height at '+width);assert(dimensions.textLeft>=dimensions.boxRight,'name is beside checkbox');assert(dimensions.textRight<=dimensions.labelRight,'name fits target row');
    assert(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'target list fits viewport '+width);
  }
  await admin.setViewportSize({width:1440,height:960});
  await admin.locator('[data-i-create] [name=title]').fill('每月車況檢查');await admin.locator('[data-i-create] [name=due_on]').fill(today);
  await admin.locator('[data-i-target]').first().check();await admin.locator('[data-i-create] [type=submit]').click();await admin.locator('[data-dialog-confirm]').click();
  await admin.locator('.vi-task-card').waitFor();let loaded=(await api('inspection_load')).data;assert.equal(loaded.total,1);const taskId=loaded.tasks[0].task.id;
  const driver=await browser.newPage({viewport:{width:390,height:844}});driver.on('pageerror',e=>errors.push(e.message));await driver.goto(base+'/?review=driver');
  await driver.locator('[data-view="vehicleInspections"]').click();await driver.locator('[data-i-task]').click();await driver.locator('[data-i-camera]').waitFor({state:'attached'});
  assert.equal(await driver.locator('.vi-capture-panel').count(),0,'obsolete middle guide is removed');
  assert.equal(await driver.locator('[data-i-camera]').getAttribute('capture'),'environment');
  assert.equal(await driver.locator('.vi-photo-image .vi-position-guide svg').count(),10,'each empty photo tile shows its own positional guide');
  assert.equal(await driver.locator('.vi-photo-caption .vi-take-photo').count(),10,'every editable position invites direct photography');
  await driver.screenshot({path:path.join(root,'.fleet-preview/inspection-position-guides-mobile.png'),fullPage:true});
  for(const width of [320,390,768]){await driver.setViewportSize({width,height:844});assert(await driver.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'inspection fits '+width);}
  await driver.setViewportSize({width:390,height:844});
  await driver.locator('[name=inspection_odometer]').fill('123456');await driver.locator('[name=inspection_notes]').fill('測試外觀與儀表');
  const slots=['front','front_right','right','rear_right','rear','rear_left','left','front_left','cabin','odometer'];
  let number=0;
  const shoot=async slot=>{
    const chooserPromise=driver.waitForEvent('filechooser');
    await driver.locator('[data-i-slot="'+slot+'"]').click();
    const chooser=await chooserPromise;
    const encoded=await driver.evaluate(n=>{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const ctx=canvas.getContext('2d');ctx.fillStyle='hsl('+n*23+',60%,50%)';ctx.fillRect(0,0,640,480);ctx.fillStyle='#fff';ctx.font='40px sans-serif';ctx.fillText('Angle '+n,80,240);return canvas.toDataURL('image/png').split(',')[1];},++number);
    const response=driver.waitForResponse(async response=>response.url().endsWith('/__preview_api')&&response.request().postDataJSON()?.action==='inspection_photo');
    await chooser.setFiles({name:slot+'.png',mimeType:'image/png',buffer:Buffer.from(encoded,'base64')});
    const result=await response;assert.equal(result.status(),200,await result.text());await driver.locator('[data-i-camera]:not([disabled])').waitFor({state:'attached'});
  };
  for(const slot of slots)await shoot(slot);
  await driver.screenshot({path:path.join(root,'.fleet-preview/inspection-driver-mobile.png'),fullPage:true});
  assert.equal(await driver.locator('.vi-photo-card.has-photo').count(),10);assert.equal(await driver.locator('[name=inspection_odometer]').inputValue(),'123456','uploads preserve unsaved mileage');
  await driver.locator('[data-i="draft"]').click();await driver.getByText('草稿已保存。',{exact:true}).waitFor();await driver.reload();await driver.locator('[data-view=vehicleInspections]').click();await driver.locator('[data-i-task]').click();await driver.locator('.vi-photo-card.has-photo').first().waitFor();assert.equal(await driver.locator('[name=inspection_odometer]').inputValue(),'123456');
  await driver.locator('[data-i="submit"]').click();await driver.locator('[data-dialog-confirm]').click();await driver.getByText('已送出檢查，等待車輛部審核。',{exact:true}).waitFor();assert.equal(await driver.locator('[data-i-camera]').count(),0);
  await admin.locator('[data-i="refresh"]').click();await admin.locator('[data-i-task]').click();await admin.locator('[data-i="approve"]').waitFor();
  await admin.locator('[data-i-review]').locator('..').locator('summary').click();await admin.locator('[data-i-review] [value=front]').check();await admin.locator('[data-i-review] [value=odometer]').check();await admin.locator('[data-i-review] [name=reason]').fill('車頭與儀表請補拍');await admin.locator('[data-i-review] [type=submit]').click();await admin.locator('[data-dialog-confirm]').click();
  await admin.getByText('補拍說明：',{exact:false}).waitFor();
  await driver.reload();await driver.locator('[data-view=vehicleInspections]').click();await driver.locator('[data-i-task]').click();await driver.locator('[data-i-camera]').waitFor({state:'attached'});await driver.locator('[data-i-slot=right]').click();assert.equal(await driver.locator('[data-i-camera]').count(),0,'other angles are locked during supplements');
  await shoot('front');await shoot('odometer');await driver.locator('[data-i="submit"]').click();await driver.locator('[data-dialog-confirm]').click();await driver.getByText('已送出檢查，等待車輛部審核。',{exact:true}).waitFor();
  await admin.locator('[data-i="refresh"]').click();await admin.locator('[data-i="approve"]').click();await admin.locator('[data-dialog-confirm]').click();await admin.getByText('已審核通過，照片及里程已鎖定。',{exact:true}).waitFor();
  await admin.locator('[data-i-preview]').first().click();await admin.locator('dialog.vi-photo-viewer').waitFor();assert(await admin.locator('dialog.vi-photo-viewer img').evaluate(img=>img.complete&&img.naturalWidth>0));await admin.locator('dialog.vi-photo-viewer button').click();
  for(const width of [320,390,768,1440]){await admin.setViewportSize({width,height:900});assert(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'admin inspection fits '+width);}
  await admin.screenshot({path:path.join(root,'.fleet-preview/inspection-admin-desktop.png'),fullPage:true});
  const final=(await api('inspection_load',{task_id:taskId,history:true})).data;assert.equal(final.task.status,'approved');assert.equal(final.photos.length,12);
  await admin.locator('[data-i=back]').click();await admin.locator('[data-i=batches]').click();await admin.locator('.vi-batch-list article').waitFor();
  assert(/^\d{8}-\d{3,}$/.test(await admin.locator('.vi-batch-list strong').first().textContent()));
  await admin.setViewportSize({width:390,height:900});
  assert(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'batch manager fits mobile');
  await admin.screenshot({path:path.join(root,'.fleet-preview/inspection-batches-mobile.png')});
  await admin.locator('[data-i-batch-action=delete]').click();await admin.locator('[data-dialog-confirm]').click();await admin.getByText('目前沒有符合條件的批次。',{exact:true}).waitFor();
  assert.equal((await api('inspection_load',{status:'approved'},'preview-driver')).data.total,0,'deleted batches are hidden from driver history');
  await admin.locator('[data-i=batches-deleted]').click();await admin.locator('[data-i-batch-action=restore]').click();await admin.locator('[data-dialog-confirm]').click();
  await admin.getByText('目前沒有已刪除的批次。',{exact:true}).waitFor();await admin.locator('[data-i=batches-active]').click();await admin.locator('.vi-batch-list article').waitFor();
  const restored=(await api('inspection_load',{task_id:taskId,history:true})).data;assert.equal(restored.photos.length,12,'batch deletion retains all photo versions');assert((await fetch(restored.photos[0].url)).ok,'restored original photo is still downloadable');
  assert.equal((await api('inspection_load',{status:'approved'},'preview-driver')).data.total,1);
  // Complete a real UI borrow -> approval -> return -> closure cycle.
  await admin.setViewportSize({width:1440,height:900});await nav('vehicleLoans');await admin.locator('[data-modal=vehicleLoan]').first().click();
  await admin.locator('#modalForm [name=vehicle_id]').selectOption(id(11));
  const local=value=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(value).replace(' ','T');
  await admin.locator('#modalForm [name=borrow_at]').fill(local(new Date(Date.now()-3600000)));await admin.locator('#modalForm [name=return_at]').fill(local(new Date(Date.now()+3600000)));await admin.locator('#modalForm [type=submit]').click();await admin.locator('#modalForm').waitFor({state:'hidden'});
  await admin.locator('[data-loan-action$=":approve"]').click();await admin.locator('[data-dialog-confirm]').click();await admin.locator('[data-modal=vehicleReturn]').waitFor();
  await admin.locator('[data-modal=vehicleReturn]').click();await admin.locator('#modalForm [type=submit]').click();await admin.locator('#modalForm').waitFor({state:'hidden'});await admin.locator('[data-loan-action$=":close"]').click();await admin.locator('[data-dialog-confirm]').click();
  await admin.locator('.loan-list .empty').waitFor();assert.equal((await api('load')).data.vehicle_loans[0].status,'completed');
  for(const width of [320,390,768,1440]){await admin.setViewportSize({width,height:900});assert(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'loans fit '+width);assert.equal(await admin.locator('.loan-compact-summary').getAttribute('open'),null);assert.equal(await admin.locator('.loan-compact-filters').getAttribute('open'),null);}
  assert.deepEqual(errors,[]);console.log('PASS: inspection UI create, camera compression, 10 photos, draft reload, submit, targeted supplements, review, private zoom, mobile layout and complete loan/return/closure UI.');
 }finally{await browser?.close();child.kill();await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));const resolved=path.resolve(folder);if(!resolved.startsWith(path.join(root,'.fleet-preview')+path.sep)||!resolved.endsWith('inspection-ui-'+process.pid))throw Error('Unsafe cleanup');fs.rmSync(resolved,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
