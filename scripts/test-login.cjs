const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `missing ${name}`);
  const rest = source.slice(start);
  const next = rest.slice(1).search(/\n(?:  )?(?:async )?function /);
  return rest.slice(0, next < 0 ? undefined : next + 1);
}

async function main() {
  const state = { data: { login_slogans: [
    { message: '第二句', active: true, sort_order: 2, created_at: '2026-09-20' },
    { message: '<第一句>', active: true, sort_order: 1, created_at: '2026-09-19' },
    { message: '停用句', active: false, sort_order: 0, created_at: '2026-09-20' },
    { message: '第三句', active: true, sort_order: 3, created_at: '2026-09-18' },
    { message: '第四句', active: true, sort_order: 4, created_at: '2026-09-17' }
  ] } };
  const context = vm.createContext({ state, escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') });
  vm.runInContext(functionSource(appSource, 'loginSloganMarkup'), context);
  const slogans = context.loginSloganMarkup();
  assert(slogans.includes('&lt;第一句&gt;'));
  assert(slogans.indexOf('第一句') < slogans.indexOf('第二句'));
  assert(slogans.includes('第三句'));
  assert(!slogans.includes('停用句') && !slogans.includes('第四句'));

  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  for (const file of ['login-a350-tail.webp', 'login-cabin.webp', 'login-wing-cloud.webp', 'login-engine-wing.webp']) {
    assert(css.includes(`./assets/${file}`), `${file} must be referenced`);
    assert(fs.statSync(path.join(root, 'assets', file)).size < 180000, `${file} is too large`);
  }
  const total = ['login-a350-tail.webp', 'login-cabin.webp', 'login-wing-cloud.webp', 'login-engine-wing.webp']
    .reduce((sum, file) => sum + fs.statSync(path.join(root, 'assets', file)).size, 0);
  assert(total < 400000, `login backgrounds total ${total} bytes`);
  assert(css.includes('.login-bg-slides.is-ready .login-bg-cabin'), 'secondary backgrounds must load after first paint');

  const { chromium } = require('playwright');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    const html = `<div class="login-wrap modern-air-login"><div class="login-bg-slides"><span class="login-bg-slide login-bg-a350"></span></div><header class="login-brand-bar"><div class="login-brand-lockup"><img alt="logo"></div></header><section class="login-panel single-login-panel"><div class="login-card"><div class="login-card-copy"><span class="login-eyebrow">HEY!CAR SERVICE PORTAL</span><h1>歡迎回來</h1>${slogans}</div><form class="form-grid"><div class="field full login-code-field"><label>登入代碼</label><div class="login-input-wrap"><svg></svg><input placeholder="請輸入手機號碼或登入代碼"></div></div><button class="primary-btn field full login-submit">登入系統</button></form></div></section></div>`;
    for (const width of [320, 390, 430, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.setContent(`<style>${css}</style>${html}`);
      assert(await page.locator('.login-panel').isVisible());
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `login overflow at ${width}`);
    }
  } finally {
    await browser.close();
  }
  console.log(`PASS: backend slogans render safely; four rotating WebP backgrounds total ${Math.round(total / 1024)} KB and login fits mobile/desktop`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
