// 自定义页面底色：编辑+预览区+左侧侧栏（大纲/文件夹）用用户 RGB，按亮度自动反色；关闭恢复主题默认。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { withEditor } = require('./helpers/app-env.cjs');

const CSS_RAW = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
// 注释里常提到类名（历史踩坑说明），必须先剥离再按选择器组切分，否则注释中的
// `.preview-content` 会被误判为「被 custom-bg-active 覆盖的选择器」。
const CSS = CSS_RAW.replace(/\/\*[\s\S]*?\*\//g, '');

// 取出所有「选择器里同时含 custom-bg-active 与 target」的规则声明文本
// （jsdom 不加载 styles.css，视觉只能靠源码契约护栏；按选择器组逐个切分，避免多行选择器组被整体忽略）。
function ruleBodies(target) {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  const out = [];
  while ((m = re.exec(CSS)) !== null) {
    const selectors = m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' '));
    const hit = selectors.some((s) => s.includes('custom-bg-active') && s.includes(target));
    if (hit) out.push(m[2]);
  }
  return out.join('\n');
}

test('defaultSettings 含自定义底色字段', async () => {
  await withEditor({}, async (w, ed) => {
    const d = ed.defaultSettings();
    assert.strictEqual(d.customBgEnabled, false, '默认关闭自定义底色');
    assert.strictEqual(typeof d.customBgColor, 'string', '默认底色为字符串');
  });
});

test('亮度计算：深色底色反白字，浅色底色反深字', async () => {
  await withEditor({}, async (w, ed) => {
    assert.ok(typeof ed._bgLuminance === 'function', '_bgLuminance 应存在');
    assert.ok(ed._bgLuminance('#000000') < 128, '黑底亮度低于阈值');
    assert.ok(ed._bgLuminance('#ffffff') >= 128, '白底亮度达到阈值');
  });
});

test('applyCustomBg：开启时设置 --custom-bg/--custom-fg，关闭时清除', async () => {
  await withEditor({}, async (w, ed) => {
    ed.settings.customBgEnabled = true;
    ed.settings.customBgColor = '#000000';
    ed.applyCustomBg();
    const html = w.document.documentElement;
    assert.strictEqual(html.style.getPropertyValue('--custom-bg').trim(), '#000000', '应设置底色变量');
    assert.ok(html.style.getPropertyValue('--custom-fg').trim(), '应设置前景变量');
    assert.ok(w.document.body.classList.contains('custom-bg-active'), 'body 应加 custom-bg-active 类');

    ed.settings.customBgEnabled = false;
    ed.applyCustomBg();
    assert.strictEqual(html.style.getPropertyValue('--custom-bg').trim(), '', '关闭后应清除底色变量');
    assert.ok(!w.document.body.classList.contains('custom-bg-active'), '关闭后应移除类名');
  });
});

test('styles.css: 自定义底色同时作用于左侧侧栏（大纲 / 文件夹），与编辑+预览区同色', () => {
  // 用户需求：左侧「文件夹 / 大纲」区域也要用自定义底色，与编辑、预览区一致。
  const sidebar = ruleBodies('.outline-sidebar');
  assert.match(
    sidebar,
    /background-color:\s*var\(--sidebar-bg/,
    '侧栏容器 .outline-sidebar 应改用自定义底色',
  );
  // 侧栏内部写死 var(--bg-primary) 的容器（标签栏、文件夹面板、文件夹头）由「本地变量重定义」跟随，
  // 不必逐个改选择器：--bg-primary 在 .outline-sidebar 子树内即自定义底色。
  assert.match(
    sidebar,
    /--bg-primary:\s*var\(--sidebar-bg\)/,
    '.outline-sidebar 应把 --bg-primary 重定义为自定义底色（经 --sidebar-bg 中转）',
  );
  assert.match(
    sidebar,
    /--sidebar-bg:\s*var\(--custom-bg/,
    '--sidebar-bg 应取自定义底色',
  );
});

test('styles.css: 侧栏变量重定义不得自引用（自定义属性循环会让整条声明失效）', () => {
  // 回归护栏：曾经写成 `--bg-primary: var(--custom-bg, var(--bg-primary))`，
  // 自引用构成循环 → 整条 background-color 判定为 invalid at computed-value time（底色丢失）。
  // 必须先由 --sidebar-bg 承接取色，再让主题变量单向指向它。
  const sidebar = ruleBodies('.outline-sidebar');
  for (const decl of sidebar.split(';')) {
    const m = /^\s*(--[a-z0-9-]+)\s*:\s*(.+)$/i.exec(decl);
    if (!m) continue;
    const [, name, value] = m;
    assert.ok(
      !value.includes(`var(${name}`),
      `${name} 的取值引用了自身（${value.trim()}），会形成自定义属性循环`,
    );
  }
});

test('styles.css: 侧栏文字/边框由 --custom-fg 派生，浅底深底都清晰', () => {
  // 主题的 --text-secondary / --border-color 是为「主题底色」调的，直接配用户自选色可能糊成一片；
  // 改为按 --custom-fg 降透明合成到自定义底色上，保留原有层级关系。
  const sidebar = ruleBodies('.outline-sidebar');
  assert.match(sidebar, /color:\s*var\(--sidebar-fg/, '侧栏文字应使用自定义前景色（随底色亮度反转）');
  for (const v of ['--text-secondary', '--bg-hover', '--border-color']) {
    assert.match(
      sidebar,
      new RegExp(v + ':\\s*color-mix\\([^;]*--sidebar-fg'),
      `${v} 应由前景色派生，避免与用户自选底色对比不足`,
    );
  }
  // 侧栏内的浮层（排序/筛选下拉、右键菜单）属于 chrome，保持主题底色
  for (const sel of ['.select-component-dropdown', '.context-menu']) {
    assert.strictEqual(ruleBodies(sel), '', `${sel} 不应被 custom-bg-active 覆盖（保持主题底色）`);
  }
});

test('styles.css: 自定义底色不得泄漏到预览内容区与更新对话框', () => {
  // 历史教训：`.preview-content` 曾被 custom-bg 覆盖，更新对话框说明区（复用同名类）跟着一起变色
  // （fix 2142aa2 收敛为仅 #preview）。本次扩到侧栏，仍须守住同一条边界。
  for (const sel of ['.preview-content', '.update-notes']) {
    assert.strictEqual(ruleBodies(sel), '', `${sel} 不应被 custom-bg-active 覆盖`);
  }
});
