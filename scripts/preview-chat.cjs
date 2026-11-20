const {randomUUID}=require('crypto');
module.exports=function previewChat(body,session,fixture){
 const allowed=['load_admin_chat','send_admin_chat_message','mark_admin_chat_read','create_admin_chat_group','send_admin_group_message','mark_admin_group_read','load_admin_group_messages'];if(!allowed.includes(body.action))return null;
 const fail=(error,status=400)=>({body:{error},status}),ok=body=>({body,status:200});if(session.session_type!=='admin')return fail('沒有通訊權限',403);
 const me=session.is_super_admin?'super-admin':session.admin_user_id,users=fixture.staff_users||[],messages=fixture.admin_chat_messages ||= [],groups=fixture.admin_chat_groups ||= [],groupMessages=fixture.admin_chat_group_messages ||= [];
 const mine=groups.filter(g=>g.member_ids.includes(me)),group=mine.find(g=>g.id===body.group_id),name=session.admin_name||'本機測試管理員';
 const summaries=()=>mine.map(g=>({...g,last_message:groupMessages.filter(m=>m.group_id===g.id).at(-1)||null,unread_count:groupMessages.filter(m=>m.group_id===g.id&&m.sender_id!==me&&m.seq>(g.reads?.[me]||0)).length}));
 const history=()=>({messages:groupMessages.filter(m=>m.group_id===body.group_id&&(!body.before_seq||m.seq<body.before_seq)).slice(-100),has_more:false});
 if(body.action==='load_admin_chat')return ok({admin_users:users.filter(u=>u.active!==false),admin_chat_messages:messages.filter(m=>m.sender_id===me||m.receiver_id===me),admin_chat_groups:summaries(),feedback_count:(fixture.feedbacks||[]).filter(r=>!r.admin_reply).length,...(group?{group_id:group.id,group_messages:history().messages,group_has_more:false}:{})});
 if(body.action==='create_admin_chat_group'){const members=[...new Set([me,...(body.member_ids||[])])];if(!String(body.name||'').trim()||members.length<2||members.some(id=>id!=='super-admin'&&!users.some(u=>u.id===id&&u.active!==false)))return fail('群組名稱或成員錯誤');const g={id:randomUUID(),name:body.name,member_ids:members,created_at:new Date().toISOString(),reads:{}};groups.push(g);return ok({group_id:g.id});}
 if(body.action==='send_admin_chat_message'){if(!String(body.message||'').trim()||body.message.length>2000||body.receiver_id===me||body.receiver_id!=='super-admin'&&!users.some(u=>u.id===body.receiver_id&&u.active!==false))return fail('訊息或對象錯誤');const row={id:randomUUID(),sender_id:me,sender_name:name,receiver_id:body.receiver_id,message:body.message,created_at:new Date().toISOString(),read_at:null};messages.push(row);return ok({data:row});}
 if(body.action==='mark_admin_chat_read'){messages.filter(m=>m.receiver_id===me&&m.sender_id===body.contact_id).forEach(m=>m.read_at=new Date().toISOString());return ok({ok:true});}
 if(!group)return fail('不是群組成員',403);
 if(body.action==='load_admin_group_messages')return ok(history());
 if(body.action==='mark_admin_group_read'){(group.reads ||= {})[me]=body.through_seq;return ok({ok:true});}
 if(!String(body.message||'').trim()||body.message.length>2000)return fail('訊息不能空白');const row={id:randomUUID(),group_id:group.id,sender_id:me,sender_name:name,message:body.message,seq:groupMessages.length+1,created_at:new Date().toISOString()};groupMessages.push(row);return ok({data:row});
};
