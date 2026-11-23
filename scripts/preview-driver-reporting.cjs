// Isolated synthetic UI fixture. Never connects to a remote database or requires legacy exports.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {makeDatabase,ids}=require('./test-driver-reporting.cjs');
const {createDriverReportingHandler,reportingActions}=require('../supabase/functions/data-api/driver-reporting.mjs');
const root=path.resolve(__dirname,'..'),port=Number(process.env.FLEET_PREVIEW_PORT||4191);
const admin={id:'super-admin',name:'報班測試',is_super_admin:true,permissions:{all:true}};
const dealers=[{id:ids.dealer,name:'亞菲得股份有限公司',partner_type:'dealer',active:true,frontend_permissions:{}},{id:ids.other,name:'其他車商',partner_type:'dealer',active:true,frontend_permissions:{}}];
const drivers=[{id:ids.driver,name:'測試司機一',dealer_partner_id:ids.dealer},{id:ids.second,name:'測試司機二',dealer_partner_id:ids.dealer},{id:ids.third,name:'未開放司機',dealer_partner_id:ids.other}];
drivers.forEach(row=>row.driver_status='待上線');
const sessions={'preview-admin':{session_type:'admin',is_super_admin:true},'preview-driver':{session_type:'driver',driver_id:ids.driver},'preview-driver2':{session_type:'driver',driver_id:ids.second},'preview-otherdriver':{session_type:'driver',driver_id:ids.third}};
const signatures={driver_roster_shift_save:["date","uuid","text","integer","jsonb"],driver_reporting_admin_set:["date","uuid","date[]","bigint","text","jsonb"],driver_roster_stamp:["date"],driver_roster_load:["date"],driver_roster_save:["uuid","date","text","integer","jsonb"],driver_reporting_admin_edit:['uuid','date[]','bigint','text','jsonb'],driver_reporting_load:['date','uuid'],driver_reporting_save_month:['date','jsonb','bigint','jsonb'],driver_reporting_submit:['date','uuid','date[]','bigint'],driver_reporting_review:['uuid','text','text','bigint','jsonb']};
function send(res,body,status=200){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));}
async function main(){
 const db=await makeDatabase();
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261118010000_reporting_admin_calendar_edit.sql'),'utf8'));
 await db.exec('create table calendar_events(id uuid primary key,driver_id uuid,event_date date,event_type text,plate_no text,completed_at timestamptz)');
 const roster=fs.readFileSync(path.join(root,'supabase/migrations/20261123010000_roster_chat_updates.sql'),'utf8');await db.exec(roster.slice(roster.indexOf('create table public.driver_roster_notes')));
 await db.exec("create table vehicles(id uuid primary key,plate_no text,current_driver_id uuid,assigned_driver_names text,driver_history jsonb default '[]');alter table calendar_events add column vendor text;alter table calendar_events add column event_time text;");await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261123030000_roster_workspace.sql'),'utf8'));
 const handle=createDriverReportingHandler({adminCan:async session=>session.is_super_admin,db:{rpc:async(name,args)=>{
  try{const types=signatures[name];const values=Object.values(args).map((value,index)=>types[index]==='jsonb'?JSON.stringify(value):value);
   const result=(await db.query(`select public.${name}(${types.map((type,index)=>`$${index+1}::${type}`).join(',')}) as result`,values)).rows[0].result;return {data:result};
  }catch(error){return {error:{code:error.code,message:error.message}};}
 }}});
 async function request(req,res){
  const url=new URL(req.url,'http://127.0.0.1:'+port);
  if(req.headers.origin&&req.headers.origin!==url.origin)return send(res,{},403);
  if(req.method==='POST'&&url.pathname==='/__preview_api'){
   const session=sessions[req.headers['x-afide-session']];if(!session)return send(res,{error:'SESSION_EXPIRED'},401);
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1000000)return send(res,{},413);}const body=JSON.parse(raw||'{}');
   if(reportingActions.includes(body.action)){const result=await handle(body,session);return send(res,result.body,result.status);}
   if(body.action==='update'&&body.table==='insurance_partners'&&session.is_super_admin){
    const row=dealers.find(row=>row.id===body.id);if(!row)return send(res,{},404);Object.assign(row,body.record);
    await db.query('update insurance_partners set name=$1,partner_type=$2,active=$3,frontend_permissions=$4 where id=$5',[row.name,row.partner_type,row.active,JSON.stringify(row.frontend_permissions),row.id]);return send(res,{data:row});
   }
   if(body.action==='load')return send(res,{data:{drivers:session.session_type==='driver'?drivers.filter(d=>d.id===session.driver_id):drivers,insurance_partners:dealers,admin_users:[admin]},...(session.session_type==='admin'?{admin_profile:admin}:{})});
   return send(res,{});
  }
  if(url.pathname==='/config.js'){
   const role=new URL(req.headers.referer||url.origin).searchParams.get('review')||'admin';
   const driver=role==='driver'?drivers[0]:role==='driver2'?drivers[1]:role==='otherdriver'?drivers[2]:null;
   const session=driver?{type:'driver',token:'preview-'+role,user:driver}:{type:'admin',token:'preview-admin',adminProfile:admin};
   res.writeHead(200,{'content-type':'application/javascript'});
   return res.end("window.AFIDE_CONFIG={DATA_API_URL:"+JSON.stringify(url.origin+'/__preview_api')+"};localStorage.setItem('afide-session',"+JSON.stringify(JSON.stringify(session))+ ");localStorage.setItem('afide-view-state',"+JSON.stringify(JSON.stringify(driver?{type:'driver',view:'home'}:{type:'admin',adminView:'home'}))+");");
  }
  if(url.pathname.startsWith('/api/'))return send(res,{});
  const relative=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).replace(/^\//,'');
  const file=path.resolve(root,relative);
  if(!file.startsWith(root+path.sep)||(!['index.html','app.js','styles.css','heycar-ui-enhance.css','staff-home.css','login.css','hiring.css'].includes(relative)&&!relative.startsWith('assets/')))return send(res,{},404);
  if(!fs.existsSync(file)||!fs.statSync(file).isFile())return send(res,{},404);
  const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp'}[path.extname(file)]||'application/octet-stream';
  res.writeHead(200,{'content-type':mime,'cache-control':'no-store'});fs.createReadStream(file).pipe(res);
 }
 http.createServer((req,res)=>request(req,res).catch(error=>send(res,{error:error.message},500))).listen(port,'127.0.0.1',()=>console.log('Local fleet preview: http://127.0.0.1:'+port+'/'));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
