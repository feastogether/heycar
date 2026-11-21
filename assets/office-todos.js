(function(){
 'use strict';let cache=null;
 function mount(root,{api,identity,escapeHtml:escape}){
  if(!cache||cache.identity!==identity)cache={identity,at:0,data:null,error:'',pending:null};
  const mine=cache;
  function paint(){if(!root.isConnected||cache!==mine)return;const groups=mine.data?.groups||[];
   const total=groups.reduce((sum,group)=>sum+Number(group.count||0),0),label=mine.error?'待辦更新失敗，點選重試':'待我處理 '+total+' 件，點選更新';
   root.innerHTML='<button type="button" class="office-todo-count" data-office-refresh aria-label="'+escape(label)+'" title="'+escape(label)+'"><span>待我處理</span><strong data-office-total aria-live="polite">'+(mine.data?total:mine.error?'—':'…')+'</strong>'+(mine.error?'<span class="office-count-status" role="alert">'+escape(mine.error)+'</span>':'')+'</button>';

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
