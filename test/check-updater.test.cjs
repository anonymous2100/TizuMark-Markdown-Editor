'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { run, parseMinisignPub, parseMinisignSig } = require('../scripts/check-updater.cjs');

const ROOT = path.resolve(__dirname, '..');
const pkgPath = path.join(ROOT, 'package.json');
const tauriConf = JSON.parse(fs.readFileSync(path.join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'));

test('parseMinisignPub 解析 Tauri 42 字节公钥', () => {
  const pub = parseMinisignPub(tauriConf.plugins.updater.pubkey);
  assert.strictEqual(pub.keyId.length, 8);
  assert.strictEqual(pub.ed25519.length, 32);
  assert.strictEqual(pub.raw.length, 42);
});

test('parseMinisignPub 兼容「原始公钥 base64」（健壮，不误报）', () => {
  const armored = Buffer.from(tauriConf.plugins.updater.pubkey, 'base64').toString('utf8');
  const lastLine = armored.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).pop();
  const pub = parseMinisignPub(lastLine); // 直接喂原始 base64，而非 base64(armored)
  assert.strictEqual(pub.raw.length, 42);
});

test('parseMinisignSig 解析 .sig 结构正确且 keyId 与配置公钥一致', () => {
  const sigPath = path.join(ROOT, 'release', 'TuziMark_1.2.0_x64-setup.exe.sig');
  if (!fs.existsSync(sigPath)) return; // 无 release 产物时跳过（CI 等）
  const pub = parseMinisignPub(tauriConf.plugins.updater.pubkey);
  const sig = parseMinisignSig(sigPath);
  assert.strictEqual(sig.keyId.length, 8);
  assert.strictEqual(sig.S1.length, 64);
  assert.strictEqual(sig.S2.length, 64);
  assert.ok(sig.keyId.equals(pub.keyId), 'sig keyId 应与配置公钥一致（防用错密钥）');
});

test('打包模式：当前干净状态返回 true', () => {
  assert.strictEqual(run([]), true);
});

test('发布模式：存在致命问题（版本不一致）时返回 false（致命门禁生效）', () => {
  const had = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
  delete process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
  const orig = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const origVer = orig.version;
  try {
    // 发布模式为致命门禁：版本不一致即阻断（与打包模式仅警告不同）。
    // 注意：开发机上存在私钥密码文件，仅靠「缺 env」不足以触发致命门禁，
    // 故此处显式制造版本不一致来稳定触发 release 致命门禁。
    orig.version = '9.9.9';
    fs.writeFileSync(pkgPath, JSON.stringify(orig, null, 2));
    assert.strictEqual(run(['--release']), false);
  } finally {
    orig.version = origVer;
    fs.writeFileSync(pkgPath, JSON.stringify(orig, null, 2));
    assert.strictEqual(JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version, origVer);
    if (had) process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = had;
  }
});

test('打包模式：update json 版本与 package.json 不一致时仅警告、不阻断（修复误阻断）', () => {
  const had = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
  delete process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
  const orig = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const origVer = orig.version;
  try {
    // 模拟「先 bump 版本号再构建」：update json 仍是旧版本，此时必须只警告、可继续构建
    orig.version = '9.9.9';
    fs.writeFileSync(pkgPath, JSON.stringify(orig, null, 2));
    assert.strictEqual(run([]), true);
  } finally {
    orig.version = origVer;
    fs.writeFileSync(pkgPath, JSON.stringify(orig, null, 2));
    assert.strictEqual(JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version, origVer);
    if (had) process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = had;
  }
});
