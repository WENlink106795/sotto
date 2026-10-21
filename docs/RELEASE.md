# 发布清单

> 目标：把 Sotto 0.1.x 发布到 GitHub Releases，提供 x64 / ia32 便携版与安装包。

## 1. 版本与变更

1. 更新 `package.json` 的 `version`（例如 `0.1.0` → `0.1.1`）。
2. 在 `CHANGELOG.md` 增加对应条目。
3. 确认 README 的截图与功能描述没有过期。

## 2. 质量门禁

```powershell
npm ci
npm run typecheck
npm test
npm run build:web
npm run build
```

预期：86+ 项测试全部通过，主进程与渲染进程类型检查通过，Electron 构建成功。

可选：`npm run screenshots`，检查 1440×920 的三套主题截图；把需要的截图同步到 `docs/screenshots/`。

## 3. 准备 ffmpeg

```powershell
npm run fetch:ffmpeg -- --arch x64
npm run fetch:ffmpeg -- --arch ia32
```

- x64 使用 BtbN LGPL 静态构建（含 `ffmpeg.exe` + `ffprobe.exe`；打包只带 `ffmpeg.exe`）。
- ia32 使用 `@ffmpeg-installer/win32-ia32` 兼容构建。
- 两个目录都会带 `LICENSE.txt`；发行说明中附 `THIRD_PARTY_NOTICES.md` 链接。
- 若网络受限，可手动把对应 `ffmpeg.exe` 放到 `resources/ffmpeg/x64/` 或 `ia32/`。

## 4. 打包

```powershell
npm run pack:win
```

产物在 `release/`：

- `Sotto-Setup-<version>-x64.exe`
- `Sotto-Setup-<version>-ia32.exe`
- `Sotto-<version>-x64-portable.exe`
- `Sotto-<version>-ia32-portable.exe`

> 32 位构建依赖 Electron 34（最后仍提供 win32-ia32 的稳定线之一）。不要随意升级 Electron 主版本而不验证 ia32。

## 4.1 Windows 常见打包问题：winCodeSign 符号链接

在未开启 Developer Mode、且非管理员权限的 Windows 上，electron-builder 解压
`winCodeSign-2.6.0.7z` 时可能报：

```text
ERROR: Cannot create symbolic link : ... \darwin\10.12\lib\libcrypto.dylib
```

这是 macOS 签名工具里的符号链接，Windows 不需要。可任选一种解决：

1. 打开 Windows 设置 → 隐私和安全性 → 开发者选项 → 开发人员模式；或
2. 用管理员权限运行一次打包；或
3. 手动预置缓存（只解压 Windows 所需文件）：

```powershell
$cache = "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign"
$zip = "$env:TEMP\winCodeSign-2.6.0.7z"
Invoke-WebRequest "https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z" -OutFile $zip
& "node_modules\7zip-bin\win\x64\7za.exe" x $zip "-o$cache\winCodeSign-2.6.0" "-x!darwin" "-x!linux" -y
```

然后重新运行 `npm run pack:win`。

## 5. 校验与冒烟

1. 在干净目录启动 x64 与 ia32 portable，确认首屏可打开。
2. 用 `npm run demo` 生成演示曲库，选择它，确认：
   - 配对/警告/封面候选显示正常；
   - 执行后 LRC 与音频同名、源 VTT/SRT 在原目录同步改名；
   - 开启转码后生成 MP3/M4A，原文件与字幕命名一致；
   - 撤销能恢复文件名并移除新建的 LRC/MP3；
   - 右栏显示内置 ffmpeg 版本。
3. 生成 SHA-256：

```powershell
Get-ChildItem release\*.exe | Get-FileHash -Algorithm SHA256 | Format-Table Path,Hash
```

## 5.1 签名

本地已配置自签名证书，并用其签好了内层 `Sotto.exe`、ffmpeg、setup 与 portable。重新打包时设置：

```powershell
$env:CSC_LINK = "F:\[DSH]\Sotto\build\signing\sotto-selfsigned.pfx"
$env:CSC_KEY_PASSWORD = Get-Content "F:\[DSH]\Sotto\build\signing\password.txt" -Raw
npm run pack:win
```

自签名只适合本机/测试机；GitHub 发布请换成 CA 证书。签名后重新生成 `SHA256SUMS.txt`。

## 6. GitHub Release

- Tag：`v0.1.0`（与 package.json 一致）。
- 标题：`Sotto 0.1.0 · 耳畔`。
- 附件：x64 / ia32 的 setup 与 portable，以及 `SHA256SUMS.txt`。
- 说明中包含：核心功能、三套主题、已知限制（音频转码默认只处理配对音频；32 位使用兼容 ffmpeg）、许可证与第三方说明。
- 不要提交 `node_modules/`、`out/`、`release/`、`resources/ffmpeg/*.exe`、`demo-library/`。

## 7. 已知限制

- 无字幕音频默认不参与整理；需在「命名规则」打开“无字幕音频也纳入整理”。
- 有损转码不可逆；默认保留原文件。
- 系统回收站删除的操作只能部分撤销（文件名可恢复，回收站文件需手动还原）。
- 自签名 exe 仍可能在别人的机器上触发 SmartScreen；正式发布建议购买 CA 代码签名证书并配置 `CSC_LINK` / `CSC_KEY_PASSWORD`，详见 [SIGNING.md](SIGNING.md)。