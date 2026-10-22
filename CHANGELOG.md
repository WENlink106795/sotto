# Changelog

All notable changes to this project will be documented in this file.

## [0.1.3b] - 2026-10-22

### Added

- 侧栏独立「转码工具」：单文件或整个文件夹批量转码，默认输出到源目录下的 `Sotto-converted`，可手动指定或恢复默认。
- 支持 MP3 / AAC / M4A / OGG，128k / 192k / 256k / 320k；递归扫描、实时文件夹与文件进度。
- 内嵌 OpenConverter 音频 FFmpeg 命令核心（Apache-2.0），并采用纯音频 `-vn` 处理和 raw AAC/ADTS 修正；资料库批量转码也统一走该核心。
- 转码完成后显示实际耗时（墙钟时间）与成品总大小。
- 多文件并发转码：自动或手动选择 1 / 2 / 4 个文件同时转码；输出名预分配，避免同名文件互相覆盖。
- 转码工具支持拖入文件/文件夹，或从资源管理器复制路径后点「粘贴路径」。
- 4 格式 × 3 码率基准报告：`docs/BENCHMARK.md`。

### Fixed

- 修复「记录本地诊断日志」确认弹窗标题、正文和按钮贴边/被裁切的问题，改用标准 modal-head / modal-body / modal-foot 布局。
- 手动检查更新发现新版本后，工具页直接提供「一键下载更新」/「安装并重启」按钮；修正 `0.1.3b` 这类尾部字母版本的比较规则。
- 「已用时间」改为真实墙钟耗时，不再使用 ffmpeg 输出的媒体时间戳。
- 统一所有音频转码路径使用同一个 OpenConverter 内核参数。

### Notes

- MuXolotl-Converter 仅用于基准对比（GPL-2.0/LGPL-2.1），不进入标准版代码或发行包。
- 基准测试统一使用随包 FFmpeg、纯音频输出和顺序执行；测试文件含封面，已单独说明。
- 自签名证书仅本机受信任；多语言界面仍未完成。

## [0.1.1] - 2026-10-22

### Added

- Cross-folder subtitle matching up to three directory levels; cover candidates can include explicitly named covers from parent/sibling folders.
- Per-file FFmpeg progress via `-progress pipe:1`: filename, elapsed time, operation index and file percentage.
- Optional FFmpeg thread count (automatic CPU-based or manual); no misleading GPU audio toggle.
- Update checker, daily in-app update prompt, silent GitHub Release download with SHA-256 verification and install flow.
- Settings export/import JSON and manual GitHub repository link.
- Opt-in diagnostic logging with a consent dialog; crash dialogs show the log path.
- Green privacy badge styling.
- Local rotating diagnostic log for main/renderer errors, uncaught exceptions, IPC failures, and scan/plan/apply summaries.
- One-click diagnostics export in Settings > Tools, bundling environment details, settings summary, recent app log, and recent apply logs with home-directory redaction.
- Renderer error boundary and global error/unhandled-rejection reporting to the local log.

### Notes

- This release is Chinese-first; full Chinese/English/Japanese UI localization is still pending.
- Multi-threading controls FFmpeg encoder threads, not concurrent multi-file conversion; GPU audio encoding is intentionally not offered.

## [0.1.0] - 2026-10-21

### Added

- VTT / SRT to LRC conversion with UTF-8, UTF-8 BOM and GB18030 output.
- Content-based `.txt` lyric detection: WebVTT/SRT/LRC content is converted; plain scripts/readmes are ignored.
- Support for double-extension subtitles such as `track.mp3.vtt`, matched exactly after stripping the media suffix.
- Smart audio/subtitle pairing across folders with fuzzy confidence and manual override.
- Filename sanitizer that removes emoji, symbols and Windows-illegal characters while keeping audio and subtitles in sync.
- Cover candidate gallery, configurable cover name, optional JPEG conversion and opt-in automatic cover selection for batch runs.
- Optional WAV / FLAC / APE / AIFF / ALAC / WMA to MP3 / M4A transcoding through ffmpeg.
- Dry-run plan, two-phase safe renames, run journal, history and undo.
- Fluent, Material You and Studio themes with accent, radius, density and font-scale customization.
- Batch mode: drag a whole `[ASMR]` root, use saved settings as a preset, review one plan and apply once.
- Optional Authenticode signing flow (self-signed local certificate; CA certificate recommended for release).
- Local-first desktop app (Electron + React + TypeScript), x64 and ia32 packaging.