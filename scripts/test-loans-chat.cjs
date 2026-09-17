const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { stripTypeScriptTypes } = require('node:module');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const backend = stripTypeScriptTypes(fs.readFileSync(path.join(root, 'supabase/functions/data-api/index.ts'), 'utf8'));

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `missing ${name}`);
  const rest = source.slice(start);
  const next = rest.slice(1).search(/\n(?:  )?(?:async )?function /);
  return rest.slice(0, next < 0 ? undefined : next + 1);
}

async function main() {
  const loans = [
    { id: 'mine', requested_by_admin_id: 'me', requested_by_name: '王小明', plate_no: 'ABC-1234', status: 'approved', borrow_at: '2026-09-17T08:00:00+08:00', return_at: '2026-09-17T18:00:00+08:00', purpose: '機場接送' },
    { id: 'other', requested_by_admin_id: 'other', requested_by_name: '陳美麗', plate_no: 'XYZ-5678', status: 'pending_approval', borrow_at: '2026-09-18T09:00:00+08:00', return_at: '2026-09-18T12:00:00+08:00', purpose: '公務使用' },
    { id: 'done', requested_by_admin_id: 'other', requested_by_name: '林先生', plate_no: 'OLD-0001', status: 'completed', borrow_at: '2026-09-10T09:00:00+08:00', return_at: '2026-09-10T12:00:00+08:00' }
  ];
  const backendContext = vm.createContext({
    tables: ['vehicle_loans'], tablePermission: { vehicle_loans: 'vehicleLoans' },
    adminCan: async () => false, dispatchRows: async () => [],
    db: { from(table) {
      let filters = [];
      const q = {
        select() { return this; }, order() { return this; },
        eq(key, value) { filters.push(row => row[key] === value); return this; },
        neq(key, value) { filters.push(row => row[key] !== value); return this; },
        single() { return Promise.resolve({ data: { id: 'me', name: '一般同仁', active: true, permissions: {} }, error: null }); },
        then(resolve, reject) {
          const rows = table === 'vehicle_loans' ? loans.filter(row => filters.every(fn => fn(row))) : [];
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        }
      };
      return q;
    }}
  });
  vm.runInContext('async ' + functionSource(backend, 'loadAdminData'), backendContext);
  const result = await backendContext.loadAdminData({ is_super_admin: false, admin_user_id: 'me', admin_name: '一般同仁' });
  assert.deepEqual(Array.from(result.data.vehicle_loans, row => row.id), ['mine', 'other']);

  const state = {
    admin: true,
    adminProfile: { id: 'me', name: '我', is_super_admin: false, permissions: {} },
    data: {
      vehicle_loans: loans.slice(0, 2),
      admin_users: [{ id: 'me', name: '我', active: true }, { id: 'amy', name: 'Amy', active: true }, { id: 'ben', name: 'Ben', active: true }],
      admin_chat_messages: [
        { id: 'm1', sender_id: 'amy', receiver_id: 'me', message: '請問車輛回來了嗎？', created_at: '2026-09-17T09:00:00+08:00', read_at: null },
        { id: 'm2', sender_id: 'me', receiver_id: 'ben', message: '收到', created_at: '2026-09-17T09:10:00+08:00', read_at: '2026-09-17T09:11:00+08:00' }
      ]
    },
    loanSearch: '', loanDateFilter: '', loanStatusFilter: '',
    adminChatContactId: 'amy', adminChatDraft: '', adminChatOpen: true, adminChatEmojiOpen: false, adminChatError: ''
  };
  const ctx = vm.createContext({
    state, Date, now: () => '2026-09-17T10:00:00+08:00',
    escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    formatDateTime: value => value ? '2026/09/17 ' + String(value).slice(11, 16) : '-',
    fmtDateTime: value => value ? String(value).slice(0, 16).replace('T', ' ') : '-',
    loanStatuses: [['pending_approval','待核准'],['approved','已核准'],['return_pending','待結案'],['completed','已完成']],
    activeKeyAccessCode: () => null
  });
  for (const name of ['currentAdminChatId','currentAdminChatName','adminChatContacts','adminChatMessages','adminChatMessagesMarkup','adminChatContactMessages','adminChatContactUnread','adminChatContactPreview','adminChatContactsMarkup','adminUnreadChatCount','adminChatContactName','adminChatWidget','adminVehicleLoans','loanStatusText','loanUsagePhase','loanStatusClass','loanTouchesDate']) {
    vm.runInContext(functionSource(app, name), ctx);
  }
  const loanHtml = ctx.adminVehicleLoans();
  assert(loanHtml.includes('王小明') && loanHtml.includes('陳美麗'));
  assert(loanHtml.includes('預借時間') && loanHtml.includes('目前借出與預借車輛'));
  assert(loanHtml.includes('目前誰正在使用車輛') && loanHtml.includes('loan-vehicle-icon'));
  const chatHtml = ctx.adminChatWidget();
  assert(chatHtml.includes('data-admin-chat-contact-button="amy"'));
  assert(chatHtml.includes('data-admin-chat-contact-button="ben"'));
  assert(!chatHtml.includes('<select data-admin-chat-contact'));
  assert(chatHtml.includes('請問車輛回來了嗎？'));

  const { chromium } = require('playwright');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.setContent(`<style>${css}</style><main>${loanHtml}${chatHtml}</main>`);
      assert.equal(await page.locator('.admin-chat-contact').count(), 3);
      if (width <= 700) {
        assert.equal(await page.locator('.admin-chat-widget').isVisible(), false);
      } else {
        assert(await page.locator('.admin-chat-contacts').isVisible());
        assert(await page.locator('.admin-chat-conversation').isVisible());
        assert((await page.locator('.admin-chat-conversation').boundingBox()).width >= 400);
      }
      assert(await page.locator('.loan-overview').isVisible());
      assert(await page.locator('.loan-in-use-section').isVisible());
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `horizontal overflow at ${width}`);
    }
  } finally {
    await browser.close();
  }
  console.log('PASS: active vehicle cards fit 320/390px; desktop chat stays wide at 768/1440px and is hidden on mobile');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
