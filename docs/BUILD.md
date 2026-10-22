# 打包构建说明

## 最快用法

双击仓库根目录的 **`build.cmd`**。

脚本会依次做：

1. 检查 Node / Rust / MSVC 工具链
2. 问你要不要升版本号（**直接回车 = 保持当前版本不变**）
3. 结束正在运行的 TizuMark（不关掉的话 exe 被占用会编译失败）
4. 编译三种安装包（Rust release 编译，一般 2~5 分钟）
5. 把产物复制到两个地方

产物位置：

| 目录 | 用途 |
|------|------|
| `release\` | 工程内归档（和以前一样） |
| `..\TizuMark-dist\`（即工程上一级） | **推荐从这里运行绿色版** |

三个文件：

- `TizuMark_<版本>_x64-setup.exe` — NSIS 安装包（推荐给普通用户）
- `TizuMark_<版本>_x64_en-US.msi` — MSI（企业批量部署）
- `TizuMark_<版本>_x64.exe` — 绿色版（免安装）

## ⚠️ 重要：不要从 `release\` 里双击绿色版

实测结论（2026-10-21）：**同一份 exe，放在项目工程目录内启动会卡住**——进程活着，但只有单实例插件的一个隐藏窗口，没有主窗口，也没有任何 WebView2 子进程；而复制到工程外（上一级目录、`%TEMP%`）就能正常打开。

更麻烦的是：那个卡住的进程会**占住单实例锁**，之后不管点开始菜单、桌面快捷方式还是安装目录里的 exe，都只是静默退出——表现就是「重新安装之后打不开应用」。

所以：

- 要装机器 → 用 `TizuMark_<版本>_x64-setup.exe`（安装到 `%LOCALAPPDATA%\TizuMark`，在工程外，正常）
- 要用绿色版 → 从 `..\TizuMark-dist\` 里运行，**不要**从 `release\` 直接双击

### 已经卡住了怎么办

任务管理器结束所有 `tizumark.exe` / `TizuMark_*.exe` 进程，然后从工程外重新启动。或者直接用命令行：

```powershell
Get-Process | Where-Object { $_.ProcessName -match '^(tizumark|TizuMark)' } | Stop-Process -Force
```

## 命令行参数

```powershell
.\scripts\build-release.ps1                 # 交互式（会问版本号）
.\scripts\build-release.ps1 -NoBump         # 不升版本，直接构建当前版本
.\scripts\build-release.ps1 -Version 1.2.6  # 指定新版本号
.\scripts\build-release.ps1 -Sign           # 构建后签名 NSIS 安装包
.\scripts\build-release.ps1 -NoPause        # 结束时不等待按键（适合脚本调用）
```

## 版本号会同步到哪些地方

`scripts/bump-version.mjs` 一把改 9 处，改完可以跑 `node scripts/check-version.mjs` 自检：

- `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`
- `README.md` / `README.en.md` / `README.es.md` 的版本徽章
- `src/modules/i18n-data.js` 的 `versionInfo`（中/英/西三语）+ `appVersion`
- `src/index.html` 关于对话框的兜底文本
- `update-windows-x86_64.json` 的版本号与下载 URL

> 用 Node 写文件、不用 PowerShell 的 `Set-Content`——后者会加 UTF-8 BOM，直接让 `package.json` / `tauri.conf.json` 解析失败（本次打包就踩过）。

## 签名与发布

脚本**不会**自动把签名写进 `update-windows-x86_64.json`，只提示。发布前还需要：

1. 有私钥：`%USERPROFILE%\.tauri\tizu-updater.key`
2. 用 `-Sign` 构建，或手动 `npx tauri signer sign -f <key> <安装包>`
3. 把 NSIS 安装包的签名值写回 `update-windows-x86_64.json` 的 `platforms.windows-x86_64.signature`，并更新 `version` / `url` / `pub_date` / `notes`

完整发布流程（创建 Gitee/GitHub Release、上传附件、验证中文 body）见 `CLAUDE.md` 的「Release 发布流程」一节。

**没有私钥时不要发布**——未签名的包会让自动更新校验失败。

## 故障排查

构建日志自动写到工程根目录的 `build-output.log`。

| 现象 | 原因 / 处理 |
|------|------------|
| `build failed` 且提示版本号不一致 | 三处 `version` 不同；跑 `node scripts/check-version.mjs` 看具体哪个文件 |
| 编译时提示文件被占用 | 还有 TizuMark 在运行；脚本第 3 步会杀，但托盘里的实例可能刚重启 |
| 找不到 `vcvars64.bat` | 缺 Visual Studio C++ 生成工具，见 `docs/DEV_SETUP.md` |
| 找不到 `playwright` | 只影响浏览器截图类校验脚本，不影响打包 |
