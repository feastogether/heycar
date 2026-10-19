const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { stripTypeScriptTypes } = require('node:module');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const backend = stripTypeScriptTypes(fs.readFileSync(path.join(root, 'supabase/functions/data-api/index.ts'), 'utf8')).replace(/^import .*$/m, '');
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9F0AAAAASUVORK5CYII=';
const today = new Intl.DateTimeFormat('sv-SE', { timeZone:'Asia/Taipei' }).format(new Date());
const users = [{id:'me',name:'王小明',active:true,extension:'123',avatar_url:'',permissions:{}}, {id:'amy',name:'陳美麗',active:true,extension:'456',avatar_url:pixel,permissions:{}}];
const tables = vm.runInNewContext(app.match(/const tables = (\[[\s\S]*?\]);/)[1]);
const seed = () => ({...Object.fromEntries(tables.map(table=>[table,[]])),admin_users:structuredClone(users),staff_announcements:[{id:'notice',title:'公司會議通知',content:'這是內部會議資料，請同仁準時參加。',author_name:'王小明',pinned:true,created_at:today}],staff_calendar_events:[{id:'event',title:'每週營運會議',event_date:today,start_time:'10:00:00',end_time:'11:00:00',category:'meeting',location:'總部會議室',content:'確認本週工作',author_name:'王小明'}]});

async function backendTests() {
  const data = seed();
  data.admin_users[0].permissions = {};
  data.admin_users[1].permissions = {internalAnnouncements:true,internalCalendar:true};
  let handler;
  let session = {session_type:'admin',admin_user_id:'me',admin_name:'王小明',is_super_admin:false};
  const db = {from(table){
    let mode='select', payload, filters=[], columns='*', range=null;
    const query={
      select(value='*'){columns=value;return this},eq(key,value){filters.push(row=>row[key]===value);return this},neq(key,value){filters.push(row=>row[key]!==value);return this},order(){return this},or(){return this},range(start,end){range=[start,end];return this},
      insert(value){mode='insert';payload=value;return this},upsert(value){mode='upsert';payload=value;return this},update(value){mode='update';payload=value;return this},delete(){mode='delete';return this},
      async execute(single=false){
        let rows=(data[table]||[]).filter(row=>filters.every(fn=>fn(row)));
        if(range)rows=rows.slice(range[0],range[1]+1);
        if(mode==='insert'){rows=[{id:'new',created_at:today,...payload}];(data[table]||=[]).push(...rows)}
        if(mode==='upsert'){const current=(data[table]||[]).find(row=>row.owner_id===payload.owner_id);if(current){Object.assign(current,payload);rows=[current]}else{rows=[payload];(data[table]||=[]).push(payload)}}
        if(mode==='update')rows.forEach(row=>Object.assign(row,payload));
        if(mode==='delete')data[table]=(data[table]||[]).filter(row=>!rows.includes(row));
        if(columns!=='*')rows=rows.map(row=>Object.fromEntries(columns.split(',').map(key=>[key,row[key]])));
        return {data:structuredClone(single?(rows[0]||null):rows),error:null};
      },single(){return this.execute(true)},maybeSingle(){return this.execute(true)},then(resolve,reject){return this.execute().then(resolve,reject)}
    };return query;
  }};
  const context=vm.createContext({Deno:{env:{get:()=>''},serve:fn=>{handler=fn}},createClient:()=>db,Request,Response,Headers,Date,Map,Set,WeakMap,crypto,TextEncoder,URL,console});
  vm.runInContext(backend,context);
  context.testSession=()=>({...session});
  vm.runInContext('getSession = async () => testSession();',context);
  const request=(action,table,record,id)=>handler(new Request('https://test/',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,table,record,id})}));
  const broadcastRequest=payload=>handler(new Request('https://test/',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}));
  for(const action of ['preview_maintenance_broadcast','create_maintenance_broadcast','load_maintenance_notifications']) assert.equal((await broadcastRequest({action,fleet:'all',kinds:['receipt']})).status,403);
  const noteRequest=(payload)=>handler(new Request('https://test/',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'set_staff_note',...payload})}));
  let note=await noteRequest({content:'開會中，有事請留言',owner_id:'amy'});
  assert.equal(note.status,200);assert.equal((await note.json()).data.owner_id,'me');
  await noteRequest({content:'下午回覆'});
  assert.equal(data.staff_notes.length,1);assert.equal(data.staff_notes[0].content,'下午回覆');
  assert.equal((await noteRequest({content:'字'.repeat(61)})).status,400);
  assert.equal((await request('insert','staff_notes',{owner_id:'amy',content:'forged'})).status,403);
  assert.equal((await request('update','staff_notes',{content:'forged'},'amy')).status,403);
  await noteRequest({content:''});assert.equal(data.staff_notes[0].content,'');
  for(const table of ['staff_announcements','staff_calendar_events']) {
    assert.equal((await request('insert',table,{title:'unauthorized'})).status,403);
    assert.equal((await request('update',table,{title:'unauthorized'},'notice')).status,403);
    assert.equal((await request('delete',table,{},'notice')).status,403);
  }
  const loaded=await context.loadAdminData({...session});
  assert.equal(loaded.data.staff_announcements.length,1);
  assert.equal(loaded.data.staff_calendar_events.length,1);
  assert.equal(loaded.data.admin_users[1].extension,'456');
  assert(!('permissions' in loaded.data.admin_users[1]));
  session={...session,admin_user_id:'amy',admin_name:'陳美麗'};
  const written=await request('insert','staff_announcements',{title:'員工公告',content:'測試內文',pinned:true,author_name:'偽造者',driver_id:'should-not-exist'});
  assert.equal(written.status,200);
  const notice=(await written.json()).data;
  assert.equal(notice.author_name,'陳美麗');assert(!('driver_id' in notice));
  assert.equal((await request('update','staff_announcements',{title:'更新公告',content:'更新內容'},notice.id)).status,200);
  const event=await request('insert','staff_calendar_events',{title:'新會議',event_date:today,start_time:'09:00',end_time:'10:00',category:'meeting'});
  assert.equal(event.status,200);
  assert.equal((await request('insert','staff_calendar_events',{title:'錯誤時間',event_date:today,start_time:'11:00',end_time:'10:00'})).status,500);
  assert.equal((await request('delete','staff_announcements',{},notice.id)).status,200);
  for(const session_type of ['driver','partner']){
    session={session_type};
    assert.equal((await noteRequest({content:'forbidden'})).status,403);
    assert.equal((await request('insert','staff_announcements',{title:'拒絕',content:'拒絕'})).status,403);
    assert.equal((await request('delete','staff_calendar_events',{},'event')).status,403);
  }
  session={session_type:'admin',is_super_admin:true,admin_name:'管理員'};
  const created=await request('insert','admin_users',{id:'code-test',name:'分機測試',active:true,permissions:{},login_code:'8123',extension:'wrong'});
  assert.equal(created.status,200);assert.equal((await created.json()).data.extension,'8123');
  const codeUser=data.admin_users.find(row=>row.id==='code-test');
  await request('update','admin_users',{name:'分機測試',extension:'spoofed'},'code-test');
  assert.equal(codeUser.extension,'8123');
  await request('update','admin_users',{login_code:'9345',extension:'wrong'},'code-test');
  assert.equal(codeUser.extension,'9345');
  codeUser.extension='old';
  const logged=await handler(new Request('https://test/',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'login_admin',code:'9345'})}));
  assert.equal(logged.status,200);assert.equal((await logged.json()).admin_profile.extension,'9345');
  const home=await context.loadAdminData({...session},'home');
  assert.equal('vehicles' in home.data,false);assert.equal('dispatch_orders' in home.data,false);
  assert('staff_announcements' in home.data);
  const workspace=await context.loadAdminData({...session},'workspace');
  assert(!('staff_announcements' in workspace.data));assert('vehicles' in workspace.data);
  const fixtures={
    vehicles:[{id:'v1',plate_no:'TEST-1',dealer_partner_id:'dealer',fleet_name:'甲車隊',fuel_type:'柴油',current_driver_id:'d1'}, {id:'v2',plate_no:'TEST-2',dealer_partner_id:'dealer',fuel_type:'汽油',current_driver_id:'d2'}, {id:'v3',plate_no:'TEST-3',dealer_partner_id:'dealer',fuel_type:'柴油'}, {id:'v4',plate_no:'TEST-4',dealer_partner_id:'other',fuel_type:'柴油',current_driver_id:'d1'}, {id:'v5',plate_no:'TEST-5',dealer_partner_id:'dealer',fuel_type:'柴油',current_driver_id:'d1',status:'報廢'}, {id:'v6',plate_no:'TEST-6',dealer_partner_id:'dealer',fuel_type:'柴油',current_driver_id:'d1',driver_history:[{driver_id:'d2',end_at:'2020-01-01'}]}],
    drivers:[{id:'d1',name:'司機甲'},{id:'d2',name:'司機乙'}],dealers:[{id:'dealer',name:'甲車商',partner_type:'dealer'}]
  };
  let plan=context.maintenanceBroadcastPlan({fleet:'dealer:dealer',kinds:['diesel','receipt','diesel']},fixtures.vehicles,fixtures.drivers,fixtures.dealers,today);
  assert.equal(plan.records.length,3);assert.deepEqual(Array.from(plan.skipped),['TEST-3','TEST-6']);
  assert(!plan.records.some(row=>row.vehicle_id==='v2'&&row.kind==='diesel'));
  assert(!plan.records.some(row=>['v4','v5','v6'].includes(row.vehicle_id)));
  assert.throws(()=>context.maintenanceBroadcastPlan({fleet:'wrong',kinds:['diesel']},fixtures.vehicles,fixtures.drivers,fixtures.dealers,today));
  assert.throws(()=>context.maintenanceBroadcastPlan({fleet:'all',kinds:['other']},fixtures.vehicles,fixtures.drivers,fixtures.dealers,today));
  assert.throws(()=>context.maintenanceBroadcastPlan({fleet:'all',kinds:['toString']},fixtures.vehicles,fixtures.drivers,fixtures.dealers,today));
  plan=context.maintenanceBroadcastPlan({fleet:'all',kinds:['other'],other:'請聯絡行控'},fixtures.vehicles,fixtures.drivers,fixtures.dealers,today);
  assert(plan.records.every(row=>row.content==='請聯絡行控'));
  data.vehicles=fixtures.vehicles;data.drivers=fixtures.drivers;data.insurance_partners=fixtures.dealers;
  data.admin_users[0].permissions={maintenanceNotifications:true};
  session={session_type:'admin',admin_user_id:'me'};
  const scoped=await context.loadAdminData({...session},'workspace');
  assert.equal(scoped.data.vehicles.length,6);assert.equal(scoped.data.drivers.length,2);assert.equal(scoped.data.insurance_partners.length,1);
  assert(!('driver_history' in scoped.data.vehicles[0]));
  const preview=await broadcastRequest({action:'preview_maintenance_broadcast',fleet:'dealer:dealer',kinds:['diesel','receipt']});
  assert.equal(preview.status,200);assert.equal((await preview.json()).records.length,3);
  assert.equal(data.maintenance_notifications.length,0);
  assert.equal((await broadcastRequest({action:'create_maintenance_broadcast',fleet:'all',kinds:['diesel'],batch_id:'bad'})).status,400);
  for(const session_type of ['driver','partner']){
    session={session_type};
    assert.equal((await broadcastRequest({action:'preview_maintenance_broadcast',fleet:'all',kinds:['receipt']})).status,403);
  }
  data.maintenance_notifications=[{id:'own-notice',driver_id:'d1',status:'pending',content:'憑證繳回'},{id:'other-notice',driver_id:'d2',status:'pending'}];
  session={session_type:'driver',driver_id:'d1'};
  assert.equal((await request('update','maintenance_notifications',{status:'completed',content:'forged'},'own-notice')).status,200);
  assert.equal(data.maintenance_notifications[0].status,'completed');assert.equal(data.maintenance_notifications[0].content,'憑證繳回');
  await request('update','maintenance_notifications',{status:'completed'},'other-notice');
  assert.equal(data.maintenance_notifications[1].status,'pending');
  console.log('PASS: staff-only API, note ownership, permissions, calendar validation, scoped loads, broadcast eligibility and driver completion isolation');
}

async function uiTests(){
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const context=await browser.newContext();
    const data=seed();let profile={...users[0],is_super_admin:false,permissions:{}};
    data.vehicles=[{id:'v1',plate_no:'TEST-1',dealer_partner_id:'dealer',fleet_name:'甲車隊',fuel_type:'柴油',current_driver_id:'d1'}];
    data.drivers=[{id:'d1',name:'司機甲',dealer_partner_id:'dealer',driver_status:'跑趟中'},{id:'d2',name:'司機乙',dealer_partner_id:'other'}];data.insurance_partners=[{id:'dealer',name:'甲車商',partner_type:'dealer',active:true},{id:'other',name:'乙車商',partner_type:'dealer',active:true}];
    let broadcastSent=0;
    const errors=[];const page=await context.newPage();page.on('pageerror',err=>errors.push(err.message));
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.hostname!=='staff.test')return route.abort();
      if(url.pathname==='/api/office-weather') return route.fulfill({json:{location:'台中市北區',days:[{date:today,min:21,max:29,rain:20,code:3},{date:new Date(Date.parse(`${today}T00:00:00+08:00`)+86400000).toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'}),min:22,max:30,rain:30,code:0}]}});
      if(url.pathname==='/api'){
        const body=route.request().postDataJSON();let result={};
        if(body.action==='load')result={data,admin_profile:profile};
        if(body.action==='load_admin_chat')result={admin_users:data.admin_users,admin_chat_messages:data.admin_chat_messages};
        if(body.action==='insert'){const row={id:'added-'+Date.now(),...body.record,author_name:'王小明'};data[body.table].unshift(row);result={data:row}}
        if(body.action==='update'){const row=data[body.table].find(row=>row.id===body.id);Object.assign(row,body.record);result={data:row}}
        if(body.action==='set_staff_note'){const row={owner_id:'me',content:body.content,updated_at:today};data.staff_notes=[...data.staff_notes.filter(item=>item.owner_id!=='me'),row];result={data:row}}
        if(body.action==='preview_maintenance_broadcast')result={records:body.kinds.map(kind=>({vehicle_id:'v1',plate_no:'TEST-1',driver_id:'d1',driver_name:'司機甲',kind,content:kind})),skipped:[]};
        if(body.action==='create_maintenance_broadcast'){broadcastSent++;const batch={id:body.batch_id,fleet_label:'甲車商',created_at:today,request_spec:{kinds:body.kinds}};const rows=body.kinds.map(kind=>({id:`${body.batch_id}-${kind}`,driver_id:'d1',vehicle_id:'v1',notification_kind:kind,content:'請完成通知',status:'pending',batch_id:body.batch_id}));data.maintenance_notification_batches.unshift(batch);data.maintenance_notifications.unshift(...rows);result={batch,notifications:rows}}
        if(body.action==='load_maintenance_notifications')result={data:{maintenance_notifications:data.maintenance_notifications,maintenance_notification_batches:data.maintenance_notification_batches}};
        return route.fulfill({json:result});
      }
      if(url.pathname==='/')return route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${['styles.css','heycar-ui-enhance.css','staff-home.css'].map(file=>`<link rel="stylesheet" href="/${file}">`).join('')}</head><body><div id="app"></div><script>window.AFIDE_CONFIG={DATA_API_URL:'/api'};</script><script src="/app.js"></script></body></html>`});
      const file=path.join(root,url.pathname.slice(1));
      if(fs.existsSync(file))return route.fulfill({path:file});
      return route.abort();
    });
    await page.addInitScript(()=>{localStorage.setItem('afide-session',JSON.stringify({type:'admin',token:'test',adminProfile:{id:'me',name:'王小明',permissions:{}}}));localStorage.setItem('afide-view-state',JSON.stringify({adminView:'drivers'}));});
    await page.goto('https://staff.test/');
    await page.locator('.staff-home').waitFor();
    assert.equal(await page.locator('.staff-welcome h1').innerText(),'HEYCAR · 員工辦公室');
    assert.equal(await page.getByText('COMPANY NEWS',{exact:true}).count(),0);
    assert.equal(await page.getByText('TEAM SCHEDULE',{exact:true}).count(),0);
    assert(!(await page.locator('.staff-welcome').innerText()).includes('歡迎回來'));
    await page.locator('[data-open-staff-chat="me"]').click();
    await page.locator('#staffNoteContent').fill('午休中，下午回覆你 ☕');
    await page.locator('#staffNoteForm [type="submit"]').click();
    await page.locator('#staffNoteForm').waitFor({state:'detached'});
    assert((await page.locator('[data-open-staff-chat="me"] .staff-note').getAttribute('title')).includes('午休中'));
    await page.reload();await page.locator('.staff-home').waitFor();
    assert((await page.locator('[data-open-staff-chat="me"] .staff-note').getAttribute('title')).includes('午休中'));
    // Home is the first sidebar item even without any management permission.
    assert.equal(await page.locator('.side-nav [data-admin-view]').first().getAttribute('data-admin-view'),'home');
    assert.equal(await page.locator('[data-modal="staffAnnouncement"]').count(),0);
    assert.equal(await page.locator('[data-staff-new-event]').count(),0);
    assert(await page.locator('[data-staff-detail="staff_announcements:notice"]').first().isVisible());
    assert.equal(await page.locator('.staff-notice>p').count(),0);
    assert((await page.locator('.staff-notice-board h2').innerText()).includes('內部公告'));
    await page.getByText('21–29°C',{exact:true}).waitFor();
    await page.locator('[data-staff-detail="staff_announcements:notice"]').first().click();
    assert(await page.locator('.staff-detail-content').isVisible());
    await page.locator('[data-close-modal]').click();
    assert.equal(await page.locator('.staff-person img:not(.staff-super-avatar)').count(),1);
    assert.equal(await page.locator('.staff-person .staff-super-avatar').count(),1);
    data.admin_chat_messages=[{id:'c1',sender_id:'amy',receiver_id:'me',message:'請協助確認訂單',created_at:`${today}T09:00:00+08:00`},{id:'c2',sender_id:'super-admin',receiver_id:'me',message:'最新內部訊息',created_at:`${today}T10:00:00+08:00`}];
    assert(await page.locator('.staff-person').filter({hasText:'陳美麗'}).isVisible(), await page.locator('.staff-people-list').innerText());
    for(const width of [320,390,768,1440]){
      await page.setViewportSize({width,height:1000});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${width}`);
      assert(await page.locator('.staff-people-list').evaluate(list=>list.scrollWidth<=list.clientWidth),`colleague grid overflow at ${width}`);
      await page.locator('[data-open-staff-chat="amy"]').click();
      assert(await page.locator('.admin-chat-panel').isVisible());
      assert(await page.locator('#adminChatForm input').isEnabled());
      assert.equal(await page.locator('[data-admin-chat-contact-button]').first().getAttribute('data-admin-chat-contact-button'),'super-admin');
      assert(await page.locator('.admin-chat-current img').isVisible());
      assert.equal(await page.locator('.admin-chat-bubble .staff-avatar').count(),1);
      if(width<=700){
        assert.equal(await page.locator('.admin-chat-contacts').isVisible(),false);
        const before=(await page.locator('.admin-chat-conversation').boundingBox());assert(before.width>=width-2);
        await page.locator('[data-action="admin-chat-contacts"]').click();
        assert(await page.locator('.admin-chat-contacts').isVisible());
        await page.locator('[data-admin-chat-contact-button="super-admin"]').click();
        assert((await page.locator('[data-admin-chat-messages]').innerText()).includes('最新內部訊息'));
        await page.screenshot({path:path.join(root,`tmp/chat-mobile-${width}.png`),animations:'disabled'});
      }
      await page.locator('.admin-chat-head [data-action="toggle-admin-chat"]').click();
    }
    await page.setViewportSize({width:390,height:500});
    await page.locator('[data-action="toggle-admin-chat"]').first().click();
    assert(await page.locator('.admin-chat-contacts').isVisible());
    data.admin_chat_messages.push({id:'c3',sender_id:'amy',receiver_id:'me',message:'剛收到的新訊息',created_at:`${today}T11:00:00+08:00`});
    await page.waitForFunction(()=>document.querySelector('[data-admin-chat-contact-button]')?.dataset.adminChatContactButton==='amy',{},{timeout:10000});
    await page.locator('[data-admin-chat-contact-button="amy"]').click();
    await page.locator('[data-admin-chat-messages]').getByText('剛收到的新訊息',{exact:true}).waitFor();
    assert((await page.locator('.admin-chat-compose').boundingBox()).y+44<=500);
    await page.locator('.admin-chat-head [data-action="toggle-admin-chat"]').click();
    profile={...profile,is_super_admin:true,permissions:{all:true}};
    await page.reload();await page.locator('.staff-home').waitFor();
    await page.setViewportSize({width:1440,height:1000});
    const toggle=page.locator('.admin-topbar [data-action="toggle-admin-sidebar"]');
    await toggle.click();
    assert(await page.locator('.admin-sidebar').isVisible());
    const expandedWidth=(await page.locator('.admin-workspace').boundingBox()).width;
    await page.locator('.admin-sidebar-head [data-action="toggle-admin-sidebar"]').click();
    assert.equal(await page.locator('.admin-sidebar').isVisible(),false);
    assert((await page.locator('.admin-workspace').boundingBox()).width>expandedWidth+150);
    assert.equal(await toggle.getAttribute('aria-expanded'),'false');
    await page.reload();await page.locator('.staff-home').waitFor();
    assert.equal(await page.locator('.admin-sidebar').isVisible(),false);
    await toggle.click();
    await page.reload();await page.locator('.staff-home').waitFor();
    assert(await page.locator('.admin-sidebar').isVisible());
    await page.screenshot({path:path.join(root,'tmp/staff-home-desktop.png'),fullPage:true,animations:'disabled'});
    await page.locator('.staff-create[data-modal="staffAnnouncement"]').click();
    await page.locator('#modalForm [name="title"]').fill('新增員工公告');
    await page.locator('#modalForm [name="content"]').fill('測試新增與儲存');
    await page.locator('#modalForm [type="submit"]').click();
    await page.getByRole('button',{name:'新增員工公告',exact:true}).waitFor();
    await page.locator('[data-staff-new-event]').click();
    await page.locator('#modalForm [name="title"]').fill('新增內部會議');
    await page.locator('#modalForm [type="submit"]').click();
    await page.getByRole('button',{name:'新增內部會議',exact:true}).waitFor();
    await page.locator('[data-admin-view="adminUsers"]').click();
    assert(await page.locator('.admin-sidebar').isVisible());
    await page.locator('[data-modal="adminUser"][data-id="amy"]').click();
    const avatar = await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=160;const c=canvas.getContext('2d');c.fillStyle='#395d78';c.fillRect(0,0,160,160);return canvas.toDataURL('image/png').split(',')[1]});
    await page.locator('[data-staff-avatar-upload]').setInputFiles({name:'avatar.png',mimeType:'image/png',buffer:Buffer.from(avatar,'base64')});
    await page.getByText('照片已壓縮，儲存帳號後生效',{exact:true}).waitFor();
    assert((await page.locator('[name="avatar_url"]').inputValue()).startsWith('data:image/jpeg'));
    assert.equal(await page.locator('[name="extension"]').count(),0);
    await page.locator('[name="permission_internalAnnouncements"][type="checkbox"]').check();
    await page.locator('#modalForm [type="submit"]').click();
    await page.locator('.side-nav [data-admin-view="home"]').click();
    assert(await page.getByText('分機 456',{exact:true}).isVisible());
    await page.reload();await page.locator('.staff-home').waitFor();
    assert(await page.getByText('分機 456',{exact:true}).isVisible());
    assert(await page.getByRole('button',{name:'新增員工公告',exact:true}).isVisible());
    await page.locator('[data-open-staff-chat="me"]').click();
    await page.locator('[data-staff-note-clear]').click();
    await page.locator('#staffNoteForm [type="submit"]').click();
    await page.locator('#staffNoteForm').waitFor({state:'detached'});
    assert(await page.locator('[data-open-staff-chat="me"] .is-placeholder').isVisible());
    await page.locator('.side-nav [data-admin-view="drivers"]').click();
    assert.equal(await page.locator('.driver-management-row').count(),2);
    for(const width of [320,390,768,1440]){
      await page.setViewportSize({width,height:900});
      if(width<1200&&(await page.locator('.admin-topbar [data-action="toggle-admin-sidebar"]').getAttribute('aria-expanded'))==='true')await page.locator('.admin-topbar [data-action="toggle-admin-sidebar"]').click();
      if(width===1440&&(await page.locator('.admin-topbar [data-action="toggle-admin-sidebar"]').getAttribute('aria-expanded'))!=='true')await page.locator('.admin-topbar [data-action="toggle-admin-sidebar"]').click();
      const outside=await page.evaluate(()=>[...document.querySelectorAll('main *')].filter(node=>node.getBoundingClientRect().right>innerWidth+1).map(node=>`${node.tagName}.${node.className}:${Math.round(node.getBoundingClientRect().right)}`).slice(0,35));
      if(width===320)await page.screenshot({path:path.join(root,'tmp/driver-filters-mobile.png'),fullPage:true,animations:'disabled'});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`driver filter overflow at ${width}: ${outside.join(',')}`);
    }
    await page.locator('[data-driver-dealer-filter]').selectOption('dealer');
    assert.equal(await page.locator('.driver-management-row').count(),1);
    assert((await page.locator('.driver-management-row').innerText()).includes('司機甲'));
    await page.locator('[data-driver-filter="待上線"]').click();
    assert.equal(await page.locator('.driver-management-row').count(),0);
    await page.locator('[data-driver-filter="全部"]').click();
    await page.locator('[data-driver-dealer-filter]').selectOption('');
    assert.equal(await page.locator('.driver-management-row').count(),2);
    await page.locator('[data-driver-filter="待上線"]').click();
    assert.equal(await page.locator('.driver-management-row').count(),1);
    assert((await page.locator('.driver-management-row').innerText()).includes('司機乙'));
    await page.locator('[data-driver-filter="全部"]').click();
    await page.locator('.side-nav [data-admin-view="dispatchCenter"]').click();
    await page.locator('#dispatchSearchForm [name="search"]').fill('保留搜尋');
    await page.locator('[data-admin-dispatch-date-shift="1"]').click();
    const tomorrow=new Date(Date.parse(`${today}T12:00:00+08:00`)+86400000).toISOString().slice(0,10);
    assert.equal(await page.locator('[data-admin-dispatch-date-input]').inputValue(),tomorrow);
    assert.equal(await page.locator('#dispatchSearchForm [name="search"]').inputValue(),'保留搜尋');
    await page.locator('[data-admin-dispatch-date-shift="-1"]').click();
    assert.equal(await page.locator('[data-admin-dispatch-date-input]').inputValue(),today);
    await page.locator('[data-admin-dispatch-date-input]').fill('2026-12-31');
    await page.locator('[data-admin-dispatch-date-shift="1"]').click();
    assert.equal(await page.locator('[data-admin-dispatch-date-input]').inputValue(),'2027-01-01');
    for(const width of [320,390,768,1440]){
      await page.setViewportSize({width,height:900});
      if(width<1200&&(await page.locator('.admin-topbar [data-action="toggle-admin-sidebar"]').getAttribute('aria-expanded'))==='true')await page.locator('.admin-topbar [data-action="toggle-admin-sidebar"]').click();
      if(width===1440&&(await page.locator('.admin-topbar [data-action="toggle-admin-sidebar"]').getAttribute('aria-expanded'))!=='true')await page.locator('.admin-topbar [data-action="toggle-admin-sidebar"]').click();
      if(width<=900 && !await page.locator('#dispatchSearchForm').isVisible())await page.locator('.dispatch-toolbar>summary').click();
      if(width===390){
        await page.locator('[data-admin-dispatch-date-shift="1"]').click();
        assert.equal(await page.locator('[data-admin-dispatch-date-input]').inputValue(),'2027-01-02');
        assert(await page.locator('#dispatchSearchForm').isVisible());
        await page.locator('[data-admin-dispatch-date-shift="-1"]').click();
        await page.screenshot({path:path.join(root,'tmp/dispatch-date-mobile.png'),fullPage:true,animations:'disabled'});
      }
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`dispatch date filter overflow at ${width}`);
    }
    await page.locator('.side-nav [data-admin-view="maintenanceNotifications"]').click();
    await page.locator('[data-action="bulk-maintenance-notification"]').click();
    assert.equal(await page.locator('[name="kinds"][value="diesel"]').isDisabled(),true);
    await page.locator('#broadcastFleet').selectOption('dealer:dealer');
    await page.locator('[name="kinds"][value="diesel"]').check();
    await page.locator('[name="kinds"][value="receipt"]').check();
    await page.locator('#maintenanceBroadcastForm [type="submit"]').click();
    await page.getByRole('button',{name:'發送 2 則通知',exact:true}).waitFor();
    assert.equal(broadcastSent,0);
    await page.locator('#maintenanceBroadcastForm').evaluate(form=>{form.requestSubmit();form.requestSubmit()});
    await page.getByText('已建立 2 則通知，司機可在「保養維修」回報完成。',{exact:true}).waitFor();
    assert.equal(broadcastSent,1);
    await page.getByRole('button',{name:'知道了',exact:true}).click();
    assert((await page.locator('.maintenance-batch').innerText()).includes('已完成 0 / 2'));
    data.maintenance_notifications[0].status='completed';
    await page.locator('[data-action="refresh-maintenance-batches"]').click();
    await page.getByText('已完成 1 / 2',{exact:false}).waitFor();
    await page.locator('.side-nav [data-admin-view="home"]').click();
    await page.setViewportSize({width:390,height:844});
    await page.locator('.admin-topbar [data-action="toggle-admin-sidebar"]').click();
    await page.screenshot({path:path.join(root,'tmp/staff-home-mobile.png'),fullPage:true,animations:'disabled'});
    assert.deepEqual(errors,[]);
    console.log('PASS: office navigation, notices/calendar, avatars/chat, forecast, broadcast preview/double-submit/status refresh and 320/390/768/1440 layouts');
  }finally{await browser.close()}
}
backendTests().then(uiTests).catch(err=>{console.error(err);process.exitCode=1});
