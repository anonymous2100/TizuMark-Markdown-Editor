// 侧栏标签页改造（大纲 / 文件夹左右标签二选一）回归测试：
// - 顶部 #sidebar-tabs 存在两个 tab，顺序为「大纲」在前、「文件夹」在后
// - 同一时刻只有一个 .sidebar-tab-panel 可见（hidden 类互斥）
// - settings.sidebarTab 持久化手动选择；打开 md 文件自动切到大纲（不覆盖偏好）
// - 大纲层级过滤（outlineFilterLevel）按 maxLevel 裁剪渲染
const test = require('node:test');
const assert = require('node:assert');
const { buildEnv, cleanup, delay } = require('./helpers/app-env.cjs');
const Outline = require('../src/modules/outline.js');
const fs = require('fs');
const path = require('path');
// jsdom 不加载 styles.css，computed style 断言不可靠；视觉状态由 CSS 规则保证，
// 这里直接校验源码中存在对应规则作为回归护栏。
const STYLES = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');

async function makeEditor() {
  const { w, getInitErr } = await buildEnv({ captureInitErr: true });
  await delay(300);
  return { w, ed: w.editor, getInitErr };
}

function sampleEntries() {
  return [
    { name: 'c.md', path: '/root/c.md', is_dir: false, mtime: 300, size: 2048 },
    { name: 'a.md', path: '/root/a.md', is_dir: false, mtime: 100, size: 512 },
    { name: 'proj', path: '/root/proj', is_dir: true, mtime: 50, size: 0 },
    { name: 'docs', path: '/root/docs', is_dir: true, mtime: 10, size: 0 },
  ];
}

test('sidebar-tabs: 顶部标签栏存在且顺序为大纲 → 文件夹', async () => {
  const { w, getInitErr } = await makeEditor();
  try {
    assert.strictEqual(getInitErr(), null, '初始化不应报错');
    const tabs = Array.from(w.document.querySelectorAll('#sidebar-tabs .sidebar-tab'));
    assert.strictEqual(tabs.length, 2, '应恰好有两个标签页');
    assert.deepStrictEqual(tabs.map((t) => t.dataset.tab), ['outline', 'files'], '第一个是大纲，第二个是文件夹');
    assert.strictEqual(tabs[0].id, 'sidebar-tab-outline');
    assert.strictEqual(tabs[1].id, 'sidebar-tab-files');
    // 分屏时代的水平拖拽条与折叠 chevron 应已移除
    assert.strictEqual(w.document.getElementById('sidebar-h-resizer'), null, '#sidebar-h-resizer 应已移除');
    assert.strictEqual(w.document.getElementById('files-chevron'), null, '#files-chevron 应已移除');
    assert.strictEqual(w.document.getElementById('outline-chevron'), null, '#outline-chevron 应已移除');
    // 旧 API 应已删除
    for (const fn of ['initSplitter', 'applySplitterRatio', 'applyPanelCollapse', 'togglePanel']) {
      assert.strictEqual(typeof ed_missing(w, fn), 'undefined', `旧 API ${fn} 应已删除`);
    }
  } finally { cleanup(w); }
});

function ed_missing(w, name) {
  return w.editor[name];
}

test('sidebar-tabs: 默认展示大纲标签页、文件夹面板隐藏', async () => {
  const { w, ed, getInitErr } = await makeEditor();
  try {
    assert.strictEqual(getInitErr(), null, '初始化不应报错');
    const outlinePanel = w.document.getElementById('outline-panel');
    const folderPanel = w.document.getElementById('folder-panel');
    const outlineTab = w.document.getElementById('sidebar-tab-outline');
    const filesTab = w.document.getElementById('sidebar-tab-files');
    assert.ok(outlinePanel && folderPanel, '两个 tab-panel 都应存在');
    assert.ok(!outlinePanel.classList.contains('hidden'), '默认大纲面板应可见');
    assert.ok(folderPanel.classList.contains('hidden'), '默认文件夹面板应隐藏');
    assert.ok(outlineTab.classList.contains('active'), '默认大纲 tab 应为 active');
    assert.ok(!filesTab.classList.contains('active'), '文件夹 tab 默认不应 active');
    assert.strictEqual(outlineTab.getAttribute('aria-selected'), 'true');
    assert.strictEqual(filesTab.getAttribute('aria-selected'), 'false');
    // 默认值来自 settings.sidebarTab
    assert.strictEqual(ed.settings.sidebarTab, 'outline');
  } finally { cleanup(w); }
});

test('sidebar-tabs: 点击文件夹 tab 切到文件面板并持久化', async () => {
  const { w, ed, getInitErr } = await makeEditor();
  try {
    assert.strictEqual(getInitErr(), null, '初始化不应报错');
    const outlinePanel = w.document.getElementById('outline-panel');
    const folderPanel = w.document.getElementById('folder-panel');
    const filesTab = w.document.getElementById('sidebar-tab-files');

    filesTab.click();
    assert.ok(!folderPanel.classList.contains('hidden'), '点击后文件夹面板应可见');
    assert.ok(outlinePanel.classList.contains('hidden'), '点击后大纲面板应隐藏');
    assert.ok(filesTab.classList.contains('active'));
    assert.strictEqual(filesTab.getAttribute('aria-selected'), 'true');
    assert.strictEqual(ed.settings.sidebarTab, 'files', '手动切换应持久化 sidebarTab=files');

    // 切回大纲
    w.document.getElementById('sidebar-tab-outline').click();
    assert.ok(!outlinePanel.classList.contains('hidden'));
    assert.ok(folderPanel.classList.contains('hidden'));
    assert.strictEqual(ed.settings.sidebarTab, 'outline');
  } finally { cleanup(w); }
});

test('sidebar-tabs: 非法 tab 名不改变状态', async () => {
  const { w, ed, getInitErr } = await makeEditor();
  try {
    assert.strictEqual(getInitErr(), null, '初始化不应报错');
    const outlinePanel = w.document.getElementById('outline-panel');
    ed.switchSidebarTab('nope');
    assert.ok(!outlinePanel.classList.contains('hidden'), '非法 tab 名不应改变可见面板');
    assert.strictEqual(ed.settings.sidebarTab, 'outline');
  } finally { cleanup(w); }
});

test('sidebar-tabs: persist=false 不覆盖用户偏好（打开 md 自动切大纲）', async () => {
  const { w, ed, getInitErr } = await makeEditor();
  try {
    assert.strictEqual(getInitErr(), null, '初始化不应报错');
    // 用户手动选了「文件夹」
    ed.switchSidebarTab('files', { persist: true });
    assert.strictEqual(ed.settings.sidebarTab, 'files');

    // 打开 md 文件 → 自动切到大纲，但不写回偏好
    ed.revealOutlineForDoc('markdown');
    const outlinePanel = w.document.getElementById('outline-panel');
    assert.ok(!outlinePanel.classList.contains('hidden'), '打开 md 后应展示大纲面板');
    assert.strictEqual(ed.settings.sidebarTab, 'files', '自动切换不应覆盖用户手动偏好');

    // 非 markdown 不触发切换
    ed.switchSidebarTab('files', { persist: false });
    ed.revealOutlineForDoc('image');
    assert.ok(w.document.getElementById('folder-panel').classList.contains('hidden') === false, '图片文件不应触发切换到大纲');
    ed.revealOutlineForDoc('text');
    assert.ok(!w.document.getElementById('folder-panel').classList.contains('hidden'), '纯文本文件不应触发切换到大纲');
  } finally { cleanup(w); }
});

test('sidebar-tabs: applySidebarTab 按 settings.sidebarTab 还原', async () => {
  const { w, ed, getInitErr } = await makeEditor();
  try {
    assert.strictEqual(getInitErr(), null, '初始化不应报错');
    ed.settings.sidebarTab = 'files';
    ed.applySidebarTab();
    assert.ok(!w.document.getElementById('folder-panel').classList.contains('hidden'), 'files 应还原为文件夹面板');
    ed.settings.sidebarTab = 'outline';
    ed.applySidebarTab();
    assert.ok(!w.document.getElementById('outline-panel').classList.contains('hidden'), 'outline 应还原为大纲面板');
    // 脏数据兜底：非法值回落大纲
    ed.settings.sidebarTab = 'garbage';
    ed.applySidebarTab();
    assert.ok(!w.document.getElementById('outline-panel').classList.contains('hidden'), '非法值应回落到大纲');
  } finally { cleanup(w); }
});

test('sidebar-tabs: 打开工作区文件夹切到文件夹标签页', async () => {
  const { w, ed, getInitErr } = await makeEditor();
  try {
    assert.strictEqual(getInitErr(), null, '初始化不应报错');
    w.TauriApi.listDir = async () => sampleEntries();
    const origAdd = ed.addRecentWorkspace;
    ed.addRecentWorkspace = () => {};
    ed.startFolderWatch = async () => {};
    await ed.openFolderPath('/root');
    assert.ok(!w.document.getElementById('folder-panel').classList.contains('hidden'), '打开工作区应展示文件树');
    assert.strictEqual(ed.settings.sidebarTab, 'files', '打开工作区应持久化为 files');
    ed.addRecentWorkspace = origAdd;
  } finally { cleanup(w); }
});

test('sidebar-tabs: 文件树与大纲同时渲染到各自面板', async () => {
  const { w, ed } = await makeEditor();
  try {
    w.TauriApi.listDir = async () => sampleEntries();
    ed.workspaceFolder = '/root';
    await ed.renderFolderTree();
    const treeLabels = Array.from(w.document.querySelectorAll('#folder-tree .tree-label')).map((e) => e.textContent);
    assert.deepStrictEqual(treeLabels, ['docs', 'proj', 'a.md', 'c.md']);

    // 大纲随内容渲染到 #outline-content
    ed.cm.setValue('# 标题一\n## 子标题\n# 标题二\n');
    ed.updateOutline();
    const items = w.document.querySelectorAll('#outline-content .outline-item');
    assert.ok(items.length >= 3, '大纲应渲染多个标题项');
  } finally { cleanup(w); }
});

test('sidebar-tabs: showSidebar 确保侧栏可见（替代旧 showSidebarTab）', async () => {
  const { w, ed } = await makeEditor();
  try {
    const sidebar = w.document.getElementById('outline-sidebar');
    sidebar.classList.add('hidden');
    ed.settings.sidebarHidden = true;
    ed.showSidebar();
    assert.ok(!sidebar.classList.contains('hidden'), 'showSidebar 后侧栏应可见');
    assert.strictEqual(ed.settings.sidebarHidden, false);
    assert.strictEqual(typeof ed.showSidebarTab, 'undefined', '旧 showSidebarTab 应已删除');
  } finally { cleanup(w); }
});

test('sidebar-tabs: 大纲层级过滤 maxLevel 裁剪渲染', async () => {
  const { w, ed } = await makeEditor();
  try {
    const md = [
      '# H1',
      '## H2',
      '### H3',
      '#### H4',
      '##### H5',
      '###### H6',
      '# H1-2',
    ].join('\n');
    ed.cm.setValue(md);
    ed.settings.outlineFilterLevel = 0; // 全部
    ed.updateOutline();
    let items = w.document.querySelectorAll('#outline-content .outline-item');
    assert.strictEqual(items.length, 7, '全部时应渲染 7 个标题');

    ed.settings.outlineFilterLevel = 2; // 仅 H1–H2
    ed.updateOutline();
    items = w.document.querySelectorAll('#outline-content .outline-item');
    assert.strictEqual(items.length, 3, '过滤到 H2 时应为 3 个（2×H1 + 1×H2）');
    // 渲染结果不得包含 level-3 及更深
    const deep = w.document.querySelectorAll('#outline-content .outline-item.level-3, #outline-content .outline-item.level-4, #outline-content .outline-item.level-5, #outline-content .outline-item.level-6');
    assert.strictEqual(deep.length, 0, '不应渲染 H3 及以下');
  } finally { cleanup(w); }
});

test('sidebar-tabs: renderOutlineHtml maxLevel 纯函数（父节点保留、深子树跳过）', async () => {
  const { w } = await makeEditor();
  try {
    const headings = Outline.extractHeadings('# A\n## B\n### C\n## D\n', {});
    const tree = Outline.buildOutlineTree(headings);
    const html = Outline.renderOutlineHtml(tree, { escapeHtml: (s) => s, maxLevel: 2 });
    assert.ok(html.includes('level-1'), '应含 H1');
    assert.ok(html.includes('level-2'), '应含 H2');
    assert.ok(!html.includes('level-3'), '不应含 H3');
  } finally { cleanup(w); }
});

test('sidebar-tabs: outline-filter 下拉存在并切换过滤级别', async () => {
  const { w, ed } = await makeEditor();
  try {
    const filterHost = w.document.getElementById('outline-filter');
    assert.ok(filterHost, '#outline-filter 容器应存在');
    assert.ok(ed._outlineFilterSelect, '大纲过滤下拉应已自绘为 Select 组件');

    ed.cm.setValue('# H1\n## H2\n### H3\n');
    ed.settings.outlineFilterLevel = 0;
    ed.updateOutline();
    assert.strictEqual(w.document.querySelectorAll('#outline-content .outline-item').length, 3);

    // 模拟用户在下拉列表中点击「仅 H1–H2」（value='2'）：先 open 渲染选项，再点击选项触发 onChange
    ed._outlineFilterSelect.open();
    const opt = filterHost.querySelector('.select-component-item[data-value="2"]');
    assert.ok(opt, '下拉应渲染 value=2 的选项');
    opt.dispatchEvent(new w.window.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(ed.settings.outlineFilterLevel, 2, '切换后 setting 应为 2');
    await delay(10);
    assert.strictEqual(w.document.querySelectorAll('#outline-content .outline-item').length, 2, '过滤后仅 2 项');
  } finally { cleanup(w); }
});

test('sidebar-tabs: 两个面板头部各带标题与操作按钮', async () => {
  const { w, getInitErr } = await makeEditor();
  try {
    assert.strictEqual(getInitErr(), null, '初始化不应报错');
    // 标签栏文字
    const outlineTab = w.document.getElementById('sidebar-tab-outline');
    const filesTab = w.document.getElementById('sidebar-tab-files');
    assert.strictEqual(outlineTab.querySelector('.sidebar-tab-label').textContent.trim(), '大纲');
    assert.strictEqual(filesTab.querySelector('.sidebar-tab-label').textContent.trim(), '文件夹');
    assert.ok(outlineTab.querySelector('.sidebar-tab-icon'), '大纲 tab 应带图标');
    assert.ok(filesTab.querySelector('.sidebar-tab-icon'), '文件夹 tab 应带图标');

    // 文件头：图标 + 「文件」标题（点击切换工作区）
    const filesHeader = w.document.querySelector('.files-panel-header');
    assert.ok(filesHeader, '.files-panel-header 应存在');
    assert.ok(filesHeader.querySelector('.panel-title-icon'), '文件头应带图标');
    assert.strictEqual(filesHeader.querySelector('.panel-title').textContent.trim(), '文件', '文件头标题应为「文件」');

    // 大纲面板头只保留操作区（筛选 + 全部）
    const outlineHeader = w.document.querySelector('.outline-panel-header');
    assert.ok(outlineHeader, '.outline-panel-header 应存在');
    assert.ok(w.document.getElementById('outline-filter'), '大纲筛选应存在');
    assert.ok(w.document.getElementById('btn-all-folders'), '文件全部按钮应存在');
    assert.ok(w.document.getElementById('btn-all-outline'), '大纲全部按钮应存在');
  } finally { cleanup(w); }
});

test('sidebar-tabs: 一键全部展开/折叠文件目录', async () => {
  const { w, ed, getInitErr } = await makeEditor();
  try {
    assert.strictEqual(getInitErr(), null, '初始化不应报错');
    // 多级目录：/root/proj/sub
    const tree = {
      '/root': [
        { name: 'a.md', path: '/root/a.md', is_dir: false, mtime: 1, size: 1 },
        { name: 'proj', path: '/root/proj', is_dir: true, mtime: 1, size: 0 },
      ],
      '/root/proj': [
        { name: 'sub', path: '/root/proj/sub', is_dir: true, mtime: 1, size: 0 },
      ],
      '/root/proj/sub': [
        { name: 'b.md', path: '/root/proj/sub/b.md', is_dir: false, mtime: 1, size: 1 },
      ],
    };
    w.TauriApi.listDir = async (args) => tree[args.path] || [];
    ed.workspaceFolder = '/root';
    await ed.renderFolderTree();

    // 默认全折叠：所有 .tree-children 隐藏
    let hiddenCount = w.document.querySelectorAll('#folder-tree .tree-children.hidden').length;
    assert.ok(hiddenCount >= 1, '默认应存在隐藏的子目录块');

    // 一键展开
    await ed.toggleAllFolders(true);
    const allFolders = w.document.querySelectorAll('#folder-tree .tree-node.tree-folder');
    const visibleChildren = w.document.querySelectorAll('#folder-tree .tree-children:not(.hidden)');
    assert.strictEqual(allFolders.length, 2, '应渲染 2 个目录节点（proj、sub）');
    assert.strictEqual(visibleChildren.length, 2, '展开后两个子目录块都应可见');
    assert.ok(ed.expandedFolders.has('/root/proj'), 'expandedFolders 应含 /root/proj');
    assert.ok(ed.expandedFolders.has('/root/proj/sub'), 'expandedFolders 应含 /root/proj/sub');

    // 一键折叠
    await ed.toggleAllFolders(false);
    // 重渲染后所有已渲染的 .tree-children 都应隐藏（子目录懒加载未展开属正常）
    const allChildren = w.document.querySelectorAll('#folder-tree .tree-children');
    const hiddenAfter = w.document.querySelectorAll('#folder-tree .tree-children.hidden').length;
    assert.strictEqual(hiddenAfter, allChildren.length, '折叠后所有已渲染子目录块都应隐藏');
    assert.strictEqual(ed.expandedFolders.size, 0, 'expandedFolders 应清空');
  } finally { cleanup(w); }
});

test('sidebar-tabs: 一键全部展开/折叠大纲', async () => {
  const { w, ed, getInitErr } = await makeEditor();
  try {
    assert.strictEqual(getInitErr(), null, '初始化不应报错');
    // 构造带嵌套的大纲 DOM（H1 > H2 > H3）
    const content = w.document.getElementById('outline-content');
    content.innerHTML = [
      '<div class="outline-item-wrapper"><div class="outline-item level-1" data-id="1" data-line="1"><span class="outline-toggle"><svg viewBox="0 0 10 10" fill="currentColor"><path d="M1.5 1.5 L8.5 1.5 L5 8.5 Z"/></svg></span><span class="outline-label">A</span></div>',
      '<div class="outline-children"><div class="outline-item-wrapper"><div class="outline-item level-2" data-id="2" data-line="2"><span class="outline-toggle"><svg viewBox="0 0 10 10" fill="currentColor"><path d="M1.5 1.5 L8.5 1.5 L5 8.5 Z"/></svg></span><span class="outline-label">B</span></div>',
      '<div class="outline-children"><div class="outline-item-wrapper"><div class="outline-item level-3" data-id="3" data-line="3"><span class="outline-toggle outline-toggle--hidden"><svg viewBox="0 0 10 10" fill="currentColor"><path d="M1.5 1.5 L8.5 1.5 L5 8.5 Z"/></svg></span><span class="outline-label">C</span></div></div></div>',
      '</div></div></div>',
    ].join('');
    // 注意：不调用 updateOutline()，否则会用编辑器真实内容覆盖手造的嵌套 DOM。
    // 本用例只验证 toggleAllOutline 对现有 DOM 的批量折叠/展开行为。

    // 初始全部展开
    let collapsed = content.querySelectorAll('.outline-children.collapsed').length;
    assert.strictEqual(collapsed, 0, '初始应无折叠块');

    // 一键折叠
    ed.toggleAllOutline(false);
    collapsed = content.querySelectorAll('.outline-children.collapsed').length;
    assert.strictEqual(collapsed, 2, '折叠后应有 2 个折叠块');
    const toggles = content.querySelectorAll('.outline-toggle:not(.outline-toggle--hidden)');
    toggles.forEach((t) => assert.ok(t.classList.contains('collapsed'), '折叠后 toggle 应带 collapsed 类（CSS 旋转成 ▶）'));

    // 一键展开
    ed.toggleAllOutline(true);
    collapsed = content.querySelectorAll('.outline-children.collapsed').length;
    assert.strictEqual(collapsed, 0, '展开后应无折叠块');
    toggles.forEach((t) => assert.ok(!t.classList.contains('collapsed'), '展开后 toggle 不应带 collapsed 类（恢复 ▼ 向下）'));
  } finally { cleanup(w); }
});

test('sidebar-tabs: 点击文件面板标题切换工作区 + 点击目录路径打开所在文件夹', async () => {
  const { w, ed, getInitErr } = await makeEditor();
  try {
    assert.strictEqual(getInitErr(), null, '初始化不应报错');
    const filesHeader = w.document.querySelector('.files-panel-header .panel-title-group');
    const folderPathEl = w.document.getElementById('folder-path');
    assert.ok(filesHeader, '文件面板标题区域应存在');
    assert.ok(folderPathEl, '目录路径元素应存在');

    const origWs = ed.workspaceFolder;
    const origPick = ed.openFolder;
    const origOpen = ed.openContainingFolder;

    // 已打开工作区：点击「文件」标题 → 仍弹出文件夹选择（openFolder()），选中后切换工作区
    ed.workspaceFolder = 'C:\\workspace\\notes';
    let picked = 0;
    ed.openFolder = async () => { picked++; };
    filesHeader.click();
    await new Promise(r => setTimeout(r, 20));
    assert.strictEqual(picked, 1, '已打开工作区时点击标题也应弹出文件夹选择');

    // 已打开工作区：点击目录路径 → openContainingFolder(工作区, true)（isDir=true 打开文件夹自身）
    let opened = null;
    ed.openContainingFolder = async (p, isDir) => { opened = { p, isDir }; };
    folderPathEl.click();
    await new Promise(r => setTimeout(r, 20));
    assert.deepStrictEqual(opened, { p: 'C:\\workspace\\notes', isDir: true }, '点击路径应打开该文件夹（isDir=true）');

    // 未打开工作区：点击标题 → openFolder()；点击路径（无工作区）→ 不动作
    ed.workspaceFolder = null;
    picked = 0;
    filesHeader.click();
    await new Promise(r => setTimeout(r, 20));
    assert.strictEqual(picked, 1, '未打开工作区时点击标题应调用 openFolder()');
    opened = null;
    folderPathEl.click();
    await new Promise(r => setTimeout(r, 20));
    assert.strictEqual(opened, null, '未打开工作区时点击路径不应触发打开动作');

    ed.openFolder = origPick;
    ed.openContainingFolder = origOpen;
    ed.workspaceFolder = origWs;
  } finally { cleanup(w); }
});

test('sidebar-tabs: 「上一级」按钮切换到上级目录 + 到根禁用', async () => {
  const { w, ed, getInitErr } = await makeEditor();
  try {
    assert.strictEqual(getInitErr(), null, '初始化不应报错');
    const upBtn = w.document.getElementById('folder-up');
    assert.ok(upBtn, '「上一级」按钮应存在');

    // 上级目录计算：Windows / 盘符根 / POSIX / POSIX 根
    ed.workspaceFolder = 'C:\\workspace\\notes';
    assert.strictEqual(ed.workspaceParentPath(), 'C:\\workspace', 'Windows 路径应取上级目录');
    ed.workspaceFolder = 'C:\\workspace';
    assert.strictEqual(ed.workspaceParentPath(), 'C:\\', '盘符下一级应补回分隔符到 C:\\');
    ed.workspaceFolder = 'C:\\';
    assert.strictEqual(ed.workspaceParentPath(), '', '盘符根应无上级目录');
    ed.workspaceFolder = '/home/user/docs';
    assert.strictEqual(ed.workspaceParentPath(), '/home/user', 'POSIX 路径应取上级目录');
    ed.workspaceFolder = '/home';
    assert.strictEqual(ed.workspaceParentPath(), '/', 'POSIX 一级目录的上级应为根 /');
    ed.workspaceFolder = '/';
    assert.strictEqual(ed.workspaceParentPath(), '', 'POSIX 根应无上级目录');

    // 点击：只刷新文件工作区（不得弹全屏 loading 遮罩 / 不得重建大纲侧边栏）
    const origShowLoading = ed.showLoading;
    const origShowSidebar = ed.showSidebar;
    const origRender = ed.renderFolderTree;
    const origWatch = ed.startFolderWatch;
    const origSave = ed.saveSession;
    const origRecent = ed.addRecentWorkspace;
    let loadingCount = 0;
    let sidebarCount = 0;
    let renderCount = 0;
    ed.showLoading = () => { loadingCount++; };
    ed.showSidebar = () => { sidebarCount++; };
    ed.renderFolderTree = async () => { renderCount++; };
    ed.startFolderWatch = () => {};
    ed.saveSession = () => {};
    ed.addRecentWorkspace = () => {};
    ed.expandedFolders = new Set(['keep']);
    ed.workspaceFolder = 'C:\\workspace\\notes';
    upBtn.click();
    await new Promise(r => setTimeout(r, 20));
    assert.strictEqual(ed.workspaceFolder, 'C:\\workspace', '点击后工作区应切到上级目录');
    assert.strictEqual(renderCount, 1, '只应刷新一次文件树');
    assert.strictEqual(loadingCount, 0, '不应弹出全屏 loading 遮罩（只刷新文件工作区）');
    assert.strictEqual(sidebarCount, 0, '不应重建侧边栏/大纲');
    assert.strictEqual(ed.expandedFolders.size, 0, '应重置展开状态');

    // 已到最上级：不切换，仅提示状态
    let status = null;
    const origStatus = ed.setStatus;
    ed.setStatus = (m) => { status = m; };
    renderCount = 0;
    ed.workspaceFolder = 'C:\\';
    upBtn.click();
    await new Promise(r => setTimeout(r, 20));
    assert.strictEqual(ed.workspaceFolder, 'C:\\', '已到最上级不应切换工作区');
    assert.strictEqual(renderCount, 0, '已到最上级不应刷新文件树');
    assert.strictEqual(status, ed.t('atRootFolder'), '应提示已到最上级');

    // 还原桩，供下方使用真实 renderFolderTree 校验禁用态
    ed.showLoading = origShowLoading;
    ed.showSidebar = origShowSidebar;
    ed.renderFolderTree = origRender;
    ed.startFolderWatch = origWatch;
    ed.saveSession = origSave;
    ed.addRecentWorkspace = origRecent;
    ed.setStatus = origStatus;

    // renderFolderTree 同步禁用态：有上级→可用；到根→禁用
    const origListDir = w.TauriApi.listDir;
    w.TauriApi.listDir = async () => [];
    ed.workspaceFolder = 'C:\\workspace\\notes';
    await ed.renderFolderTree();
    assert.strictEqual(upBtn.disabled, false, '有上级目录时按钮应可用');
    ed.workspaceFolder = 'C:\\';
    await ed.renderFolderTree();
    assert.strictEqual(upBtn.disabled, true, '已到最上级时按钮应禁用');
    w.TauriApi.listDir = origListDir;
    ed.workspaceFolder = null;
  } finally { cleanup(w); }
});

test('sidebar-tabs: 按钮字形族区分 + 无边框 + aria 状态', async () => {
  const { w, ed, getInitErr } = await makeEditor();
  try {
    assert.strictEqual(getInitErr(), null, '初始化不应报错');
    const btnAllFolders = w.document.getElementById('btn-all-folders');
    const sortOrder = w.document.getElementById('folder-sort-order');

    // 全部按钮=fold/unfold-vertical（多 path 折线收纳图标），排序=arrow-up/down-narrow-wide（多 path）
    assert.ok(btnAllFolders.querySelector('svg path'), '全部按钮应为 path 型 Lucide 图标（fold/unfold-vertical）');
    assert.strictEqual(btnAllFolders.querySelectorAll('svg line').length, 0, '全部按钮不应再有旧的三条横线 line');
    assert.ok(sortOrder.querySelector('svg path'), '排序按钮应使用 path 型 Lucide 箭头图标');
    assert.notStrictEqual(btnAllFolders.innerHTML, sortOrder.innerHTML, '全部按钮与排序按钮字形应不同');

    // 全部按钮：双态双箭头 + aria-pressed 随展开态变化（建浅树避免递归卡慢）
    w.TauriApi.listDir = async (args) => {
      if (args.path === '/root') return [{ name: 'proj', path: '/root/proj', is_dir: true, mtime: 1, size: 0 }];
      return [];
    };
    ed.workspaceFolder = '/root';
    await ed.renderFolderTree();
    await ed.toggleAllFolders(true);
    assert.strictEqual(btnAllFolders.getAttribute('aria-pressed'), 'true', '全部展开后 aria-pressed=true');
    assert.ok(btnAllFolders.innerHTML.includes('m15 19-3-3-3 3'), '展开态图标应为 fold-vertical（点击折叠全部）');
    await ed.toggleAllFolders(false);
    assert.strictEqual(btnAllFolders.getAttribute('aria-pressed'), 'false', '全部折叠后 aria-pressed=false');
    assert.ok(btnAllFolders.innerHTML.includes('m15 19-3 3-3-3'), '折叠态图标应为 unfold-vertical（点击展开全部）');

    // 排序按钮点击切换方向与 aria-pressed
    const beforePressed = sortOrder.getAttribute('aria-pressed');
    sortOrder.click();
    // 点击触发 handler 内非 await 的 renderFolderTree()，其 async 链会在测试返回后才落地
    // createElement，被 node:test 判为「测试结束后仍有异步活动」。这里显式排空。
    await delay(60);
    assert.notStrictEqual(sortOrder.getAttribute('aria-pressed'), beforePressed, '点击排序按钮应切换 aria-pressed');

    // 排序按钮无边框（CSS 由 .folder-sort-order 保证）
    assert.ok(/\.folder-sort-order\s*\{[^}]*border:\s*none/.test(STYLES), '排序按钮应为无边框');
  } finally { cleanup(w); }
});

test('sidebar-tabs: 标签栏样式护栏（左右排列 + active 高亮 + 面板互斥）', async () => {
  // jsdom 无布局，这里以源码规则作为回归护栏
  assert.ok(
    /\.sidebar-tabs\s*\{[^}]*display:\s*flex/.test(STYLES),
    '标签栏应为 flex 容器（左右排列）',
  );
  assert.ok(
    /\.sidebar-tab\s*\{[^}]*flex:\s*1 1 0/.test(STYLES),
    '标签按钮应等分宽度（左右并排）',
  );
  assert.ok(
    /\.sidebar-tab\.active\s*\{[^}]*border-bottom-color:\s*var\(--accent-color/.test(STYLES),
    '选中标签应有 accent 底部高亮',
  );
  assert.ok(
    /\.sidebar-tab-panel\s*\{[^}]*flex:\s*1 1 auto/.test(STYLES),
    '面板容器应占满标签栏下方剩余高度',
  );
  assert.ok(
    /\.sidebar-tab-panel\.hidden\s*\{[^}]*display:\s*none/.test(STYLES),
    '非选中面板应 display:none（互斥）',
  );
  // 分屏时代的样式应已清理
  assert.ok(!/\.sidebar-h-resizer/.test(STYLES), '.sidebar-h-resizer 样式应已移除');
  assert.ok(!/\.panel-chevron/.test(STYLES), '.panel-chevron 样式应已移除');
  assert.ok(!/files-collapsed/.test(STYLES), 'files-collapsed 样式应已移除');
  assert.ok(!/outline-collapsed/.test(STYLES), 'outline-collapsed 样式应已移除');
});

test('sidebar-tabs: 折叠全部目录在部分子目录读取失败时仍可用', async () => {
  const { w, ed, getInitErr } = await makeEditor();
  try {
    assert.strictEqual(getInitErr(), null, '初始化不应报错');
    const btn = w.document.getElementById('btn-all-folders');
    const tree = w.document.getElementById('folder-tree');

    // 深树：/root 含子目录 a；a 的子目录读取抛错（无权限），不应中断整体展开
    w.TauriApi.listDir = async (args) => {
      if (args.path === '/root') return [
        { name: 'a', path: '/root/a', is_dir: true, mtime: 1, size: 0 },
        { name: 'f.txt', path: '/root/f.txt', is_dir: false, mtime: 1, size: 0 },
      ];
      if (args.path === '/root/a') throw new Error('EACCES'); // 模拟无权限子目录
      return [];
    };
    ed.workspaceFolder = '/root';
    await ed.renderFolderTree();

    // 一键全部展开：即便子目录抛错也应成功完成，状态/按钮正确翻转（修复「折叠全部不管用」）
    await ed.toggleAllFolders(true);
    assert.strictEqual(ed._allFoldersExpanded, true, '展开后内部状态应为 true');
    assert.strictEqual(btn.getAttribute('aria-pressed'), 'true', '展开后按钮 aria-pressed=true');
    assert.ok(ed.expandedFolders.has('/root/a'), 'a 目录应被标记为展开（即便其下读取失败）');

    // 再次点击执行折叠：验证「折叠全部」按钮可用，不再卡在展开态
    await ed.toggleAllFolders(false);
    assert.strictEqual(ed._allFoldersExpanded, false, '折叠后内部状态应为 false');
    assert.strictEqual(btn.getAttribute('aria-pressed'), 'false', '折叠后按钮 aria-pressed=false');
    assert.strictEqual(ed.expandedFolders.size, 0, '折叠后展开集合应清空');
    assert.strictEqual(
      tree.querySelectorAll('.tree-children:not(.hidden)').length, 0,
      '折叠后所有目录子容器应隐藏',
    );
  } finally { cleanup(w); }
});

test('sidebar-tabs: 全部目录按钮基于 DOM 状态交替（再点击必折叠）', async () => {
  const { w, ed, getInitErr } = await makeEditor();
  try {
    assert.strictEqual(getInitErr(), null, '初始化不应报错');
    const btn = w.document.getElementById('btn-all-folders');
    const tree = {
      '/root': [
        { name: 'a', path: '/root/a', is_dir: true, mtime: 1, size: 0 },
        { name: 'f.md', path: '/root/f.md', is_dir: false, mtime: 1, size: 1 },
      ],
      '/root/a': [{ name: 'b.md', path: '/root/a/b.md', is_dir: false, mtime: 1, size: 1 }],
    };
    w.TauriApi.listDir = async (args) => tree[args.path] || [];
    ed.workspaceFolder = '/root';
    await ed.renderFolderTree();
    await delay(50);

    // 第一次点击：当前无展开目录 → 展开全部
    btn.click();
    await delay(80);
    assert.strictEqual(ed._allFoldersExpanded, true, '第1次点击后应标记为已全展开');
    assert.ok(
      /m15 19-3-3-3 3/.test(btn.innerHTML),
      '第1次点击后图标应为 fold-vertical（折叠全部）',
    );
    assert.ok(w.document.querySelector('.tree-node.tree-folder.expanded'), '目录应已展开');

    // 第二次点击：当前有展开目录 → 应折叠全部（不再卡在展开态）
    btn.click();
    await delay(80);
    assert.strictEqual(ed._allFoldersExpanded, false, '第2次点击后应标记为已折叠');
    assert.ok(
      /m15 19-3 3-3-3/.test(btn.innerHTML),
      '第2次点击后图标应为 unfold-vertical（展开全部）',
    );
    assert.strictEqual(ed.expandedFolders.size, 0, '第2次点击后展开集合应清空');
  } finally { cleanup(w); }
});

test('sidebar-tabs: 大纲默认全展开时按钮图标应为「折叠全部」（与状态一致）', async () => {
  const { w, ed, getInitErr } = await makeEditor();
  try {
    assert.strictEqual(getInitErr(), null, '初始化不应报错');
    const btn = w.document.getElementById('btn-all-outline');
    const content = w.document.getElementById('outline-content');
    // 大纲默认全展开：init 时不应有任何 .outline-children.collapsed
    assert.strictEqual(content.querySelector('.outline-children.collapsed'), null, '默认不应有折叠的大纲子块');
    // 按钮应显示为「折叠全部」fold-vertical（m15 19-3-3-3 3），而非「展开全部」unfold-vertical
    assert.ok(/m15 19-3-3-3 3/.test(btn.innerHTML), '默认全展开时图标应为折叠全部（fold-vertical）');
    assert.strictEqual(ed._allOutlineExpanded, true, '_allOutlineExpanded 应初始化为 true');
  } finally { cleanup(w); }
});

test('sidebar-tabs: 点击「折叠全部大纲」按钮应真正折叠（不再无效）', async () => {
  const { w, ed, getInitErr } = await makeEditor();
  try {
    assert.strictEqual(getInitErr(), null, '初始化不应报错');
    const btn = w.document.getElementById('btn-all-outline');
    const content = w.document.getElementById('outline-content');
    // 构造一个带子块的大纲
    content.innerHTML = '<div class="outline-item-wrapper"><div class="outline-children"><div class="outline-item">A</div></div></div>';
    // 重新同步按钮状态（模拟真实渲染后）
    ed._allOutlineExpanded = true;
    ed._updateAllOutlineBtn();
    // 点击：默认全展开 → anyExpanded=true → toggleAllOutline(false) → 折叠
    btn.click();
    assert.ok(content.querySelector('.outline-children.collapsed'), '点击后大纲子块应被折叠');
    assert.strictEqual(ed._allOutlineExpanded, false, '折叠后标志应翻转为 false');
    assert.ok(/m15 19-3 3-3-3/.test(btn.innerHTML), '折叠后图标应变为展开全部（unfold-vertical）');
  } finally { cleanup(w); }
});

test('sidebar-tabs: 展开/折叠全部目录显示 loading 并在完成后移除（超时兜底）', async () => {
  const { w, ed, getInitErr } = await makeEditor();
  try {
    assert.strictEqual(getInitErr(), null, '初始化不应报错');
    const tree = {
      '/root': [
        { name: 'a', path: '/root/a', is_dir: true, mtime: 1, size: 0 },
        { name: 'f.md', path: '/root/f.md', is_dir: false, mtime: 1, size: 1 },
      ],
      '/root/a': [{ name: 'b.md', path: '/root/a/b.md', is_dir: false, mtime: 1, size: 1 }],
    };
    w.TauriApi.listDir = async (args) => tree[args.path] || [];
    ed.workspaceFolder = '/root';
    await ed.renderFolderTree();
    const btn = w.document.getElementById('btn-all-folders');
    // 点击展开全部：应显示 loading overlay 且按钮 disabled
    btn.click();
    const overlay = w.document.querySelector('.folder-loading-overlay');
    assert.ok(overlay, '点击后应出现 loading 覆盖层');
    assert.ok(!overlay.classList.contains('hidden'), 'loading 覆盖层应可见');
    assert.strictEqual(btn.disabled, true, '操作中按钮应被禁用');
    // 等待异步展开完成
    await delay(120);
    assert.ok(overlay.classList.contains('hidden'), '完成后 loading 应被隐藏');
    assert.strictEqual(btn.disabled, false, '完成后按钮应恢复可用');
    assert.strictEqual(ed._allFoldersExpanded, true, '展开后状态应为 true');
  } finally { cleanup(w); }
});

test('sidebar-tabs: 展开进行中点折叠应取消旧任务，不会继续展开', async () => {
  const { w, ed, getInitErr } = await makeEditor();
  try {
    assert.strictEqual(getInitErr(), null, '初始化不应报错');
    const tree = {
      '/root': [
        { name: 'a', path: '/root/a', is_dir: true, mtime: 1, size: 0 },
        { name: 'f.md', path: '/root/f.md', is_dir: false, mtime: 1, size: 1 },
      ],
      '/root/a': [{ name: 'b.md', path: '/root/a/b.md', is_dir: false, mtime: 1, size: 1 }],
    };
    // 让 renderFolderLevel 慢下来，使展开任务在异步中途可被折叠打断
    const origRenderFolderLevel = ed.renderFolderLevel.bind(ed);
    ed.renderFolderLevel = async (p, container, depth) => {
      await new Promise((res) => setTimeout(res, 30));
      return origRenderFolderLevel(p, container, depth);
    };
    w.TauriApi.listDir = async (args) => tree[args.path] || [];
    ed.workspaceFolder = '/root';
    await ed.renderFolderTree();

    // 触发展开全部（异步）
    const expandPromise = ed.toggleAllFolders(true);
    // 立即在下一个 tick 触发折叠，打断尚未完成的展开
    await new Promise((res) => setTimeout(res, 10));
    const collapsePromise = ed.toggleAllFolders(false);
    await Promise.all([expandPromise, collapsePromise]);

    // 最终状态必须是折叠：无 expanded 目录、无可见 tree-children
    const treeEl = w.document.getElementById('folder-tree');
    assert.strictEqual(treeEl.querySelectorAll('.tree-node.tree-folder.expanded').length, 0, '折叠后不应有 expanded 目录');
    assert.strictEqual(treeEl.querySelectorAll('.tree-children:not(.hidden)').length, 0, '折叠后所有子容器应 hidden');
    assert.strictEqual(ed._allFoldersExpanded, false, '折叠后状态标志应为 false');
    assert.strictEqual(ed.expandedFolders.size, 0, '折叠后 expandedFolders 应被清空');
  } finally { cleanup(w); }
});

// 回归：侧边栏吸附把手（用户反馈：标题栏位置不合适，改贴分隔线/左缘悬浮，一键开关免两步菜单）。
test('sidebar: 吸附把手一键开关侧边栏并同步骑缝/左缘两态', async () => {
  const { w, ed } = await makeEditor();
  try {
    const btn = w.document.getElementById('sidebar-float-btn');
    const sidebar = w.document.getElementById('outline-sidebar');
    assert.ok(btn, 'main 内应存在 #sidebar-float-btn 吸附把手');
    // 初始：侧边栏可见 → 骑缝态（sidebar-open）
    assert.strictEqual(sidebar.classList.contains('hidden'), false, '初始侧边栏应可见');
    assert.strictEqual(btn.classList.contains('sidebar-open'), true, '可见时把手应为骑缝态');
    assert.strictEqual(btn.getAttribute('aria-pressed'), 'true', 'aria-pressed 应为 true');
    // 点击一次 → 关闭：把手脱离骑缝态（CSS 吸附左缘常亮）
    btn.dispatchEvent(new w.Event('click', { bubbles: true }));
    await delay(30);
    assert.strictEqual(sidebar.classList.contains('hidden'), true, '一次点击应关闭侧边栏');
    assert.strictEqual(btn.classList.contains('sidebar-open'), false, '关闭后应脱离骑缝态（吸附左缘）');
    assert.strictEqual(btn.getAttribute('aria-pressed'), 'false', 'aria-pressed 应为 false');
    assert.strictEqual(ed.settings.sidebarHidden, true, 'settings.sidebarHidden 应同步为 true');
    // 再点一次 → 打开（此前痛点：菜单要两步）
    btn.dispatchEvent(new w.Event('click', { bubbles: true }));
    await delay(30);
    assert.strictEqual(sidebar.classList.contains('hidden'), false, '再次单击应直接重开侧边栏');
    assert.strictEqual(btn.classList.contains('sidebar-open'), true, '骑缝态应恢复');
    assert.strictEqual(btn.style.left, '0px', 'jsdom offsetWidth=0 → left 钳制为 0px（真实环境为 width-10 骑缝）');
  } finally { cleanup(w); }
});