(function(){
 'use strict';let cache=null;
 function mount(root,{api,identity,escapeHtml:escape}){
  if(!cache||cache.identity!==identity)cache={identity,at:0,data:null,error:'',pending:null};
  const mine=cache;
  function paint(){if(!root.isConnected||cache!==mine)return;const groups=mine.data?.groups||[];
   root.innerHTML='<section class="staff-card office-todos"><div class="staff-section-head"><h2>待我處理</h2><button class="ghost-btn" type="button" data-office-refresh aria-label="重新整理待辦" title="重新整理">↻</button></div>'+(mine.data&&mine.error?'<p role="alert" class="error">待辦更新失敗：'+escape(mine.error)+'</p>':'')+(!mine.data?'<p class="empty" role="status">'+escape(mine.error||'正在整理待辦…')+'</p>':!groups.length?'<p class="empty">目前沒有待處理事項</p>':'<div class="office-todo-groups">'+groups.map(group=>'<article><header><strong>'+escape(group.title)+'</strong><b>'+Number(group.count)+'</b></header><div>'+group.items.map(item=>'<div class="office-todo-item '+escape(item.urgency)+'"><span><strong>'+escape(item.label)+'</strong><small>'+escape(item.reason)+'</small></span><time>'+escape(item.date||'')+(item.urgency==='overdue'?' · 已逾期':item.urgency==='today'?' · 今天到期':'')+'</time></div>').join('')+'</div><button class="ghost-btn" data-admin-view="'+escape(group.view)+'">前往處理</button></article>').join('')+'</div>')+'</section>';
  }
  async function load(force=false){
   if(mine.pending){await mine.pending;paint();return;}
   if(!force&&Date.now()-mine.at<60000)return;
   mine.pending=api('office_todos').then(data=>{if(cache!==mine)return;mine.data=data;mine.at=Date.now();mine.error='';}).catch(error=>{mine.error=error.message;mine.at=Date.now()-45000;}).finally(()=>{mine.pending=null;paint();});
   await mine.pending;
  }
  root.addEventListener('click',event=>{if(event.target.closest('[data-office-refresh]')){event.stopPropagation();void load(true);}});
  paint();void load();
 }
 window.HeycarOfficeTodos={mount};
})();
