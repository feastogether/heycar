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
    let mode='select', payload, filters=[], columns='*';
    const query={
      select(value='*'){columns=value;return this},eq(key,value){filters.push(row=>row[key]===value);return this},neq(key,value){filters.push(row=>row[key]!==value);return this},order(){return this},or(){return this},
      insert(value){mode='insert';payload=value;return this},update(value){mode='update';payload=value;return this},delete(){mode='delete';return this},
      async execute(single=false){
        let rows=(data[table]||[]).filter(row=>filters.every(fn=>fn(row)));
        if(mode==='insert'){rows=[{id:'new',created_at:today,...payload}];(data[table]||=[]).push(...rows)}
        if(mode==='update')rows.forEach(row=>Object.assign(row,payload));
        if(mode==='delete')data[table]=(data[table]||[]).filter(row=>!rows.includes(row));
        if(columns!=='*')rows=rows.map(row=>Object.fromEntries(columns.split(',').map(key=>[key,row[key]])));
        return {data:single?(rows[0]||null):rows,error:null};
      },single(){return this.execute(true)},then(resolve,reject){return this.execute().then(resolve,reject)}
    };return query;
  }};
  const context=vm.createContext({Deno:{env:{get:()=>''},serve:fn=>{handler=fn}},createClient:()=>db,Request,Response,Headers,Date,Map,Set,WeakMap,crypto,TextEncoder,URL,console});
  vm.runInContext(backend,context);
  context.testSession=()=>({...session});
  vm.runInContext('getSession = async () => testSession();',context);
  const request=(action,table,record,id)=>handler(new Request('https://test/',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,table,record,id})}));
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
    assert.equal((await request('insert','staff_announcements',{title:'拒絕',content:'拒絕'})).status,403);
    assert.equal((await request('delete','staff_calendar_events',{},'event')).status,403);
  }
  console.log('PASS: staff-only API, independent edit permissions, server author stamps, read access, calendar validation');
}

async function uiTests(){
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const context=await browser.newContext();
    const data=seed();let profile={...users[0],is_super_admin:false,permissions:{}};
    const errors=[];const page=await context.newPage();page.on('pageerror',err=>errors.push(err.message));
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.hostname!=='staff.test')return route.abort();
      if(url.pathname==='/api'){
        const body=route.request().postDataJSON();let result={};
        if(body.action==='load')result={data,admin_profile:profile};
        if(body.action==='load_admin_chat')result={admin_users:users,admin_chat_messages:[]};
        if(body.action==='insert'){const row={id:'added-'+Date.now(),...body.record,author_name:'王小明'};data[body.table].unshift(row);result={data:row}}
        if(body.action==='update'){const row=data[body.table].find(row=>row.id===body.id);Object.assign(row,body.record);result={data:row}}
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
    // Home is the first sidebar item even without any management permission.
    assert.equal(await page.locator('.side-nav [data-admin-view]').first().getAttribute('data-admin-view'),'home');
    assert.equal(await page.locator('[data-modal="staffAnnouncement"]').count(),0);
    assert.equal(await page.locator('[data-staff-new-event]').count(),0);
    assert(await page.getByText('公司會議通知',{exact:true}).isVisible());
    await page.locator('[data-staff-detail="staff_announcements:notice"]').first().click();
    assert(await page.locator('.staff-detail-content').isVisible());
    await page.locator('[data-close-modal]').click();
    assert.equal(await page.locator('.staff-person img').count(),1);
    assert(await page.locator('.staff-person').filter({hasText:'陳美麗'}).isVisible(), await page.locator('.staff-people-list').innerText());
    for(const width of [320,390,768,1440]){
      await page.setViewportSize({width,height:1000});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${width}`);
      await page.locator('[data-open-staff-chat="amy"]').click();
      assert(await page.locator('.admin-chat-panel').isVisible());
      assert(await page.locator('#adminChatForm input').isEnabled());
      await page.locator('.admin-chat-head [data-action="toggle-admin-chat"]').click();
    }
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
    await page.locator('[name="extension"]').fill('789');
    await page.locator('[name="permission_internalAnnouncements"][type="checkbox"]').check();
    await page.locator('#modalForm [type="submit"]').click();
    await page.locator('.side-nav [data-admin-view="home"]').click();
    assert(await page.getByText('分機 789',{exact:true}).isVisible());
    await page.reload();await page.locator('.staff-home').waitFor();
    assert(await page.getByText('分機 789',{exact:true}).isVisible());
    assert(await page.getByRole('button',{name:'新增員工公告',exact:true}).isVisible());
    await page.setViewportSize({width:390,height:844});
    await page.locator('.admin-topbar [data-action="toggle-admin-sidebar"]').click();
    await page.screenshot({path:path.join(root,'tmp/staff-home-mobile.png'),fullPage:true,animations:'disabled'});
    assert.deepEqual(errors,[]);
    console.log('PASS: full app navigation, notice/calendar save and reload, avatar upload, permissions, teammate chat, 320/390/768/1440 layouts');
  }finally{await browser.close()}
}
backendTests().then(uiTests).catch(err=>{console.error(err);process.exitCode=1});
