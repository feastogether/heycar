(function(){
 'use strict';
 let cache=null;
 const freshFilters=()=>({query:'',status:'',type:'',dealer:'',from:'',to:'',page:1});
 function invalidate(){if(cache){cache.at=0;cache.version++;}}
 function mount(root,ctx){
  const {api,identity,escapeHtml,fmtDate,table,statusBadge,rowActions,attachmentLink,today,alert,onRows}=ctx;
  if(!cache||cache.identity!==identity)cache={identity,filters:freshFilters(),data:null,drivers:[],dealers:[],at:0,directoryAt:0,version:0};
  const mine=cache;
  const driverName=id=>mine.drivers.find(row=>row.id===id)?.name||mine.data?.rows.find(row=>row.driver_id===id)?.driver_name||'未指定';
  let busy=false;
  function adminPayments(){
    const view=cache.filters,data=cache.data;
    const drivers=new Map(cache.drivers.map(row=>[row.id,row])),dealers=cache.dealers,types=data.types||[],rows=data.rows||[];
    const pages=Math.max(1,Math.ceil(data.total/50)),amount=Number(data.pending_amount||0),pending={length:data.pending_count};view.page=data.page;
    const opts=(values,value)=>values.map(([key,label])=>`<option value="${escapeHtml(key)}" ${value===key?'selected':''}>${escapeHtml(label)}</option>`).join('');
    return `<section class="payments-workspace"><div class="section-head"><h2>費用管理</h2><button class="primary-btn" data-modal="paymentNotice">新增費用通知</button></div>
      <form id="paymentSearchForm" class="payment-search"><input name="query" type="search" aria-label="搜尋費用" placeholder="姓名、手機、類型或內容" value="${escapeHtml(view.query)}">
      <select name="dealer" aria-label="所屬車商">${opts([['','全部車商'],...dealers.map(row=>[row.id,row.name])],view.dealer)}</select>
      <select name="type" aria-label="費用類型">${opts([['','全部類型'],...types.map(type=>[type,type])],view.type)}</select>
      <select name="status" aria-label="費用狀態">${opts([['','全部狀態'],['pending','待確認'],['paid','已確認'],['returned','已退回']],view.status)}</select>
      <label>日期起<input name="from" type="date" value="${escapeHtml(view.from)}"></label><label>日期迄<input name="to" type="date" value="${escapeHtml(view.to)}"></label>
      <button class="ghost-btn" type="submit">篩選</button><button class="ghost-btn" type="button" data-payment-reset>重設</button></form>
      <div class="payment-summary"><span>符合條件 <strong>${data.total}</strong> 筆</span><span>待確認 <strong>${pending.length}</strong> 筆</span><span>待確認金額 <strong>NT$ ${amount.toLocaleString()}</strong></span><span class="payment-pagination"><span>${view.page} / ${pages}</span><button class="ghost-btn" data-payment-page="${view.page-1}" ${view.page===1?'disabled':''}>上一頁</button><button class="ghost-btn" data-payment-page="${view.page+1}" ${view.page===pages?'disabled':''}>下一頁</button></span></div>
      ${table(['駕駛／車商','費用類型','金額','日期','內容','狀態','操作'],rows.map(row=>{
        const driver=drivers.get(row.driver_id),dealer=dealers.find(item=>item.id===driver?.dealer_partner_id),overdue=row.status==='pending'&&row.fee_type!=='薪資'&&row.due_date&&String(row.due_date).slice(0,10)<today();
        return [`<strong>${escapeHtml(driverName(row.driver_id))}</strong><small class="payment-dealer">${escapeHtml(dealer?.name||'未指定車商')}</small>`,escapeHtml(row.fee_type||'其他'),`<strong class="payment-amount">NT$ ${Number(row.amount||0).toLocaleString()}</strong>`,`${escapeHtml(fmtDate(row.due_date))}${overdue?'<small class="payment-overdue">逾期未確認</small>':''}`,`<div class="payment-content">${escapeHtml(row.content||'—')}</div>${attachmentLink(row)}`,statusBadge(row.status),rowActions('paymentNotice','payment_notices',row.id)];
      }),'payment-table')}
      <footer class="payment-pagination"><span>每頁 50 筆 · ${view.page} / ${pages}</span><button class="ghost-btn" data-payment-page="${view.page-1}" ${view.page===1?'disabled':''}>上一頁</button><button class="ghost-btn" data-payment-page="${view.page+1}" ${view.page===pages?'disabled':''}>下一頁</button></footer></section>`;
  }


  function paint(){if(root.isConnected)root.innerHTML=mine.data?adminPayments():'<p class="empty" role="status">正在載入費用…</p>';}
  async function load(){if(busy)return;const version=mine.version;busy=true;root.setAttribute('aria-busy','true');
   try{const result=await api('payment_page',{page:mine.filters.page,filters:mine.filters,directory:!mine.directoryAt||Date.now()-mine.directoryAt>300000});if(cache!==mine||mine.version!==version)return;mine.data=result;mine.filters.page=result.page;if(result.drivers){mine.drivers=result.drivers;mine.directoryAt=Date.now();}if(result.dealers)mine.dealers=result.dealers;mine.at=Date.now();onRows(result.rows);paint();}
   catch(error){if(root.isConnected)root.innerHTML='<div class="empty" role="alert">'+escapeHtml(error.message)+'<button class="ghost-btn" data-payment-retry>重試</button></div>';}
   finally{busy=false;root.removeAttribute('aria-busy');if(cache===mine&&mine.version!==version&&root.isConnected)void load();}
  }
  root.addEventListener('submit',event=>{if(event.target.id!=='paymentSearchForm')return;event.preventDefault();event.stopPropagation();if(busy)return;const values=Object.fromEntries(new FormData(event.target));if(values.from&&values.to&&values.from>values.to){void alert('起日不能晚於迄日','日期範圍');return;}mine.filters={...values,query:String(values.query||'').trim(),page:1};mine.version++;void load();});
  root.addEventListener('click',event=>{const b=event.target.closest('[data-payment-page],[data-payment-reset],[data-payment-retry]');if(!b)return;event.stopPropagation();if(busy||b.disabled)return;if(b.hasAttribute('data-payment-reset'))mine.filters=freshFilters();else if(b.dataset.paymentPage)mine.filters.page=Number(b.dataset.paymentPage);mine.version++;void load();});
  paint();if(!mine.data||Date.now()-mine.at>60000)void load();
 }
 function form(p,h){
  const {escapeHtml,select,input,text,attachmentField,linePushCheckbox,formDate}=h;
  const drivers=cache?.drivers||[];
  const picker='<div class="field full driver-select-picker"><label>指定駕駛</label><input type="search" data-driver-select-search placeholder="輸入姓名或手機快速篩選"><select name="driver_id" data-driver-select required><option value="">請選擇駕駛</option>'+drivers.map(d=>'<option value="'+escapeHtml(d.id)+'" '+(p.driver_id===d.id?'selected':'')+'>'+escapeHtml(d.name+(d.phone?' ('+d.phone+')':''))+'</option>').join('')+'</select></div>';
  return picker+select('fee_type','費用類型',p.fee_type||'罰單',['罰單','通行費','薪資','牌照稅','燃料稅','其他欠費','代扣費用','靠行費'].map(x=>[x,x]))+input('amount','金額（NT$）',p.amount,'number',true)+input('due_date','繳費期限與發放日期',formDate(p.due_date),'date')+select('status','狀態',p.status||'pending',[['pending','待處理'],['paid','已確認'],['returned','已退回']])+text('content','繳費內容',p.content)+attachmentField(p)+(!p.id?linePushCheckbox():'');
 }
 window.HeycarPayments={mount,invalidate,form};
})();
