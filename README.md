# Sotto · 耳畔

<p align="right"><strong>简体中文</strong> · <a href="README.en.md">English</a></p>

[![CI](https://github.com/WENlink106795/sotto/actions/workflows/ci.yml/badge.svg)](https://github.com/WENlink106795/sotto/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/WENlink106795/sotto)](https://github.com/WENlink106795/sotto/releases)
[![License](https://img.shields.io/github/license/WENlink106795/sotto)](LICENSE)


> 把 ASMR 作品整理成播放器喜欢的样子。

Sotto 是一款面向 ASMR / 音声作品收藏者的 **Windows 本地曲库整理器**。它把下载来的 VTT/SRT 字幕转换成硬件播放器能读的 LRC，统一音频与字幕的文件名，挑选并重命名封面图，还可以按需把 WAV / FLAC 等大体积音频转成 MP3 / M4A。

界面提供 **Fluent / Material You / Studio** 三套主题，并支持强调色、圆角、密度等自定义。所有处理都在本机完成，不上传任何文件。

<p align="center">
  <img src="docs/screenshots/workspace-fluent-dark.png" width="49%" alt="Fluent 主题工作台" />
  <img src="docs/screenshots/workspace-material-light.png" width="49%" alt="Material You 主题工作台" />
</p>
<p align="center">
  <img src="docs/screenshots/workspace-studio-dark.png" width="49%" alt="Studio 主题工作台" />
  <img src="docs/screenshots/settings-fluent-dark.png" width="49%" alt="外观设置" />
</p>

## 核心功能

- **VTT / SRT / TXT → LRC**：支持标签、HTML 实体、NOTE/STYLE 段、乱序/重叠时间轴；还能识别“扩展名是 .txt、内容其实是 WebVTT/SRT/LRC”的歌词文件。输出 UTF-8、UTF-8 BOM 或 GB18030，兼容挑剔的车机与播放器。普通剧本、readme 会被内容检测排除。
- **真实下载命名兼容**：支持 `track.mp3.vtt` 这种双扩展名字幕，按去掉媒体后缀后的名字精确配对，并把源字幕改名为 `track.vtt`。
- **文件名严格对齐**：音频、转换后的 LRC、以及保留下来的源 VTT/SRT 都保持完全相同的文件名主干；源字幕在原子目录内就地改名，不会把字幕文件夹搬空。自动移除表情、特殊符号、Windows 非法字符，并给出“删除了哪些字符”的预览。
- **智能配对**：同目录精确/归一化/模糊匹配，跨子目录（例如 `作品名/字幕/xxx.vtt`）匹配；低置信度会显式警告，未匹配项单独列出供核对。
- **封面选择**：扫描作品文件夹及子文件夹里的图片，选中后重命名为 `cover.jpg`（也可选 folder/front/album/封面），必要时用 ffmpeg 转成 JPEG。批量模式可开启“自动选择封面”，优先选择明确命名的图片，候选过多时不乱猜。
- **可选音频转码**：WAV / FLAC / APE / AIFF / ALAC / WMA → MP3（libmp3lame）或 M4A（AAC），保留元数据，可把原文件移入回收站。
- **安全整理**：先出完整方案再执行；两阶段重命名避免冲突；运行日志、历史记录与一键撤销；删除操作默认进回收站。
- **日志与诊断**：主进程/渲染层错误、未捕获异常、IPC 失败、扫描/方案/执行摘要写入本地滚动日志；「设置 › 工具」可一键导出包含环境信息与最近整理日志的 `.log` 诊断包，用户主目录会自动脱敏。
- **批量模式**：把整个 `[ASMR]` 根目录拖进来即可递归扫描；用设置作为预设，自动配对、统一命名、转字幕、可选转码/封面，最后点一次“执行整理”。
- **独立转码工具**：侧栏「转码工具」可单独选单个文件或整个文件夹，批量转成 MP3 / AAC / M4A / OGG；默认输出到源目录下的 `Sotto-converted`，也可手动指定目录，支持递归、格式、码率和实时进度，不修改源文件。内嵌 OpenConverter 音频命令核心（Apache-2.0），完成后显示耗时与成品大小。
- **跨目录配对**：字幕可在上下 3 层目录内按文件名/模糊分数寻找；封面可向下任意层，以及向上/相邻 2 层内寻找明确命名的 cover/folder/front/album/封面，不会拿相邻文件夹的 Scenes 图乱猜。
- **多线程转码**：可按 CPU 自动或手动指定 FFmpeg 编码线程；不提供“看起来开启但实际无效”的 GPU 音频加速开关。音频编码器通常只使用其中一部分线程，真正的多文件并发仍在路线图中。
- **更新与设置迁移**：设置页可检查 GitHub Releases、开启每日一次自动更新提醒、在软件内静默下载并校验 SHA-256；设置可导出/导入 JSON，方便换机。更新检查只访问 GitHub，不上传本地文件。
- **隐私默认值**：诊断日志默认关闭，开启前弹窗说明本地保存与风险；崩溃时提示日志位置，便于主动反馈。
- **本地优先**：无账号、无遥测；默认不发起网络请求。只有你手动检查更新或开启自动更新时才会访问 GitHub Releases，且不会上传本地文件或日志。设置与日志只保存在 `%APPDATA%\Sotto`。

## 界面主题

| Fluent / UWP（默认） | Material You | Studio |
| --- | --- | --- |
| 半透明分层、细描边、Windows 11 气质 | 以强调色生成色调容器、大圆角、留白更多 | 近黑高对比、等宽数字、克制的光晕 |

三套主题都支持浅色 / 深色 / 跟随系统，强调色可从预设色板或取色器选择。详见 [docs/DESIGN.md](docs/DESIGN.md)。

## 下载

发行包只在 **GitHub Releases** 提供，源码仓库不提交任何 exe、签名私钥或 ffmpeg 二进制：

- [最新版本](https://github.com/WENlink106795/sotto/releases/latest)
- 文件：x64 / ia32 的 NSIS 安装包与 portable 便携版，附 `SHA256SUMS.txt`
- 当前发行包使用本地自签名证书；其他机器需要导入公钥证书才会信任，正式公开发布建议换 CA 证书。详见 [docs/SIGNING.md](docs/SIGNING.md)

## 快速开始（开发）

环境要求：Windows 10/11、Node.js 20+、npm 10+。

```powershell
npm install
npm run dev          # Electron + Vite 开发模式
npm test             # 核心引擎单元测试
npm run typecheck    # 主进程 + 渲染进程类型检查
npm run build        # 生产构建
npm run screenshots  # 用内置演示数据生成 UI 截图（输出到 screenshots/）
```

仅调试界面（浏览器 + 演示数据，不需要 Electron）：

```powershell
npm run dev:web      # http://localhost:5174
```

## 打包

```powershell
npm run fetch:ffmpeg -- --arch x64    # 下载 ffmpeg 到 resources/ffmpeg
npm run fetch:ffmpeg -- --arch ia32   # 32 位构建使用兼容版 ffmpeg
npm run pack:win                      # electron-builder 生成 nsis + portable
```

- 推荐 64 位安装包；同时提供 **ia32（32 位）** 构建以覆盖老设备。Electron 固定在 34.x，因为后续版本不再发布 Windows 32 位二进制。
- 本地已生成 **0.1.3b x64 标准版**：`release-final-0.1.3b/Sotto-Setup-0.1.3b-x64.exe` / `Sotto-0.1.3-x64-portable.exe`（内嵌 OpenConverter 核心）。
- 四款引擎的完整对比见 [docs/BENCHMARK.md](docs/BENCHMARK.md)：OpenConverter 总耗时最短。

### 致谢

音频转码核心来自 [OpenConverter](https://github.com/nowa277/OpenConverter)（Apache-2.0），感谢作者 nowa277 与 contributors。基准测试也感谢 [HandForge](https://github.com/VoxHash/HandForge) 和 [MuXolotl-Converter](https://github.com/MuXolotl/MuXolotl-Converter) 的作者。
- 当前使用本地自签名证书（本机 `Get-AuthenticodeSignature` 为 Valid，Defender 扫描四个包均无威胁）；其他机器需导入 `build/signing/sotto-selfsigned.cer` 才会信任。正式发布请换成 CA 证书，见 [docs/SIGNING.md](docs/SIGNING.md)。
- 不内置 ffmpeg 时，字幕/命名/封面重命名仍可用；音频转码与图片转 JPEG 需要在设置里指定 `ffmpeg.exe`。
- 发行包与 ffmpeg 的许可证说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 安全

- 仓库不包含 token、密码、私钥、PFX 或真实用户数据。
- `.gitignore` 明确排除 `build/signing/`、`*.pfx`、`*.key`、`*.env`、`release/`、`resources/ffmpeg/*` 等。
- 发行 exe 仅通过 GitHub Releases 上传，不进入 git 历史。
- 应用无账号、无遥测；默认不联网。只有手动检查更新/开启自动更新会访问 GitHub，且不会上传文件、路径或日志。所有文件处理都在本机完成。

## 项目结构

```text
src/
  main/             Electron 主进程（窗口、IPC、图像协议）
    core/           扫描、配对、方案、字幕、ffmpeg、执行与撤销
  preload/          类型化 contextBridge API
  renderer/         React + Tailwind 界面（三套主题 + 演示桥）
  shared/           类型、默认设置、命名清理器、IPC 契约
tests/core/         引擎单元测试
docs/               架构、设计、用户指南、截图
scripts/            图标、截图、ffmpeg 获取、演示曲库
```

更多细节：[架构说明](docs/ARCHITECTURE.md) · [用户指南](docs/USER_GUIDE.md) · [设计说明](docs/DESIGN.md) · [路线图](docs/ROADMAP.md)。

## 创意与后续

已经落地的“额外想法”：模糊配对、命名差异可视化、字幕编码选择、方案预览与撤销、回收站式删除、主题自定义、运行历史、无网络演示模式。更多候选见 [docs/ROADMAP.md](docs/ROADMAP.md)，例如把封面写进音频内嵌标签、双语字幕合并、文件夹监视、CLI 模式。

## 许可证

应用代码以 [MIT](LICENSE) 发布。第三方组件与可选的 ffmpeg 二进制遵循各自许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。