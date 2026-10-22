// 统一版本号一把改：把所有发布相关位置的版本号同步到新版本。
//
// 用法：
//   node scripts/bump-version.mjs 1.2.6            # 改版本号
//   node scripts/bump-version.mjs 1.2.6 --dry-run  # 只看会改哪些地方
//
// 为什么要有这个脚本：版本号散落在 9+ 处（package.json / tauri.conf.json /
// Cargo.toml / 三份 README 徽章 / i18n 三语文案 / index.html 关于框 / update JSON），
// 手工改极易漏；而漏改会让 scripts/check-version.mjs 直接失败，或导致构建报错。
// 注意：本脚本用 Node 写文件（UTF-8 无 BOM）。不要用 PowerShell 的 Set-Content
// 改这些文件——它会给文件加 BOM，导致 package.json / tauri.conf.json 直接解析失败。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const next = args.find((a) => !a.startsWith('-'));

if (!next || !/^\d+\.\d+\.\d+$/.test(next)) {
  console.error('用法: node scripts/bump-version.mjs <新版本号，如 1.2.6> [--dry-run]');
  process.exit(1);
}

const pkgPath = path.join(ROOT, 'package.json');
const prev = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
if (prev === next) {
  console.log(`✓ 版本已是 v${next}，无需改动`);
  process.exit(0);
}

// 每项：文件 → 一组 [正则, 替换]。正则必须带 g 以便全量替换。
const edits = [
  ['package.json', [
    [/"version"\s*:\s*"[^"]+"/, `"version": "${next}"`],
  ]],
  ['src-tauri/tauri.conf.json', [
    [/"version"\s*:\s*"[^"]+"/, `"version": "${next}"`],
  ]],
  ['src-tauri/Cargo.toml', [
    [/^version\s*=\s*"[^"]+"/m, `version = "${next}"`],
  ]],
  ['README.md', [
    [/Version-[0-9.]+-blue/g, `Version-${next}-blue`],
  ]],
  ['README.en.md', [
    [/Version-[0-9.]+-blue/g, `Version-${next}-blue`],
  ]],
  ['README.es.md', [
    [/Version-[0-9.]+-blue/g, `Version-${next}-blue`],
  ]],
  // i18n 三语：关于框版本文案 + 应用版本号（appVersion 也一并同步，避免关于框显示旧版本）
  ['src/modules/i18n-data.js', [
    [/versionInfo:\s*'TizuMark v[0-9.]+'/g, `versionInfo: 'TizuMark v${next}'`],
    [/appVersion:\s*'[0-9.]+'/g, `appVersion: '${next}'`],
  ]],
  ['src/index.html', [
    [/(id="about-version"[^>]*>TizuMark v)[0-9.]+/, `$1${next}`],
  ]],
  // 更新清单：版本、下载 URL、文件名里的版本。签名值必须重新签一次才会有效，
  // 这里不动 signature —— 脚本会提示。
  ['update-windows-x86_64.json', [
    [/"version"\s*:\s*"[^"]+"/, `"version": "${next}"`],
    [/v[0-9]+\.[0-9]+\.[0-9]+\//g, `v${next}/`],
    [/TizuMark_[0-9]+\.[0-9]+\.[0-9]+_/g, `TizuMark_${next}_`],
  ]],
];

let changed = 0;
const skipped = [];

for (const [rel, rules] of edits) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) {
    skipped.push(`${rel}（文件不存在）`);
    continue;
  }
  const before = fs.readFileSync(full, 'utf8');
  let after = before;
  for (const [re, to] of rules) after = after.replace(re, to);
  if (after === before) {
    skipped.push(`${rel}（无匹配）`);
    continue;
  }
  if (!dryRun) {
    fs.writeFileSync(full, after, 'utf8');
  }
  changed++;
  console.log(`  ${dryRun ? '[预览]' : '✓'} ${rel}`);
}

console.log('');
console.log(`${dryRun ? '将修改' : '已修改'} ${changed} 个文件：v${prev} → v${next}`);
if (skipped.length) {
  console.log('未改动：');
  for (const s of skipped) console.log('  - ' + s);
}
if (!dryRun) {
  console.log('');
  console.log('⚠️  update-windows-x86_64.json 里的 signature 仍是旧版本的签名，');
  console.log('    必须在构建并签名新安装包后重新写入，否则自动更新会校验失败。');
}
