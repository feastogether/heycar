(function () {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const dateLabel = value => String(value || '').replaceAll('-', '/');
  const statusLabels = { pending:'待督導審核', approved:'已同意', rejected:'不同意' };
  const states = new Map();
  const monthDays = month => new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate();
  const dateAt = (month, day) => `${month}-${String(day).padStart(2,'0')}`;
  function daySummary(rows, date) {
    const result={work:[],off:[],pending:[],unconfirmed:[]};
    for(const row of rows) {
      const submission=row.submission;
      if(!submission || !['approved','pending'].includes(submission.status)) result.unconfirmed.push(row);
      else if((submission.off_dates || []).includes(date)) result[submission.status==='approved'?'off':'pending'].push(row);
      else result.work.push(row);
    }
    return result;
  }
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
    const refreshButton = () => `<button class="ghost-btn dr-refresh" type="button" data-dr="refresh" ${busy?'disabled':''} aria-label="重新整理報班資料"><span aria-hidden="true">↻</span><span>重新整理</span></button>`;
    const shell = content => `<section class="driver-reporting ${options.driver?'dr-driver':''}">${options.driver ? (!data?monthPicker():'') : ''}${content}</section>`;
    const availableMonths = () => [...new Set([state.month,...(data?.months||[])])].sort();
    function monthPicker() {
      if(options.driver) {
        const months=availableMonths(), index=months.indexOf(state.month);
        return '<div class="dr-toolbar dr-driver-toolbar driver-toolbar"><button class="ghost-btn dr-back driver-back" data-dr="back" type="button" aria-label="返回司機首頁" title="返回">返回</button><div class="dr-month-nav"><button class="ghost-btn" type="button" data-dr="previous" aria-label="上個報班月份" '+(index<=0||busy?'disabled':'')+'>‹</button><label class="dr-month-choice"><span class="dr-sr-only">報班月份</span><select data-dr-available aria-label="報班月份" '+(busy?'disabled':'')+'>'+months.map(month=>'<option value="'+month+'" '+(month===state.month?'selected':'')+'>'+month.replace('-',' / ')+'</option>').join('')+'</select></label><button class="ghost-btn" type="button" data-dr="next" aria-label="下個報班月份" '+(index>=months.length-1||busy?'disabled':'')+'>›</button></div><button class="ghost-btn dr-refresh driver-refresh" type="button" title="重新整理" data-dr="refresh" aria-label="重新整理報班資料" '+(busy?'disabled':'')+'>↻</button></div>';

      }
      return `<div class="dr-toolbar dr-admin-toolbar"><div class="dr-month" role="group" aria-label="切換報班月份"><button class="ghost-btn" type="button" data-dr="previous" aria-label="上個月" ${busy?'disabled':''}>‹</button><label class="dr-month-choice"><span class="dr-sr-only">報班月份</span><input type="month" data-dr-month value="${state.month}" aria-label="報班月份" ${busy?'disabled':''}></label><button class="ghost-btn" type="button" data-dr="next" aria-label="下個月" ${busy?'disabled':''}>›</button></div>${refreshButton()}</div>`;
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
    const rangeRules=()=>submission()?.range_rules??data?.config?.range_rules??[];
    function limitViolation(dates){return rangeRules().find(rule=>[...dates].filter(date=>date>=rule.start_on&&date<=rule.end_on).length>rule.max_days);}
    function ruleFields(rule={start_on:state.month+'-01',end_on:dateAt(state.month,monthDays(state.month)),max_days:1}){return '<div class="dr-range-row" data-dr-rule-row><label>起日<input type="date" data-rule-start required value="'+escape(rule.start_on)+'"></label><label>迄日<input type="date" data-rule-end required value="'+escape(rule.end_on)+'"></label><label>最多休<input type="number" data-rule-max min="0" max="31" required value="'+Number(rule.max_days)+'"></label><button type="button" class="ghost-btn" data-dr-rule-remove aria-label="移除此限休條件">×</button></div>';}
    function driverView() {
      const cfg=data.config, saved=submission(), count=state.selected.size, allowed=saved?.allowed_days??cfg?.allowed_days??4;
      return monthPicker()+`<div class="dr-driver-grid"><article class="dr-panel"><div class="dr-panel-head"><span class="dr-selection-total">已選 ${count} 天 · 排定 ${allowed} 天</span><span class="dr-badge ${saved?saved.status:open()?'approved':'closed'}">${saved?'已送出・不可修改':open()?'開放報班':'尚未開放'}</span></div>${rangeRules().length?'<div class="dr-range-hints">'+rangeRules().map(rule=>'<span>'+rule.start_on.slice(5).replace('-','/')+'–'+rule.end_on.slice(5).replace('-','/')+'：已選 '+[...state.selected].filter(date=>date>=rule.start_on&&date<=rule.end_on).length+' / '+rule.max_days+' 天</span>').join('')+'</div>':''}${calendar()}<div class="dr-legend"><span><i class="chosen"></i>已選休假</span><span><i class="blocked"></i>禁休日</span><span><i class="approved"></i>督導同意</span></div></article><aside class="dr-panel dr-summary"><h3 class="dr-sr-only">我的休假安排</h3><div class="dr-count"><b>${count}</b><span>天休假 <small>排定 ${allowed} 天</small></span></div>${!saved&&count>allowed||saved&&saved.off_dates.length>allowed&&saved.status==='pending'?'<p class="dr-warning">已超過排定天數待督導審核</p>':''}<div class="dr-date-chips">${[...state.selected].sort().map(date=>`<span class="${saved?saved.status:'chosen'}">${escape(dateLabel(date))}</span>`).join('')||'<span class="dr-muted">尚未選擇休假日</span>'}</div><p class="dr-muted">${cfg?`開放期間：${dateLabel(cfg.opens_on)} ～ ${dateLabel(cfg.closes_on)}（台灣時間）`:'本月尚未設定開放期間。'}</p>${saved?`<div class="dr-locked">${badge(saved)}<p>送出後不能自行修改；不同意的案件也會保留原始報班紀錄。</p>${saved.admin_edited_at?`<p>後台已調整 · ${escape(saved.admin_editor_name||'')} ${dateLabel(saved.admin_edited_at.slice(0,10))}</p>${saved.admin_edit_note?`<p>${escape(saved.admin_edit_note)}</p>`:''}`:''}<small>送出：${escape(new Date(saved.submitted_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}))}</small>${saved.reviewed_at?`<p>${escape(saved.reviewer_name)} · ${escape(new Date(saved.reviewed_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}))}</p>`:''}${saved.review_reason?`<p>審核說明：${escape(saved.review_reason)}</p>`:''}</div>`:`<label class="dr-ack"><input type="checkbox" data-dr-ack ${acknowledged?'checked':''} ${busy||!open()?'disabled':''}><span>我已確認休假日期，送出後即不可更改。</span></label><button class="primary-btn dr-submit" data-dr="submit" ${busy||!open()||!acknowledged?'disabled':''}>${busy?'<span class="dr-spinner"></span> 正在送出':'確認送出報班'}</button>${!open()?'<p class="dr-muted">請在後台設定的開放期間內送出。</p>':''}`}</aside></div>`;
    }
    function settings() {
      const c=data.config || {is_open:false,opens_on:data.server_today,closes_on:data.server_today,allowed_days:4};
      return `<details class="dr-panel dr-settings" ${!data.config?'open':''}><summary>月份開放設定與禁休日 <span>${c.is_open?'已啟用':'未開放'} · 排定 ${c.allowed_days} 天 · ${state.blocked.size} 天禁休</span></summary><form data-dr-settings><div class="dr-settings-fields"><label class="dr-switch"><input name="is_open" type="checkbox" ${c.is_open?'checked':''}>開放本月報班</label><label>開放日期<input type="date" name="opens_on" value="${c.opens_on}" required></label><label>截止日期（當日 23:59）<input type="date" name="closes_on" value="${c.closes_on}" required></label><label>排定休假天數<input type="number" name="allowed_days" value="${c.allowed_days}" min="0" max="31" required></label></div><div class="dr-settings-calendar"><div><h3>點選日期設為禁休日</h3><p class="dr-muted">標示禁休後，司機不能選擇該日。與已送出休假重疊時，系統會拒絕儲存，保留既有資料。</p><p class="dr-muted">變更排定天數僅套用之後送出的報班。</p></div>${calendar(true)}</div><section class="dr-range-editor"><div class="dr-panel-head"><h3>條件限休</h3><button class="ghost-btn" type="button" data-dr-rule-add>＋ 新增條件</button></div><p class="dr-muted">每位司機在指定期間內最多可休幾天；重疊條件需同時符合。與已送出的報班衝突時不會覆蓋原資料。</p><div data-dr-rules>${(c.range_rules||[]).map(ruleFields).join('')}</div></section><div class="dr-form-actions"><button type="submit" class="primary-btn" ${busy?'disabled':''}>${busy?'正在儲存…':'儲存月份設定'}</button></div></form></details>`;
    }
    function availabilityCalendar(rows) {
      const first=new Date(Date.UTC(Number(state.month.slice(0,4)),Number(state.month.slice(5))-1,1)).getUTCDay();
      const selected=state.calendarDate?.startsWith(state.month)?state.calendarDate:data.server_today.startsWith(state.month)?data.server_today:dateAt(state.month,1);
      const summary=daySummary(rows,selected);
      const labels={work:'預計上班',off:'已核准休假',pending:'待審休假',unconfirmed:'待確認'};
      return `<section class="dr-availability" aria-label="每月上班與休假人數"><p class="dr-calendar-help">目前篩選 ${rows.length} 位司機。上班依已送出報班估算，並非實際出勤；休假核准後才計入休假人數，未報班或不同意的申請列為待確認。</p><div class="dr-weekdays">${['日','一','二','三','四','五','六'].map(day=>`<span>${day}</span>`).join('')}</div><div class="dr-availability-grid">${'<div class="dr-availability-empty" aria-hidden="true"></div>'.repeat(first)}${Array.from({length:monthDays(state.month)},(_,index)=>{
        const date=dateAt(state.month,index+1), counts=daySummary(rows,date);
        return `<button type="button" class="dr-availability-day ${date===selected?'is-selected':''} ${date===data.server_today?'today':''}" data-dr-calendar-day="${date}" aria-pressed="${date===selected}" aria-label="${date} 預計上班 ${counts.work.length} 人，核准休假 ${counts.off.length} 人，待審休假 ${counts.pending.length} 人，待確認 ${counts.unconfirmed.length} 人"><time datetime="${date}">${index+1}</time><span class="dr-availability-count work">上班 <b data-dr-count="work">${counts.work.length}</b></span><span class="dr-availability-count off">休假 <b data-dr-count="off">${counts.off.length}</b></span>${counts.pending.length?`<span class="dr-availability-count pending">待審 <b data-dr-count="pending">${counts.pending.length}</b></span>`:''}${counts.unconfirmed.length?`<span class="dr-availability-count unconfirmed">待定 <b data-dr-count="unconfirmed">${counts.unconfirmed.length}</b></span>`:''}</button>`;
      }).join('')}</div><section class="dr-availability-detail" aria-label="當天司機名單"><h3>${dateLabel(selected)} · 當日名單</h3><div class="dr-availability-groups">${Object.entries(labels).map(([key,label])=>`<section class="${key}"><h4>${label} <b>${summary[key].length}</b></h4><div>${summary[key].map(row=>`<span>${escape(row.driver_name)}</span>`).join('')||'<small>無</small>'}</div></section>`).join('')}</div><p class="dr-muted">休假審核請切換清單模式；審核後會同步更新日曆人數。</p></section></section>`;
    }

    function openAdminCalendar(id){
      const row=data.rows.find(row=>row.submission?.id===id);if(!row)return;const saved=row.submission,month=saved.month.slice(0,7),selected=new Set(saved.off_dates),dialog=document.createElement('dialog');let saving=false;
      const offset=new Date(Number(month.slice(0,4)),Number(month.slice(5))-1,1).getDay();
      dialog.className='dr-edit-dialog';dialog.setAttribute('aria-label','編輯司機休假日曆');
      dialog.innerHTML='<header><div><h3>'+escape(row.driver_name)+' · '+month.replace('-',' / ')+'</h3><p>後台調整不受禁休、限休或報班開放期間限制；保留原審核狀態。</p></div><button type="button" data-edit-close aria-label="關閉">×</button></header><form><div class="dr-calendar"><div class="dr-weekdays">'+['日','一','二','三','四','五','六'].map(d=>'<span>'+d+'</span>').join('')+'</div><div class="dr-days">'+'<span></span>'.repeat(offset)+Array.from({length:monthDays(month)},(_,i)=>{const date=dateAt(month,i+1);return '<button type="button" class="dr-day '+(selected.has(date)?'approved':'')+'" data-admin-edit-day="'+date+'" aria-pressed="'+selected.has(date)+'"><strong>'+(i+1)+'</strong><small>'+(selected.has(date)?'休假':'')+'</small></button>';}).join('')+'</div></div><div class="dr-edit-summary"><b data-edit-count>已選 '+selected.size+' 天</b>'+badge(saved)+'</div><label>修改備註（選填）<textarea name="note" maxlength="1000" rows="2" placeholder="例如：司機臨時調休"></textarea></label><p role="alert" data-edit-error></p><footer><button type="button" class="ghost-btn" data-edit-close>不儲存</button><button type="submit" class="primary-btn">儲存調整</button></footer></form>';
      document.body.appendChild(dialog);dialog.showModal();dialog.addEventListener('close',()=>{if(!dialog.open&&!saving)dialog.remove();});dialog.addEventListener('cancel',event=>{if(saving)event.preventDefault();});
      dialog.addEventListener('click',event=>{const button=event.target.closest('button');if(!button||saving)return;if(button.hasAttribute('data-edit-close')){dialog.close();return;}const date=button.dataset.adminEditDay;if(date){selected.has(date)?selected.delete(date):selected.add(date);button.classList.toggle('approved',selected.has(date));button.setAttribute('aria-pressed',String(selected.has(date)));button.querySelector('small').textContent=selected.has(date)?'休假':'';dialog.querySelector('[data-edit-count]').textContent='已選 '+selected.size+' 天';}});
      dialog.querySelector('form').addEventListener('submit',async event=>{event.preventDefault();if(saving)return;saving=true;dialog.close();const confirmed=await options.confirm('確定將 '+row.driver_name+' 的休假調整為 '+selected.size+' 天？不受休假限制，原審核狀態不變。','確認後台調整');dialog.showModal();if(!confirmed){saving=false;return;}
       const buttons=[...dialog.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);const submit=dialog.querySelector('[type=submit]');submit.textContent='儲存中…';
       try{await options.api('admin_edit_driver_reporting',{id:saved.id,revision:saved.revision,dates:[...selected].sort(),note:dialog.querySelector('[name=note]').value,confirmed:true});dialog.remove();await load(false);}catch(error){dialog.querySelector('[data-edit-error]').textContent=error.message;}finally{saving=false;buttons.forEach(b=>b.disabled=false);submit.textContent='儲存調整';}
      });
    }
    function rosterGrid(rows){return '<div class="dr-roster-wrap"><table class="dr-roster"><thead><tr><th>司機</th>'+Array.from({length:monthDays(state.month)},(_,i)=>{const day=dateAt(state.month,i+1),week=new Date(day+'T12:00:00+08:00').getDay();return '<th class="'+([0,6].includes(week)?'weekend':'')+'">'+(i+1)+'<small>'+['日','一','二','三','四','五','六'][week]+'</small></th>';}).join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr><th><strong>'+escape(row.driver_name)+'</strong><small>'+escape(row.dealer_name)+'</small></th>'+Array.from({length:monthDays(state.month)},(_,i)=>{const date=dateAt(state.month,i+1),off=row.submission?.off_dates?.includes(date)&&row.submission.status!=='rejected',note=(data.roster?.notes||[]).find(n=>n.driver_id===row.driver_id&&n.work_on===date),events=(data.roster?.schedules||[]).filter(e=>e.driver_id===row.driver_id&&e.event_date===date);return '<td tabindex="0" data-roster-driver="'+row.driver_id+'" data-roster-date="'+date+'" class="'+(off?(row.submission.status==='approved'?'roster-off':'roster-pending'):'')+'" aria-label="'+escape(row.driver_name+' '+date+' 編輯備註')+'">'+(off?'<span class="roster-leave">'+(row.submission.status==='approved'?'休假':'待審休假')+'</span>':'')+events.map(e=>'<span class="roster-maintenance">'+({maintenance:'保養',repair:'維修',tires:'調胎'})[e.event_type]+(e.completed?' ✓':'')+'</span>').join('')+(note?.note?'<p>'+escape(note.note)+'</p>':'')+'</td>';}).join('')+'</tr>').join('')+'</tbody></table></div>';}
    function editRoster(cell){if(options.driver||busy)return;const driverId=cell.dataset.rosterDriver,date=cell.dataset.rosterDate,row=data.rows.find(r=>r.driver_id===driverId),existing=(data.roster?.notes||[]).find(n=>n.driver_id===driverId&&n.work_on===date);const dialog=document.createElement('dialog');dialog.className='dr-roster-editor';dialog.innerHTML='<form><h3>'+escape(row.driver_name)+' · '+date+'</h3><label>當日任務／備註<textarea name="note" rows="5" maxlength="1000">'+escape(existing?.note||'')+'</textarea></label><p class="dr-muted">休假與保養由原流程同步，此處只編輯任務備註。</p><p role="alert" data-error></p><footer><button type="button" class="ghost-btn" data-close>關閉</button><button class="primary-btn">儲存</button></footer></form>';document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();let saving=false;dialog.querySelector('form').onsubmit=async event=>{event.preventDefault();if(saving)return;saving=true;const button=dialog.querySelector('.primary-btn');button.disabled=true;button.textContent='儲存中…';try{await options.api('save_driver_roster_note',{driver_id:driverId,date,note:dialog.querySelector('textarea').value,revision:existing?.revision||0});dialog.close();await load(false);}catch(error){dialog.querySelector('[data-error]').textContent=error.message;}finally{saving=false;button.disabled=false;button.textContent='儲存';}};}
    root.addEventListener('dblclick',event=>{const cell=event.target.closest('[data-roster-driver]');if(cell)editRoster(cell);});root.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.matches('[data-roster-driver]'))editRoster(event.target);});
    function adminView() {
      const rows=data.rows||[], submitted=rows.filter(row=>row.submission), pending=submitted.filter(row=>row.submission.status==='pending');
      const filtered=rows.filter(row=>(!state.dealer||row.dealer_id===state.dealer)&&(!state.search||`${row.driver_name} ${row.dealer_name}`.includes(state.search))&&(state.filter==='all'||(state.filter==='none'?!row.submission:row.submission?.status===state.filter)));
      const dealers=[...new Map(rows.filter(row=>row.dealer_id).map(row=>[row.dealer_id,row.dealer_name])).entries()];
      const calendarRows=rows.filter(row=>(!state.dealer||row.dealer_id===state.dealer)&&(!state.search||`${row.driver_name} ${row.dealer_name}`.includes(state.search)));
      return monthPicker()+settings()+`<div class="dr-stats"><div><small>應報班司機／含本月歷史紀錄</small><b>${rows.length}</b></div><div><small>已送出</small><b>${submitted.length}</b></div><div class="pending"><small>待審核</small><b>${pending.length}</b></div><div class="approved"><small>已同意</small><b>${submitted.filter(row=>row.submission.status==='approved').length}</b></div></div><article class="dr-panel"><div class="dr-list-toolbar"><div class="dr-view-switch" role="group" aria-label="報班顯示模式">${[["list","清單"],["calendar","日曆"],["roster","班表"]].map(([key,label])=>`<button type="button" class="ghost-btn" data-dr-mode="${key}" aria-pressed="${(state.mode||"list")===key}">${label}</button>`).join("")}</div><div class="dr-filters"><label>姓名／車商<input type="search" data-dr-search value="${escape(state.search)}" placeholder="搜尋司機或車商"></label><label>車商<select data-dr-dealer><option value="">全部車商</option>${dealers.map(([id,name])=>`<option value="${id}" ${state.dealer===id?'selected':''}>${escape(name)}</option>`).join('')}</select></label>${state.mode==='calendar'?'':`<label>審核狀態<select data-dr-filter>${[['all','全部'],['pending','待審核'],['approved','已同意'],['rejected','不同意'],['none','尚未報班']].map(([value,label])=>`<option value="${value}" ${state.filter===value?'selected':''}>${label}</option>`).join('')}</select></label>`}</div><button class="ghost-btn" data-dr="export">匯出清單 CSV</button></div>${state.mode==='roster'?rosterGrid(calendarRows):state.mode==='calendar'?availabilityCalendar(calendarRows):`<div class="dr-table-wrap"><table class="dr-table"><thead><tr><th>司機／所屬車商</th><th>休假日期</th><th>狀態／天數</th><th>審核</th></tr></thead><tbody>${filtered.map(row=>{
        const s=row.submission;
        return `<tr><td><strong>${escape(row.driver_name)}</strong><small>${escape(row.dealer_name)}</small></td><td><div class="dr-date-chips">${s?s.off_dates.map(date=>`<span class="${s.status}">${Number(date.slice(-2))} 日</span>`).join('')||'<span class="dr-muted">本月不排休</span>':'<span class="dr-muted">尚未送出</span>'}</div></td><td>${s?`${badge(s)}<small>${s.off_dates.length} 天／排定 ${s.allowed_days} 天</small>${s.off_dates.length>s.allowed_days?'<small class="dr-over">超過排定天數</small>':''}`:'—'}</td><td>${s?.status==='pending'?`<div class="dr-review-actions"><button class="primary-btn" data-dr-approve="${s.id}" ${busy?'disabled':''}>同意</button><button class="ghost-btn" data-dr-reject="${s.id}" ${busy?'disabled':''}>不同意</button></div>`:s?`<small>${escape(s.reviewer_name||'')}</small><small>${escape(s.review_reason||'')}</small>`:'—'}${s?`<button type="button" class="ghost-btn dr-edit-calendar-button" data-dr-edit="${s.id}" ${busy?'disabled':''}>編輯日曆</button>${s.admin_edited_at?'<small>後台已調整</small>':''}`:''}</td></tr>`;
      }).join('')||'<tr><td colspan="4" class="dr-empty">目前沒有符合條件的司機</td></tr>'}</tbody></table></div>`}</article><details class="dr-panel dr-audit"><summary>操作紀錄（最近 100 筆）</summary>${(data.audit||[]).map(item=>`<div><strong>${escape(item.actor?.name)}</strong><span>${escape(({month_settings:'修改月份設定',submitted:'送出休假',approved:'同意休假',rejected:'不同意休假',admin_edited:'後台編輯休假'})[item.action]||item.action)}</span><small>${escape(new Date(item.created_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}))}</small>${item.details?.reason?`<p>${escape(item.details.reason)}</p>`:''}</div>`).join('')||'<p class="dr-muted">尚無操作紀錄</p>'}</details>`;
    }
    function paint(error = '') {
      if (!alive()) return;
      const rosterScroll=root.querySelector('.dr-roster-wrap')?.scrollLeft||0;
      root.innerHTML=shell((error?errorBox(error):'')+(data?(options.driver?driverView():adminView()):error?'<p class="dr-muted">請按重新整理重試。</p>':'<div class="dr-panel dr-loading" role="status"><span class="dr-spinner"></span> 正在載入報班資料…</div>'));
      if(root.querySelector('.dr-roster-wrap'))root.querySelector('.dr-roster-wrap').scrollLeft=rosterScroll;
    }
    async function load(autoSelect = true) {
      const request=++sequence; busy=true; paint();
      try {
        const response=await options.api('load_driver_reporting',{month:state.month});
        if (!alive()||request!==sequence) return;
        data=response.data;
        if (options.driver&&autoSelect&&!data.config&&data.months?.length) { state.month=data.months[0]; return await load(false); }
        state.selected=submission()?new Set(submission().off_dates):autoSelect?new Set([...state.selected].filter(date=>date.startsWith(state.month)&&!data.config?.blocked_dates.includes(date))):new Set(); state.blocked=new Set(data.config?.blocked_dates||[]); acknowledged=false;
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
      const button=event.target.closest('button');if(!button)return;if(button.dataset.dr==='back'){options.back?.();return;}if(busy)return;
      if(button.hasAttribute('data-dr-rule-add')){const list=root.querySelector('[data-dr-rules]');if(list.children.length>=20){options.alert('最多設定20組條件');return;}list.insertAdjacentHTML('beforeend',ruleFields());return;}if(button.hasAttribute('data-dr-rule-remove')){button.closest('[data-dr-rule-row]').remove();return;}
      if(button.dataset.drEdit){openAdminCalendar(button.dataset.drEdit);return;}
      if(['list','calendar','roster'].includes(button.dataset.drMode)) {state.mode=button.dataset.drMode;paint();return;}
      if(button.dataset.drCalendarDay) {state.calendarDate=button.dataset.drCalendarDay;paint();return;}
      const day=button.dataset.drDay, block=button.dataset.drBlock, action=button.dataset.dr;
      if (day&&open()&&!submission()&&!data.config.blocked_dates.includes(day)) {const next=new Set(state.selected);next.has(day)?next.delete(day):next.add(day);const rule=limitViolation(next);if(rule){paint(rule.start_on+' 至 '+rule.end_on+' 最多只能安排 '+rule.max_days+' 天休假');return;}state.selected=next;paint();}
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
      const rules=[...event.target.querySelectorAll('[data-dr-rule-row]')].map(row=>({start_on:row.querySelector('[data-rule-start]').value,end_on:row.querySelector('[data-rule-end]').value,max_days:Number(row.querySelector('[data-rule-max]').value)}));
      if(rules.some(rule=>!rule.start_on.startsWith(state.month)||!rule.end_on.startsWith(state.month)||rule.start_on>rule.end_on||!Number.isInteger(rule.max_days)||rule.max_days<0||rule.max_days>31)){await options.alert('請確認限休條件的日期與天數，期間須在所選月份內');return;}
      if(closes<opens){await options.alert('截止日期不可早於開放日期');return;}
      if(!await options.confirm('確定儲存此月份的開放期間、排定天數與禁休日？','儲存月份設定'))return;
      mutate('save_driver_reporting_month',{month:state.month,revision:data.config?.revision||0,config:{is_open:form.get('is_open')==='on',opens_on:opens,closes_on:closes,allowed_days:Number(form.get('allowed_days')),blocked_dates:[...state.blocked].sort(),range_rules:rules}});
    });
    if(!options.driver){let checking=false;const refreshTimer=setInterval(async()=>{if(!alive()){clearInterval(refreshTimer);return;}if(document.hidden||busy||checking||state.mode!=='roster'||document.querySelector('.dr-roster-editor'))return;checking=true;try{const response=await options.api('driver_roster_stamp',{month:state.month});if(alive()&&response.data!==data?.roster?.stamp)await load(false);}catch{}finally{checking=false;}},60000);}
    paint();load();
  }
  window.HeycarDriverReporting={mount,daySummary};
})();
