(function () {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  window.HeycarBoardManagement = {mount(root, {token, confirm}) {
    let settings = null, pairs = [], busy = false, error = '', status = '';
    let draftMarquee = '', draftNotices = [], weather = true, stock = true;
    const links = new Map();
    async function api(action, payload = {}) {
      const response = await fetch('/api/flight-board', {method:'POST', headers:{'Content-Type':'application/json','x-afide-session':token}, body:JSON.stringify({action,...payload}), signal:AbortSignal.timeout(20000)});
      const data = await response.json();
      if (!response.ok) throw Error(data.error || '看板設定失敗');
      return data;
    }
    function readDraft() {
      const form = root.querySelector('[data-board-settings="marquee"]');
      if (form) {draftMarquee = form.elements.marquee.value;weather = form.elements.ticker_weather.checked;stock = form.elements.ticker_stock.checked;}
      const notices = root.querySelector('[data-board-settings="announcements"]');
      if (notices) draftNotices = [...notices.querySelectorAll('[data-board-announcement]')].map(el => ({id:el.dataset.boardAnnouncement,title:el.querySelector('[name=title]').value,content:el.querySelector('[name=content]').value,active:el.querySelector('[name=active]').checked}));
    }
    function paint() {
      if (!root.isConnected) return;
      const disabled = busy ? ' disabled' : '';
      root.innerHTML = '<section class="board-admin"><header class="board-admin-heading"><h2>看板管理</h2><button type="button" class="ghost-btn" data-board-reload'+disabled+'>重新整理</button></header>'
        + '<p class="error" data-board-error role="alert">'+escape(error)+'</p><p class="board-save-status" data-board-result role="status">'+escape(status)+'</p>'
        + (!settings ? '<p>載入中…</p>' :
        '<div class="board-editor-grid"><form class="board-admin-panel" data-board-settings="marquee"><header><div><h3>電視跑馬燈</h3><p>每行一則，更新後自動套用至已連線的電視。</p></div></header>'
        + '<label class="board-field">公告文字<textarea name="marquee" rows="5" placeholder="每行一則，最多20則">'+escape(draftMarquee)+'</textarea></label>'
        + '<fieldset class="board-ticker-options"><legend>自動輪播資訊</legend><label><input type="checkbox" name="ticker_weather" '+(weather?'checked':'')+'>各地天氣、溫度與降雨機率</label><label><input type="checkbox" name="ticker_stock" '+(stock?'checked':'')+'>台股加權指數</label></fieldset>'
        + '<footer><small>天氣每30分鐘、台股每5分鐘共用更新；資料附來源時間。</small><button class="primary-btn" type="submit"'+disabled+'>更新跑馬燈</button></footer></form>'
        + '<form class="board-admin-panel" data-board-settings="announcements"><header><div><h3>公告內容</h3><p>電視只顯示標題與內文。</p></div><button class="ghost-btn" type="button" data-board-add'+disabled+'>＋ 新增公告</button></header>'
        + '<div class="board-admin-announcements">'+draftNotices.map(row => '<article data-board-announcement="'+escape(row.id)+'"><label class="board-field">標題<input name="title" maxlength="100" value="'+escape(row.title)+'"></label><label class="board-field">內文<textarea name="content" maxlength="2000" rows="3">'+escape(row.content)+'</textarea></label><div class="board-notice-actions"><label><input name="active" type="checkbox" '+(row.active!==false?'checked':'')+'>顯示於電視</label><button class="ghost-btn" type="button" data-board-remove="'+escape(row.id)+'"'+disabled+'>移除</button></div></article>').join('')+(draftNotices.length?'':'<p class="board-empty">尚未發布公告</p>')+'</div><footer><button class="primary-btn" type="submit"'+disabled+'>更新公告</button></footer></form></div>'
        + '<section class="board-admin-panel board-pair-panel"><header><div><h3>電視連結</h3><p>永久有效，可再次複製；停用後立即失效。</p></div></header><form data-board-pair><label class="board-field">電視名稱<input name="name" maxlength="80" placeholder="例如：接待大廳"></label><button class="primary-btn" type="submit"'+disabled+'>產生連結</button></form>'
        + '<div class="board-pair-list">'+pairs.map(pair => '<article><div class="board-pair-heading"><div><strong>'+escape(pair.name)+'</strong><small>私人連結 · 永久有效</small></div><div class="board-pair-actions"><button class="ghost-btn" type="button" data-board-copy="'+pair.id+'"'+disabled+'>複製連結</button><button class="ghost-btn" type="button" data-board-reveal="'+pair.id+'"'+disabled+'>顯示連結</button><button class="danger-btn" type="button" data-board-revoke="'+pair.id+'"'+disabled+'>停用</button></div></div>'+(links.has(pair.id)?'<div class="board-saved-link"><input readonly aria-label="永久看板連結" value="'+escape(links.get(pair.id))+'"><a class="ghost-btn" href="'+escape(links.get(pair.id))+'" target="_blank" rel="noopener">開啟看板</a></div>':'')+'</article>').join('')+(pairs.length?'':'<p class="board-empty">尚未建立電視連結</p>')+'</div></section>')+'</section>';
    }
    async function load(reset = true) {
      try {
        const [result, devices] = await Promise.all([api('settings_get'),api('pair_list')]);settings = result.settings;pairs = devices.pairs;error = '';
        if (reset) {draftMarquee = settings.marquee.join('\n');draftNotices = structuredClone(settings.announcements);weather = settings.ticker_weather!==false;stock = settings.ticker_stock!==false;}
      } catch (e) {error = e.message;}
      paint();
    }
    root.addEventListener('submit', async event => {
      event.preventDefault();event.stopPropagation();if(busy)return;
      readDraft();const scope=event.target.dataset.boardSettings,form=event.target;
      busy=true;error='';status='正在更新…';paint();
      try {
        if (scope) {
          const changed = scope==='marquee' ? {marquee:draftMarquee.split('\n').map(x=>x.trim()).filter(Boolean),ticker_weather:weather,ticker_stock:stock} : {announcements:draftNotices};
          settings = (await api('settings_save',{settings:{...settings,...changed}})).settings;
          status = scope==='marquee'?'跑馬燈已更新，連線中的看板將於5秒內套用':'公告已更新，連線中的看板將於5秒內套用';
          if(window.BroadcastChannel){const channel=new BroadcastChannel('heycar-flight-watches');channel.postMessage('settings');channel.close();}
        } else if (form.matches('[data-board-pair]')) {
          const result=await api('pair',{name:new FormData(form).get('name')});links.set(result.id,location.origin+'/flight-board#pair='+result.token);await load(false);status='連結已保存，之後可再次複製。';
        }
      } catch(e) {error=e.message;status='';}
      finally {busy=false;paint();}
    });
    root.addEventListener('click', async event => {
      const button=event.target.closest('button');if(!button||busy)return;
      readDraft();
      if(button.hasAttribute('data-board-reload')){status='';return load();}
      if(button.hasAttribute('data-board-add')){if(draftNotices.length<12){draftNotices.push({id:crypto.randomUUID(),title:'',content:'',active:true});paint();}return;}
      if(button.dataset.boardRemove){draftNotices=draftNotices.filter(row=>row.id!==button.dataset.boardRemove);paint();return;}
      const linkId=button.dataset.boardCopy||button.dataset.boardReveal;
      if(linkId){
        busy=true;error='';
        try {const result=await api('pair_link',{id:linkId});const url=location.origin+'/flight-board#pair='+result.token;links.set(linkId,url);status='連結已顯示，可隨時複製或開啟。';if(button.dataset.boardCopy){try{await navigator.clipboard.writeText(url);status='已複製永久連結';}catch{status='請選取下方連結複製。';}}}
        catch(e){error=e.message;status='';}finally{busy=false;paint();}return;
      }
      if(button.dataset.boardRevoke&&await confirm('確認停用此連結？使用它的電視將無法繼續連線。','停用看板')){
        busy=true;try{await api('revoke',{id:button.dataset.boardRevoke});links.delete(button.dataset.boardRevoke);await load(false);status='連結已停用';}catch(e){error=e.message;}finally{busy=false;paint();}
      }
    });
    paint();void load();
  }};
})();