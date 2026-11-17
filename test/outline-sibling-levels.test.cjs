// 大纲同级标题回归测试：锁定 buildOutlineTree 对同级标题不嵌套。
// 用户报告的问题（同为 H2 的标题被缩进为父子）对应旧代码把 >= 错写成 > 的场景。
const test = require('node:test');
const assert = require('node:assert');
const { extractHeadings, buildOutlineTree } = require('../src/modules/outline.js');

function headingToId(text) {
  let id = '';
  for (const ch of text) {
    if (/[\p{L}\p{N}]/u.test(ch)) id += ch.toLowerCase();
    else if (ch === ' ' || ch === '-' || ch === '_') id += '-';
  }
  return id.replace(/-+/g, '-').replace(/^-|-$/g, '');
}
const opts = { headingToId };

// 辅助：断言节点的层级与文本，避免 Pos 等无关字段干扰
function assertNode(node, level, text) {
  assert.strictEqual(node.level, level, `节点文本应为 "${text}" 的层级`);
  assert.strictEqual(node.text, text, `节点文本应为 "${text}"`);
}

// 复现用户截图中的标题序列
function reproMd() {
  return [
    '## 基础文本格式',
    '正文',
    '## 标题层级',
    'TuziMark 的大纲面板会自动解析标题。',
    '### 三级标题：常用的章节分隔',
    '#### 四级标题：段落内的小节',
    '##### 五级标题：更细粒度的分组',
    '###### 六级标题：最细粒度的标注',
    '## 超链接与图片',
    '### 超链接',
  ].join('\n');
}

test('同级 H2 在树中为兄弟节点，不应互相嵌套', async () => {
  const hs = extractHeadings(reproMd(), opts);
  const tree = buildOutlineTree(hs);

  // 顶层应为 3 个 H2 兄弟
  assert.strictEqual(tree.length, 3, '顶层应有 3 个 H2');
  assertNode(tree[0], 2, '基础文本格式');
  assertNode(tree[1], 2, '标题层级');
  assertNode(tree[2], 2, '超链接与图片');

  // 第一个 H2 没有子节点
  assert.strictEqual(tree[0].children.length, 0, '基础文本格式下不应有子标题');

  // 第二个 H2 下有 H3-H6 链
  assert.strictEqual(tree[1].children.length, 1, '标题层级下应有 1 个 H3');
  assertNode(tree[1].children[0], 3, '三级标题：常用的章节分隔');
  assert.strictEqual(tree[1].children[0].children.length, 1, 'H3 下应有 H4');
  assert.strictEqual(tree[1].children[0].children[0].children.length, 1, 'H4 下应有 H5');
  assert.strictEqual(tree[1].children[0].children[0].children[0].children.length, 1, 'H5 下应有 H6');

  // 第三个 H2 下有 H3
  assert.strictEqual(tree[2].children.length, 1, '超链接与图片下应有 1 个 H3');
  assertNode(tree[2].children[0], 3, '超链接');
});

test('H1→H6 顺序嵌进：每级成为前一级的子节点', async () => {
  const md = ['# A', '## B', '### C', '#### D', '##### E', '###### F'].join('\n');
  const tree = buildOutlineTree(extractHeadings(md, opts));

  assert.strictEqual(tree.length, 1);
  assertNode(tree[0], 1, 'A');
  assert.strictEqual(tree[0].children.length, 1);
  assertNode(tree[0].children[0], 2, 'B');
  assert.strictEqual(tree[0].children[0].children.length, 1);
  assertNode(tree[0].children[0].children[0], 3, 'C');
  assert.strictEqual(tree[0].children[0].children[0].children.length, 1);
  assertNode(tree[0].children[0].children[0].children[0], 4, 'D');
  assert.strictEqual(tree[0].children[0].children[0].children[0].children.length, 1);
  assertNode(tree[0].children[0].children[0].children[0].children[0], 5, 'E');
  assert.strictEqual(tree[0].children[0].children[0].children[0].children[0].children.length, 1);
  assertNode(tree[0].children[0].children[0].children[0].children[0].children[0], 6, 'F');
});

test('跳级：H2 后直接跟 H4，H4 仍作为 H2 的子节点', async () => {
  const md = ['## A', '#### B', '## C'].join('\n');
  const tree = buildOutlineTree(extractHeadings(md, opts));

  assert.strictEqual(tree.length, 2, '顶层应有 2 个 H2');
  assertNode(tree[0], 2, 'A');
  assertNode(tree[1], 2, 'C');
  assert.strictEqual(tree[0].children.length, 1, 'H2 A 下应有 1 个 H4');
  assertNode(tree[0].children[0], 4, 'B');
  assert.strictEqual(tree[1].children.length, 0, 'H2 C 下无子节点');
});

test('回到更浅层级时，中间所有深级节点应被正确关闭', async () => {
  const md = ['## A', '### B', '#### C', '## D', '### E', '# F'].join('\n');
  const tree = buildOutlineTree(extractHeadings(md, opts));

  // 顺序：H2 A -> H2 D -> H1 F（F 比 A/D 更浅，把它们都弹出）
  assert.strictEqual(tree.length, 3, '顶层应有 A、D、F 三个节点');
  assertNode(tree[0], 2, 'A');
  assertNode(tree[1], 2, 'D');
  assertNode(tree[2], 1, 'F');

  // A 下只挂 B -> C
  assert.strictEqual(tree[0].children.length, 1, 'A 下有 B');
  assertNode(tree[0].children[0], 3, 'B');
  assert.strictEqual(tree[0].children[0].children.length, 1, 'B 下有 C');
  assertNode(tree[0].children[0].children[0], 4, 'C');

  // D 与 A 同级，应回到顶层；D 下挂 E
  assert.strictEqual(tree[1].children.length, 1, 'D 下有 E');
  assertNode(tree[1].children[0], 3, 'E');

  // F 没有子节点
  assert.strictEqual(tree[2].children.length, 0, 'F 下无子节点');
});

test('空文档与无标题文档返回空树', async () => {
  assert.deepStrictEqual(buildOutlineTree(extractHeadings('', opts)), []);
  assert.deepStrictEqual(buildOutlineTree(extractHeadings('正文\n没有标题', opts)), []);
});

test('单级标题全部同级：多个 H2 平铺', async () => {
  const md = ['## A', '## B', '## C', '## D'].join('\n');
  const tree = buildOutlineTree(extractHeadings(md, opts));

  assert.strictEqual(tree.length, 4);
  tree.forEach((node, i) => {
    assert.strictEqual(node.level, 2);
    assert.strictEqual(node.children.length, 0);
  });
  assert.deepStrictEqual(tree.map((n) => n.text), ['A', 'B', 'C', 'D']);
});
