# 第三方组件与许可证

Sotto 的应用代码以 MIT 许可发布。以下组件随应用或构建产物分发，遵循各自许可证。

## 运行时依赖

| 组件 | 用途 | 许可证 |
| --- | --- | --- |
| Electron | 桌面运行时 | MIT |
| React / React DOM | UI | MIT |
| Zustand | 状态管理 | MIT |
| lucide-react | 图标 | ISC |
| iconv-lite | GB18030 / UTF-16 编解码 | MIT |
| clsx | className 工具 | MIT |

## 可选外部程序：FFmpeg

Sotto 不修改 FFmpeg，仅通过子进程调用 `ffmpeg.exe` 完成音频转码与图片转 JPEG。

- 官网：https://ffmpeg.org/
- 许可证：取决于构建选项，常见为 LGPL-2.1+ 或 GPL-2.0+。默认随包分发的 x64 构建使用 BtbN 的 **LGPL** 静态构建（`ffmpeg-master-latest-win64-lgpl`），许可证文本会放在 `resources/ffmpeg/x64/LICENSE.txt`；源码与构建说明见 https://github.com/BtbN/FFmpeg-Builds 。
- 32 位构建来自 `@ffmpeg-installer/win32-ia32`（旧版兼容构建）。
- 如果你自行替换 ffmpeg，请确认其许可证与再分发条件。
- 64 位构建来自 BtbN FFmpeg-Builds（LGPL 静态构建），32 位构建来自 `@ffmpeg-installer/win32-ia32`。二者均为独立可执行文件（mere aggregation），不修改 FFmpeg 源码。

## 音频转码引擎：OpenConverter

Sotto 标准版的独立转码工具内嵌 **OpenConverter** 的音频 FFmpeg 命令核心（纯音频、无 GUI/解密/网络功能）。

- 项目：https://github.com/nowa277/OpenConverter
- 作者：nowa277 与 contributors
- 许可证：Apache License 2.0
- 完整许可证：`licenses/OpenConverter-LICENSE.txt`
- 归属说明：`licenses/OpenConverter-NOTICE.txt`

感谢 OpenConverter 作者提供高质量的开源实现。

### 基准测试参考（未随标准版分发）

以下项目仅用于本机音频核心对比，其代码未进入标准版：

- [HandForge](https://github.com/VoxHash/HandForge) — MIT；感谢作者。
- [MuXolotl-Converter](https://github.com/MuXolotl/MuXolotl-Converter) — GPL-2.0 / LGPL-2.1；仅本机测试，未嵌入标准版。

## 字体

界面仅使用系统字体（Segoe UI Variable、Microsoft YaHei UI），不随包分发字体文件。