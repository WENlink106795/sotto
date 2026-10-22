# 代码签名

## 先说结论

- **自签名证书**只能用于本地测试与流程验证。它会让文件带上 Authenticode 签名，但其他人的 Windows 不信任你的自签名根证书，SmartScreen 仍可能提示“未知发布者”。
- 要真正减少 SmartScreen/杀毒误报，需要购买 **CA 签发的代码签名证书**（OV 或 EV），并在发布时用该证书签名。EV 证书对 SmartScreen 信誉建立更快，但仍不能保证所有杀毒软件不误报。
- 本项目已生成并安装一个 **当前用户范围** 的自签名证书，签名后的便携版在本机显示“签名已通过验证”。私钥与密码只在本机 `build/signing/`，不会提交到 git。

## 本机现状

- 证书主题：`CN=Sotto Research (Self-Signed)`
- 指纹：`D6FBB18F4EC2D6BA30C13D3626618E8B05B106BC`
- 有效期：2026-10-22 → 2029-10-22
- 文件：
  - `build/signing/sotto-selfsigned.pfx`（私钥，**不要外传**）
  - `build/signing/sotto-selfsigned.cer`（公钥，可给测试机安装）
  - `build/signing/password.txt`（本地密码，已忽略）
- 公钥已导入：
  - `Cert:\CurrentUser\TrustedPublisher`
  - `Cert:\CurrentUser\Root`
- 已签名的产物：`release/Sotto-0.1.0-*.exe` 与 `release-test/Sotto-0.1.1-x64*.exe`，本机 `Get-AuthenticodeSignature` 为 `Valid`。
- 重新打包时 electron-builder 会读取 `CSC_LINK` / `CSC_KEY_PASSWORD`，签名内层 `Sotto.exe`、ffmpeg、安装包/便携版外壳。
- 当前四个发行包（x64/ia32 的 setup 与 portable）签名状态均为 **Valid**；Windows Defender（`MpCmdRun -Scan -ScanType 3`）扫描四个文件均为 **found no threats**。这不代表所有杀毒软件、所有机器都不会误报。

## 重新签名现有产物

```powershell
$env:CSC_LINK = "F:\[DSH]\Sotto\build\signing\sotto-selfsigned.pfx"
$env:CSC_KEY_PASSWORD = Get-Content "F:\[DSH]\Sotto\build\signing\password.txt" -Raw
npm run sign
```

脚本会签名 `release/*.exe`，使用 DigiCert RFC3161 时间戳，并验证签名。

## 重新打包并签名

```powershell
$env:CSC_LINK = "F:\[DSH]\Sotto\build\signing\sotto-selfsigned.pfx"
$env:CSC_KEY_PASSWORD = Get-Content "F:\[DSH]\Sotto\build\signing\password.txt" -Raw
npm run pack:win
```

electron-builder 会在打包过程中签名内层可执行文件与安装包/便携版。

## 给其他测试机安装自签名证书

把 `sotto-selfsigned.cer` 发给对方，在**当前用户**范围导入：

```powershell
Import-Certificate -FilePath .\sotto-selfsigned.cer -CertStoreLocation Cert:\CurrentUser\TrustedPublisher
Import-Certificate -FilePath .\sotto-selfsigned.cer -CertStoreLocation Cert:\CurrentUser\Root
```

> 导入 Root 需要交互确认；非交互环境可用 .NET `X509Store` 添加。
> 只应在你信任这台机器与私钥的前提下这样做。

## 正式发布建议

1. 购买 OV/EV 代码签名证书（如 DigiCert、Sectigo、SSL.com）。
2. 把证书导出为 PFX，设置到 `CSC_LINK` / `CSC_KEY_PASSWORD`（本地或 GitHub Actions Secrets）。
3. 用 CA 证书重新构建并签名。
4. 在 GitHub Release 附 `SHA256SUMS.txt` 与 `THIRD_PARTY_NOTICES.md`。
5. 可选：向 Microsoft 提交误报样本（https://www.microsoft.com/en-us/wdsi/filesubmission），减少 Defender 误报。

## 杀毒误报的处理

- **签名**：降低“未知发布者”与启发式误报的概率，但不能保证。
- **不要 UPX 压缩**：会显著提高误报率，本项目也没有使用。
- **用正式安装包**：NSIS 安装包通常比自解压 portable 更少被误报；portable 外壳（NSIS SFX）是常见误报对象。
- **提交白名单**：Microsoft Defender、火绒、360 等都有样本提交/误报申诉入口。
- **提供校验值**：让用户能从官方 Release 校验文件未被篡改。
- **从源码构建**：技术用户可自行 `npm ci && npm run pack:win`。