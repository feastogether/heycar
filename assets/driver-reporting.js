(function () {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const dateLabel = value => String(value || '').replaceAll('-', '/');
  const statusLabels = { pending:'待督導審核', approved:'已同意', rejected:'不同意' };
  const states = new Map();
  const monthDays = month => new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate();
  const dateAt = (month, day) => `${month}-${String(day).padStart(2,'0')}`;
  function mount(root, options) {
    if (!root) return;
    const key = options.identity;
    if (!states.has(key)) states.set(key, { month:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit'}).format(new Date()), filter:'all', search:'', dealer:'', selected:new Set(), blocked:new Set() });
    const state = states.get(key);
    let data = null, busy = false, sequence = 0, acknowledged = false;
    const alive = () => root.isConnected;
    const errorBox = text => `<p class="dr-error" role="alert">${escape(text)}</p>`;
    const submission = () => data?.rows?.[0]?.submission;
    const open = () => data?.config?.is_open && data.server_today >= data.config.opens_on && data.server_today <= data.config.closes_on;
    const badge = s => `<span class="dr-badge ${escape(s.status)}">${statusLabels[s.status]}</span>`;
    const refreshButton = () => `<button class="ghost-btn dr-refresh" data-dr="refresh" ${busy?'disabled':''} aria-label="重新整理報班資料">↻ 重新整理</button>`;
    const shell = content => `<section class="driver-reporting ${options.driver?'dr-driver':''}">${options.driver ? (!data?`<div class="dr-loading-toolbar">${refreshButton()}</div>`:'') : ''}${content}</section>`;
    const availableMonths = () => [...new Set([state.month,...(data?.months||[])])].sort();
    function monthPicker() {
      if(options.driver) {
        const months=availableMonths(), index=months.indexOf(state.month);
        return `<div class="dr-toolbar dr-driver-toolbar"><button class="ghost-btn dr-back" data-view="home" type="button">返回</button><button class="ghost-btn" data-dr="previous" aria-label="上個報班月份" ${index<=0||busy?'disabled':''}>‹</button><label class="dr-month-choice"><span class="dr-sr-only">報班月份</span><select data-dr-available aria-label="報班月份">${months.map(month=>`<option value="${month}" ${month===state.month?'selected':''}>${month.replace('-',' 年 ')} 月</option>`).join('')}</select></label><button class="ghost-btn" data-dr="next" aria-label="下個報班月份" ${index>=months.length-1||busy?'disabled':''}>›</button>${refreshButton()}</div>`;
      }
      return `<div class="dr-toolbar">${refreshButton()}<div class="dr-month"><button class="ghost-btn" data-dr="previous" aria-label="上個月">‹</button><label>報班月份<input type="month" data-dr-month value="${state.month}" aria-label="報班月份"></label><button class="ghost-btn" data-dr="next" aria-label="下個月">›</button></div>${options.driver ? `<label>已開放／曾報班月份<select data-dr-available><option value="">選擇月份</option>${(data?.months||[]).map(month=>`<option value="${month}" ${month===state.month?'selected':''}>${month}</option>`).join('')}</select></label>` : `<span class="dr-muted">${data?.config ? `${dateLabel(data.config.opens_on)} ～ ${dateLabel(data.config.closes_on)}` : '此月份尚未設定'}</span>`}</div>`;
    }
    function calendar(blockEditor = false) {
      const config = data?.config;
      const saved = submission();
      const selected = blockEditor ? state.blocked : state.selected;
      const blocked = new Set(config?.blocked_dates || []);
      const blanks = new Date(Number(state.month.slice(0,4)),Number(state.month.slice(5))-1,1).getDay();
      return `<div class="dr-calendar" aria-label="${state.month}${blockEditor?'禁休日':'休假'}日曆"><div class="dr-weekdays">${['日','一','二','三','四','五','六'].map(day=>`<span>${day}</span>`).join('')}</div><div class="dr-days">${'<span class="dr-empty-day"></span>'.repeat(blanks)}${Array.from({length:monthDays(state.month)},(_,index)=>{
        const date=dateAt(state.month,index+1), chosen=selected.has(date), forbidden=!blockEditor&&blocked.has(date);
        const disabled=busy||(!blockEditor&&(!open()||!!saved||forbidden));
        return `<button type="button" data-dr-${blockEditor?'block':'day'}="${date}" aria-pressed="${chosen}" aria-label="${date}${forbidden?' 禁休':''}${chosen?' 已選':''}" ${disabled?'disabled':''} class="dr-day ${chosen?(blockEditor?'blocked':saved?saved.status:'chosen'):''} ${forbidden?'forbidden':''} ${date===data?.server_today?'today':''}"><strong>${index+1}</strong><small>${forbidden||blockEditor&&chosen?'禁休':chosen?'休假':''}</small></button>`;
      }).join('')}</div></div>`;
    }
    function driverView() {
      const cfg=data.config, saved=submission(), count=state.selected.size, allowed=saved?.allowed_days??cfg?.allowed_days??4;
      return monthPicker()+`<div class="dr-driver-grid"><article class="dr-panel"><div class="dr-panel-head"><h3>${state.month.replace('-',' 年 ')} 月</h3><span class="dr-badge ${saved?saved.status:open()?'approved':'closed'}">${saved?'已送出・不可修改':open()?'開放報班':'尚未開放'}</span></div>${calendar()}<div class="dr-legend"><span><i class="chosen"></i>已選休假</span><span><i class="blocked"></i>禁休日</span><span><i class="approved"></i>督導同意</span></div></article><aside class="dr-panel dr-summary"><h3>我的休假安排</h3><div class="dr-count"><b>${count}</b><span>天休假 <small>排定 ${allowed} 天</small></span></div>${!saved&&count>allowed||saved&&saved.off_dates.length>allowed&&saved.status==='pending'?'<p class="dr-warning">已超過排定天數待督導審核</p>':''}<div class="dr-date-chips">${[...state.selected].sort().map(date=>`<span class="${saved?saved.status:'chosen'}">${escape(dateLabel(date))}</span>`).join('')||'<span class="dr-muted">尚未選擇休假日</span>'}</div><p class="dr-muted">${cfg?`開放期間：${dateLabel(cfg.opens_on)} ～ ${dateLabel(cfg.closes_on)}（台灣時間）`:'本月尚未設定開放期間。'}</p>${saved?`<div class="dr-locked">${badge(saved)}<p>送出後不能自行修改；不同意的案件也會保留原始報班紀錄。</p><small>送出：${escape(new Date(saved.submitted_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}))}</small>${saved.reviewed_at?`<p>${escape(saved.reviewer_name)} · ${escape(new Date(saved.reviewed_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}))}</p>`:''}${saved.review_reason?`<p>審核說明：${escape(saved.review_reason)}</p>`:''}</div>`:`<label class="dr-ack"><input type="checkbox" data-dr-ack ${acknowledged?'checked':''} ${busy||!open()?'disabled':''}><span>我已確認休假日期，送出後即不可更改。</span></label><button class="primary-btn dr-submit" data-dr="submit" ${busy||!open()||!acknowledged?'disabled':''}>${busy?'<span class="dr-spinner"></span> 正在送出':'確認送出報班'}</button>${!open()?'<p class="dr-muted">請在後台設定的開放期間內送出。</p>':''}`}</aside></div>`;
    }
    function settings() {
      const c=data.config || {is_open:false,opens_on:data.server_today,closes_on:data.server_today,allowed_days:4};
      return `<details class="dr-panel dr-settings" ${!data.config?'open':''}><summary>月份開放設定與禁休日 <span>${c.is_open?'已啟用':'未開放'} · 排定 ${c.allowed_days} 天 · ${state.blocked.size} 天禁休</span></summary><form data-dr-settings><div class="dr-settings-fields"><label class="dr-switch"><input name="is_open" type="checkbox" ${c.is_open?'checked':''}>開放本月報班</label><label>開放日期<input type="date" name="opens_on" value="${c.opens_on}" required></label><label>截止日期（當日 23:59）<input type="date" name="closes_on" value="${c.closes_on}" required></label><label>排定休假天數<input type="number" name="allowed_days" value="${c.allowed_days}" min="0" max="31" required></label></div><div class="dr-settings-calendar"><div><h3>點選日期設為禁休日</h3><p class="dr-muted">標示禁休後，司機不能選擇該日。與已送出休假重疊時，系統會拒絕儲存，保留既有資料。</p><p class="dr-muted">變更排定天數僅套用之後送出的報班。</p></div>${calendar(true)}</div><div class="dr-form-actions"><button type="submit" class="primary-btn" ${busy?'disabled':''}>${busy?'正在儲存…':'儲存月份設定'}</button></div></form></details>`;
    }
    function adminView() {
      const rows=data.rows||[], submitted=rows.filter(row=>row.submission), pending=submitted.filter(row=>row.submission.status==='pending');
      const filtered=rows.filter(row=>(!state.dealer||row.dealer_id===state.dealer)&&(!state.search||`${row.driver_name} ${row.dealer_name}`.includes(state.search))&&(state.filter==='all'||(state.filter==='none'?!row.submission:row.submission?.status===state.filter)));
      const dealers=[...new Map(rows.filter(row=>row.dealer_id).map(row=>[row.dealer_id,row.dealer_name])).entries()];
      return monthPicker()+settings()+`<div class="dr-stats"><div><small>應報班司機／含本月歷史紀錄</small><b>${rows.length}</b></div><div><small>已送出</small><b>${submitted.length}</b></div><div class="pending"><small>待審核</small><b>${pending.length}</b></div><div class="approved"><small>已同意</small><b>${submitted.filter(row=>row.submission.status==='approved').length}</b></div></div><article class="dr-panel"><div class="dr-list-toolbar"><div class="dr-filters"><label>姓名／車商<input type="search" data-dr-search value="${escape(state.search)}" placeholder="搜尋司機或車商"></label><label>車商<select data-dr-dealer><option value="">全部車商</option>${dealers.map(([id,name])=>`<option value="${id}" ${state.dealer===id?'selected':''}>${escape(name)}</option>`).join('')}</select></label><label>審核狀態<select data-dr-filter>${[['all','全部'],['pending','待審核'],['approved','已同意'],['rejected','不同意'],['none','尚未報班']].map(([value,label])=>`<option value="${value}" ${state.filter===value?'selected':''}>${label}</option>`).join('')}</select></label></div><button class="ghost-btn" data-dr="export">匯出清單 CSV</button></div><div class="dr-table-wrap"><table class="dr-table"><thead><tr><th>司機／所屬車商</th><th>休假日期</th><th>狀態／天數</th><th>審核</th></tr></thead><tbody>${filtered.map(row=>{
        const s=row.submission;
        return `<tr><td><strong>${escape(row.driver_name)}</strong><small>${escape(row.dealer_name)}</small></td><td><div class="dr-date-chips">${s?s.off_dates.map(date=>`<span class="${s.status}">${Number(date.slice(-2))} 日</span>`).join('')||'<span class="dr-muted">本月不排休</span>':'<span class="dr-muted">尚未送出</span>'}</div></td><td>${s?`${badge(s)}<small>${s.off_dates.length} 天／排定 ${s.allowed_days} 天</small>${s.off_dates.length>s.allowed_days?'<small class="dr-over">超過排定天數</small>':''}`:'—'}</td><td>${s?.status==='pending'?`<div class="dr-review-actions"><button class="primary-btn" data-dr-approve="${s.id}" ${busy?'disabled':''}>同意</button><button class="ghost-btn" data-dr-reject="${s.id}" ${busy?'disabled':''}>不同意</button></div>`:s?`<small>${escape(s.reviewer_name||'')}</small><small>${escape(s.review_reason||'')}</small>`:'—'}</td></tr>`;
      }).join('')||'<tr><td colspan="4" class="dr-empty">目前沒有符合條件的司機</td></tr>'}</tbody></table></div></article><details class="dr-panel dr-audit"><summary>操作紀錄（最近 100 筆）</summary>${(data.audit||[]).map(item=>`<div><strong>${escape(item.actor?.name)}</strong><span>${escape(({month_settings:'修改月份設定',submitted:'送出休假',approved:'同意休假',rejected:'不同意休假'})[item.action]||item.action)}</span><small>${escape(new Date(item.created_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}))}</small>${item.details?.reason?`<p>${escape(item.details.reason)}</p>`:''}</div>`).join('')||'<p class="dr-muted">尚無操作紀錄</p>'}</details>`;
    }
    function paint(error = '') {
      if (!alive()) return;
      root.innerHTML=shell((error?errorBox(error):'')+(data?(options.driver?driverView():adminView()):error?'<p class="dr-muted">請按重新整理重試。</p>':'<div class="dr-panel dr-loading" role="status"><span class="dr-spinner"></span> 正在載入報班資料…</div>'));
    }
    async function load(autoSelect = true) {
      const request=++sequence; busy=true; paint();
      try {
        const response=await options.api('load_driver_reporting',{month:state.month});
        if (!alive()||request!==sequence) return;
        data=response.data;
        if (options.driver&&autoSelect&&!data.config&&data.months?.length) { state.month=data.months[0]; return await load(false); }
        state.selected=new Set(submission()?.off_dates||[]); state.blocked=new Set(data.config?.blocked_dates||[]); acknowledged=false;
      } catch(error) { if (request===sequence) { busy=false; paint(error.message); } return; }
      finally { if (request===sequence) busy=false; }
      paint();
    }
    async function mutate(action, payload) {
      if (busy) return; busy=true; paint();
      try { await options.api(action,payload); if (alive()) await load(false); }
      catch(error) { busy=false; paint(error.message); }
      finally {busy=false;}
    }
    async function changeMonth(month) {
      if (busy||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return;
      if (options.driver&&!submission()&&state.selected.size&& !await options.confirm('切換月份將清除尚未送出的休假選擇。確定切換？','切換月份')) return;
      state.month=month; state.selected.clear(); state.blocked.clear(); data=null; await load(false);
    }
    root.addEventListener('change',event=>{
      const t=event.target;
      if (t.matches('[data-dr-month],[data-dr-available]')) changeMonth(t.value);
      if (t.matches('[data-dr-filter]')) {state.filter=t.value;paint();}
      if (t.matches('[data-dr-dealer]')) {state.dealer=t.value;paint();}
      if (t.matches('[data-dr-search]')) {state.search=t.value.trim();paint();}
      if (t.matches('[data-dr-ack]')) {acknowledged=t.checked;paint();}
    });
    root.addEventListener('click', async event=>{
      const button=event.target.closest('button'); if (!button||busy) return;
      const day=button.dataset.drDay, block=button.dataset.drBlock, action=button.dataset.dr;
      if (day&&open()&&!submission()&&!data.config.blocked_dates.includes(day)) {state.selected.has(day)?state.selected.delete(day):state.selected.add(day);paint();}
      if (block) {
        // Preserve unsaved form fields when toggling a blocked date.
        state.blocked.has(block)?state.blocked.delete(block):state.blocked.add(block);
        button.classList.toggle('blocked',state.blocked.has(block));button.setAttribute('aria-pressed',String(state.blocked.has(block)));button.querySelector('small').textContent=state.blocked.has(block)?'禁休':'';
      }
      if (action==='previous'||action==='next') {
        if(options.driver){const months=availableMonths(),target=months[months.indexOf(state.month)+(action==='next'?1:-1)];if(target)changeMonth(target);}
        else {const d=new Date(Number(state.month.slice(0,4)),Number(state.month.slice(5))-1+(action==='next'?1:-1),1);changeMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);}
      }
      if (action==='refresh') {if (!options.driver||submission()||!state.selected.size||await options.confirm('重新整理將清除尚未送出的休假選擇。確定繼續？','重新整理')) load(false);}
      if (action==='submit'&&acknowledged&&open()&&!submission()) {
        if(await options.confirm(`本月選擇 ${state.selected.size} 天：${[...state.selected].sort().map(dateLabel).join('、')||'不排休'}。${state.selected.size>data.config.allowed_days?'已超過排定天數待督導審核。':''}送出後即不可更改。`,'確認送出報班'))
          mutate('submit_driver_reporting',{month:state.month,dates:[...state.selected].sort(),revision:data.config.revision,confirmed:true});
      }
      const id=button.dataset.drApprove||button.dataset.drReject;
      if (id) {
        const row=data.rows.find(row=>row.submission?.id===id), reject=!!button.dataset.drReject;
        let reason='';
        if(reject) {reason=await options.prompt('請填寫不同意原因（司機會看到）','','審核說明');if(reason===null||!reason.trim())return;}
        if(await options.confirm(`${reject?'不同意':'同意'} ${row.driver_name} 的 ${row.submission.off_dates.length} 天休假？${row.submission.off_dates.length>row.submission.allowed_days?'此申請超過排定天數，請再次核對。':''}`,'確認審核'))
          mutate('review_driver_reporting',{id,status:reject?'rejected':'approved',reason,revision:row.submission.revision,confirmed:true});
      }
      if (action==='export') {
        const cell=v=>'"'+String(v??'').replace(/^\s*[=+@-]|^[\t\r]/,"'$&").replaceAll('"','""')+'"';
        const rows=[['月份','司機','車商','休假日期','天數','排定天數','狀態','審核人','審核說明'],...(data.rows||[]).map(row=>[state.month,row.driver_name,row.dealer_name,row.submission?.off_dates.join('、'),row.submission?.off_dates.length,row.submission?.allowed_days,row.submission?statusLabels[row.submission.status]:'未報班',row.submission?.reviewer_name,row.submission?.review_reason])];
        const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
        const a=document.createElement('a');a.href=url;a.download=`司機報班-${state.month}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      }
    });
    root.addEventListener('submit',async event=>{
      if(!event.target.matches('[data-dr-settings]'))return;event.preventDefault();if(busy)return;
      const form=new FormData(event.target), opens=form.get('opens_on'), closes=form.get('closes_on');
      if(closes<opens){await options.alert('截止日期不可早於開放日期');return;}
      if(!await options.confirm('確定儲存此月份的開放期間、排定天數與禁休日？','儲存月份設定'))return;
      mutate('save_driver_reporting_month',{month:state.month,revision:data.config?.revision||0,config:{is_open:form.get('is_open')==='on',opens_on:opens,closes_on:closes,allowed_days:Number(form.get('allowed_days')),blocked_dates:[...state.blocked].sort()}});
    });
    paint();load();
  }
  window.HeycarDriverReporting={mount};
})();
