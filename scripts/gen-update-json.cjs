// 生成 update-windows-x86_64.json（Tauri Updater 用）。
// 读取已签名的 NSIS .sig，复用 scripts/release-notes.js 的 notes，
// 写出到仓库根目录（Gitee raw/master 端点）与 release/（GitHub latest/download 端点）。
const fs = require('fs');
const path = require('path');
const { VERSION, notesLines } = require('./release-notes');

const ROOT = path.resolve(__dirname, '..');
const NSIS_SIG = path.join(ROOT, 'release', `TuziMark_${VERSION}_x64-setup.exe.sig`);
const URL = `https://gitee.com/tizu/TizuMark-Markdown-Editor/releases/download/v${VERSION}/TuziMark_${VERSION}_x64-setup.exe`;

if (!fs.existsSync(NSIS_SIG)) {
  console.error('MISSING NSIS .sig: ' + NSIS_SIG);
  process.exit(1);
}
const signature = fs.readFileSync(NSIS_SIG, 'utf-8').trim();

const pubDate = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

const update = {
  version: VERSION,
  notes: notesLines.join('\n'),
  pub_date: pubDate,
  platforms: {
    'windows-x86_64': {
      signature,
      url: URL,
    },
  },
};

const json = JSON.stringify(update, null, 2) + '\n';
const targets = [
  path.join(ROOT, 'update-windows-x86_64.json'),
  path.join(ROOT, 'release', 'update-windows-x86_64.json'),
];
for (const t of targets) {
  fs.writeFileSync(t, json, 'utf-8');
  console.log('Wrote: ' + t);
}
console.log('pub_date:', pubDate);
