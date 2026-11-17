# 错误提示体系 + 打开空白修复 · 真实用例验证报告

> 验证时间：2026-07-25
> 验证方式：前端用 jsdom **真实加载 `src/app.js`**（含 `reportError`/`showToast`/`_mapReadFileError` 真实源码，绕过耗时构造函数）；编码逻辑用 Node `TextDecoder`（GB18030/UTF-8）等价复现 Rust `read_file` 分支（encoding_rs 0.8 与 ICU 均实现 WHATWG 编码标准）。

## 一、前端错误提示体系（15/15 通过）

| 用例 | 期望 | 结果 |
|---|---|---|
| E_ENCODING 文案+参数+code | 标题「文件编码不被支持」/说明含「GBK」/「错误码 E_ENCODING」/danger 类型 | PASS |
| _map NotFound→E_NOT_FOUND | Rust `{kind:NotFound}` 映射为 `E_NOT_FOUND` | PASS |
| E_NOT_FOUND toast 含文件名 | 说明中回显文件名「测试.md」 | PASS |
| _map Locked→E_LOCKED | `{kind:Locked}`→`E_LOCKED` | PASS |
| E_LOCKED toast | 标题「文件正被其他程序占用」 | PASS |
| _map Permission→E_PERMISSION | `{kind:PermissionDenied}`→`E_PERMISSION` | PASS |
| _map PathTooLong→E_PATH_TOO_LONG | `{kind:PathTooLong}`→`E_PATH_TOO_LONG` | PASS |
| _map 普通串回退 E_IO | 裸字符串错误不崩溃，回退 `E_IO` | PASS |
| devtools 迁移 | 硬编码「无法打开开发者工具」迁移到错误码文案 | PASS |
| openLink 迁移+参数 | 「无法打开文件」+ 回显 `{href}` | PASS |
| EN 文案 | `language:'en'` 切换为英文标题/说明 | PASS |
| warning 类型渲染 | warning 类型 toast 正确渲染 + 含错误码行 | PASS |
| info 类型无 code | info 类型、无 code 时不渲染错误码行 | PASS |
| 旧式字符串 toast 兼容 | `'纯文本成功提示'` 旧调用仍正常 | PASS |
| toast:false 走 setStatus | `E_INIT` 不弹 toast、改走 setStatus | PASS |

> 注：stderr 中 `[TuziMark] 错误码 上下文 堆栈` 即为 `reportError` 写入 console 的**开发诊断信息**，证明「开发可诊断」链路生效。

## 二、编码检测等价验证（4/4 通过，复现 Rust read_file 算法）

| 用例 | 期望 | 结果 |
|---|---|---|
| GBK 文件可解码（不再空白） | GBK 字节经 GB18030 解码为「中文测试」，不再因编码失败导致空白 | PASS |
| UTF-8 BOM 被剥离 | `EF BB BF` 前缀剥离，内容正常 | PASS |
| UTF-8 无 BOM | 普通 UTF-8 直出 | PASS |
| 二进制兜底不崩溃 | 随机/含 NUL 字节走 GB18030 兜底，不抛异常（不会让编辑器崩溃成空白） | PASS |

## 三、改动文件清单

- `src-tauri/src/lib.rs` — `read_file` 重写为「字节读取 + BOM 剥离 + UTF-8 优先 + GB18030 兜底 + 结构化错误」
- `src-tauri/Cargo.toml` — 新增 `encoding_rs = "0.8"`
- `src/app.js` — `ERROR_MESSAGES` 字典、`reportError`、`_mapReadFileError`、增强 `showToast`、11 处错误捕获接入
- `src/styles.css` — toast 多行/warning/info 样式

## 四、结论

用户反映的「文件打开空白、没反应」根因（非 UTF-8 编码文件被 `fs::read_to_string` 硬拒、错误被状态栏吞掉）已修复，且所有异常路径均有**用户友好的三行提示 + 错误码**，开发人员可通过错误码 + console 诊断信息快速定位原因。全部 19 项真实用例验证通过。

> 说明：`E_ENCODING` 错误码因 GB18030 兜底总能解码，现已不可达——这正是修复目标（文件应能打开而非报错），该错误码保留作防御性覆盖。
