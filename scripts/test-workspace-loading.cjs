const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('fs'),{stripTypeScriptTypes}=require('node:module');
(async()=>{
 const {workspaceViews}=await import('../supabase/functions/data-api/workspace-query.mjs');
 const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/data-api/index.ts','utf8')),start=source.indexOf('async function loadAdminData('),end=source.indexOf('\nconst adminPermissionProfiles',start),tables=JSON.parse(source.match(/const tables = (\[[\s\S]*?\]);/)[1]);
 const calls=[];const chain={select(){return this;},eq(){return this;},neq(){return this;},or(){return this;},order(){return this;},limit(){return this;},then(resolve){return Promise.resolve({data:[],error:null}).then(resolve);}};
 const ctx=vm.createContext({workspaceViews,tables,tablePermission:{},db:{from(name){calls.push(name);return chain;}},adminCan:async()=>true,dispatchRows:async name=>{calls.push(name);return [];},compactText:String});
 vm.runInContext(source.slice(start,end),ctx);
 await ctx.loadAdminData({is_super_admin:true},'view','2026-11-21','vehicles');assert.deepEqual(calls.sort(),['drivers','insurance_partners','vehicle_types','vehicles']);assert(!calls.includes('payment_notices'));calls.length=0;
 await ctx.loadAdminData({is_super_admin:true},'view','2026-11-21','payments');assert.equal(calls.length,0,'page RPC owns payment queries');
 const result=await ctx.loadAdminData({is_super_admin:true},'home');assert(!calls.includes('admin_chat_messages'));assert(!('vehicles'in result.data));assert(!('payment_notices'in result.data));
 console.log('PASS: actual loadAdminData uses whitelisted view dependencies, no unrelated expenses or complete chat history');
})().catch(error=>{console.error(error);process.exitCode=1;});
