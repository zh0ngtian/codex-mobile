import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const { JSDOM } = createRequire(import.meta.url)('jsdom');
const html = readFileSync(0, 'utf8');
const scenario = process.argv[2];
let now = 1000;
let nextTimer = 0;
const timers = new Map();
const dom = new JSDOM(html, {
  url: 'https://example.com/app/current/install.html',
  runScripts: scenario === 'no-javascript' ? 'outside-only' : 'dangerously',
  beforeParse(window) {
    window.Date.now = () => now;
    window.setTimeout = (callback, delay) => {
      const id = ++nextTimer;
      timers.set(id, { callback, at: now + delay });
      return id;
    };
    window.clearTimeout = (id) => timers.delete(id);
  },
});
const { window } = dom;
const { document } = window;
const link = document.querySelector('a[href^="itms-services:"]');
assert.ok(link, '安装链接必须始终保留');
const originalHref = link.href;
const status = document.querySelector('[role="status"]');
const spinner = document.querySelector('#install-spinner');
function click(options = {}) {
  let prevented;
  // 最后截获默认动作，避免 jsdom 尝试打开自定义协议；记录页面本身是否阻止了动作。
  document.addEventListener('click', (event) => {
    prevented = event.defaultPrevented;
    event.preventDefault();
  }, { once: true });
  link.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, ...options }));
  return prevented;
}
function waiting() {
  assert.ok(status, '页面缺少无障碍状态区域');
  assert.equal(status.getAttribute('aria-live'), 'polite');
  assert.match(status.textContent, /正在请求系统安装，请等待弹窗/);
  assert.equal(link.getAttribute('aria-disabled'), 'true');
  assert.ok(spinner && !spinner.hidden, '等待时应显示图标');
  assert.equal(link.href, originalHref);
}
function retry() {
  assert.notEqual(link.getAttribute('aria-disabled'), 'true');
  assert.match(link.textContent, /重新请求安装/);
  assert.match(status.textContent, /若未出现系统安装提示，请确认局域网连接后重试/);
  assert.doesNotMatch(status.textContent, /失败|成功|已安装/);
  assert.ok(spinner.hidden);
}
function runTimers() {
  for (const [id, timer] of [...timers]) {
    if (timer.at <= now) {
      timers.delete(id);
      timer.callback();
    }
  }
}
try {
  switch (scenario) {
    case 'first-click':
      assert.equal(click(), false, '首击必须立即保留系统协议默认动作');
      waiting();
      break;
    case 'repeat-click':
      click();
      assert.equal(click(), true, '等待期间重复点击必须阻止重复安装请求');
      waiting();
      break;
    case 'timeout':
      click();
      now += 14999; runTimers(); waiting();
      now += 1; runTimers(); retry();
      assert.equal(click(), false, '重试仍须保留系统协议默认动作');
      waiting();
      break;
    case 'foreground':
      for (const type of ['visibilitychange', 'pageshow']) {
        click();
        now += 5000;
        document.dispatchEvent(new window.Event('visibilitychange'));
        waiting();
        // Safari 后台冻结时不执行计时器，回来后应按真实截止时间恢复。
        now += 20000;
        (type === 'pageshow' ? window : document).dispatchEvent(new window.Event(type));
        retry();
      }
      break;
    case 'modified-click':
      for (const options of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
        assert.equal(click(options), false);
        assert.notEqual(link.getAttribute('aria-disabled'), 'true');
        assert.ok(!status || !status.textContent.trim());
      }
      click(); waiting();
      assert.equal(click({ metaKey: true }), true, '等待时所有重复点击均被拦截');
      break;
    case 'no-javascript':
      assert.equal(click(), false);
      assert.notEqual(link.getAttribute('aria-disabled'), 'true');
      assert.equal(document.querySelector('img'), null, '更新说明不能注入 HTML');
      assert.match(document.body.textContent, /<img src=x onerror=alert\(1\)> & 更新/);
      assert.match(document.body.textContent, /Codex Mobile v1\.2\.3/);
      assert.match(document.body.textContent, /SHA-256：[a-f0-9]{64}/);
      break;
    case 'reduced-motion':
      // jsdom 不应用 media query；核对 CSSOM 中同一选择器的 override，避免优先级失效。
      const rules = [...document.styleSheets[0].cssRules];
      const animated = rules.find((rule) => rule.style?.animation);
      const reduced = rules.find((rule) => rule.conditionText === '(prefers-reduced-motion: reduce)');
      assert.ok(animated && reduced, '缺少动画或减少动态效果规则');
      const override = [...reduced.cssRules].find((rule) => rule.selectorText === animated.selectorText);
      assert.ok(override, '减少动态效果必须覆盖动画规则的选择器优先级');
      assert.equal(override.style.animation, 'none');
      break;
    default:
      throw new Error(`未知测试场景：${scenario}`);
  }
} finally {
  dom.window.close();
}
