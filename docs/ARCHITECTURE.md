# 架构说明

## 总览

```text
┌──────────────────────────── Electron ────────────────────────────┐
│ Renderer (React + Tailwind)                                      │
│   Zustand store ── bridge.ts ── window.murmur ── preload          │
│        │                                              │          │
│        └────────── 类型化 IPC（Promise + 进度事件） ───┘          │
│                                                      │           │
│ Main process                                         │           │
│   index.ts（窗口/IPC/图像协议）                      │           │
│   core/scan.ts  core/plan.ts  core/subtitle.ts       │           │
│   core/apply.ts  core/journal  core/ffmpeg.ts        │
  core/logger.ts（滚动日志、脱敏、诊断包）             │
  core/updates.ts（GitHub Release 检查/校验下载）        │           │
│   settings-store.ts（%APPDATA%/Sotto/settings.json） │           │
└──────────────────────────────────────────────────────────────────┘
                              │
                       本地文件系统（只读扫描 → 方案 → 执行）
```

- **渲染进程**不直接访问文件系统；所有路径与文件内容都经 IPC 由主进程处理。
- **preload** 只暴露 `MurmurApi`（见 `src/shared/api.ts`），开启 contextIsolation，禁用 nodeIntegration。
- 图像通过自定义协议 `murmur://image?path=...` 加载，只允许访问已扫描根目录下的图片，避免渲染进程拥有任意文件读取能力。
- 配置、运行记录、日志位于 Electron `userData` 目录；卸载应用不会动用户的曲库。

## 数据流

1. **scan**：递归遍历根目录，跳过隐藏目录、`node_modules`、系统目录与符号链接；返回扁平文件夹列表、文件元数据、统计与截断标记。
2. **plan**（纯计算，不写盘）：
   - 字幕（vtt/srt/lrc）与音频按同目录 → 邻近子目录的顺序配对；
   - 生成清洗后的目标主干名，并为冲突追加序号；
   - 计算字幕输出、音频转码、封面动作与所有警告；
   - 输出 `PlanResult`，由 UI 完整预览。
3. **apply**：按文件夹执行两阶段重命名、字幕转换、音频转码、封面处理；每一项独立记录成功/失败；实时发送进度事件；写入运行日志与撤销日志。
4. **undo**：按日志逆序恢复重命名、删除新建文件、还原覆盖备份；若本次运行包含“移入回收站”的删除，撤销会明确标记为不完整。

## 命名规则

`src/shared/naming.ts` 同时被主进程与界面引用，保证“设置里的实时预览”和“真正执行的改名”完全一致。

处理顺序：

1. 可选 NFKC 归一化（全角 → 半角等）；
2. 逐码点过滤：
   - 控制/格式/私有区字符删除；
   - 表情与符号（`Extended_Pictographic`、`So`）删除；
   - Windows 非法字符 `< > : " / \ | ? *` 删除；
   - 字母、数字、组合符号保留（可选仅 ASCII）；
   - 标点仅在允许列表内保留（用户可自定义）；
3. 合并空白、去除首尾空格与点；
4. 空结果回退为 `untitled`；Windows 保留设备名加 `_` 前缀；
5. 按用户上限截断（码点安全）。

音频与字幕共用同一个 `targetBase`，因此执行后二者除去扩展名完全相同。冲突时同时给音频、字幕、LRC 追加相同后缀。

## 字幕转换

- 解析器同时支持 WebVTT 与 SRT 子集：`WEBVTT` 头、`NOTE`/`STYLE`/`REGION` 块、cue id、`<c>`/`<v>`/`<ruby>` 等标签、HTML 实体、毫秒/逗号时间戳、乱序与重叠 cue。
- 扫描把 `.txt` 记为独立的 `text` 类型，不直接计入字幕；plan 阶段读取内容并嗅探 `WEBVTT` / `-->` / LRC 时间标签，只有带时间轴的歌词才会被提升为字幕候选。普通剧本/readme 进入“已忽略文本”并产生 info 警告。
- 对于 `track.mp3.vtt` 这种双扩展名，匹配键会先去掉媒体扩展名再比较，避免只能靠模糊匹配；目标基名仍取音频的基名。
- 编码探测顺序：BOM（UTF-8/UTF-16LE/BE）→ 严格 UTF-8 → GB18030。界面会显示探测结果。
- LRC 时间戳格式 `[mm:ss.xx]`，分钟允许超过 59；可选偏移、元数据、多行合并。
- 输出编码可选 UTF-8 / UTF-8 BOM / GB18030，换行统一 CRLF，照顾老车机。
- 转换前若目标 LRC 已存在，方案会标记“将覆盖”，执行时备份旧文件以支持撤销。
- 默认保留源 VTT/SRT：转换成功后，源字幕在**自己所在的目录**内就地改为同一个目标主干名，不会移动到音频目录；LRC 则写到音频旁边。若源目录存在同名冲突，则跳过源字幕改名并给出警告，LRC 仍会生成。
- 源字幕与音频跨目录配对时，UI 会显示“字幕来自相临近文件夹”，执行后字幕仍在原目录，只是文件名与音频对齐。

## 配对算法

对每个音频：

1. 同目录候选：原文精确 → NFKC/去空白/去标点后精确；
2. 模糊匹配：字符 bigram Dice 系数 + 令牌 Jaccard + 括号内容移除后的相似度；
3. 跨目录候选：父/子目录（限制深度）内的字幕，名字分数加权目录距离；
4. 同目录仅有一个音频和一个字幕时允许 `single` 兜底，但标注低置信度；
5. 若多个候选分数接近，输出歧义警告，仍选分数最高者，等待用户核对；
6. 核心 API 支持手动配对（`manualPairs`），优先级最高；当前版本的界面以自动配对 + 警告为主，手动配对交互列在路线图。

已有 LRC 与 VTT 同时存在时，优先使用 LRC，避免重复转换。字幕格式优先级为 LRC > VTT > SRT > TXT：同一音频存在多种等价字幕时，避免把 TXT 剧本重复转换。
自动封面（可选）只会在候选图片有明确 cover/folder/front/album/封面 命名、或文件夹内只有一张图片时自动选取；候选过多且命名不明确时跳过并提示，避免把 Scenes/CG 图误当封面。

## 音频转码

通过外部 `ffmpeg.exe`：

- MP3：`libmp3lame`，`-id3v2_version 3 -write_id3v1 1`，提升老播放器兼容性；
- M4A：AAC，`+faststart`；
- 保留元数据（`-map_metadata 0`）；输出先写临时文件再原子改名；
- **改名与转码相互独立**：音频改名始终针对原文件，目标为清理后的原扩展名；转码输出是同一主干的另一个扩展名。关闭转码时仍会执行改名，关闭改名时转码仍可从原文件生成规范名称的输出。
- 原文件删除通过 Electron `shell.trashItem` 进入回收站，只有转码成功后才执行；
- 找不到 ffmpeg 时，转码与图片转 JPEG 会被跳过并给出提示，其余功能不受影响。

转码默认只处理与字幕成功配对的音频。没有字幕的音频需要在设置中打开“无字幕音频也纳入整理”，才会进入方案并参与改名/转码；这样避免误改 BGM、音效等非作品文件。

## 安全模型

- 渲染进程无 Node 权限；IPC 参数做类型与路径校验。
- 图片协议只允许扫描过的根目录内的白名单后缀。
- 执行前重新检查源/目标是否存在，绝不覆盖无关文件；覆盖类操作先备份。
- 所有改名先改到临时名再改到最终名，避免 A→B、B→A 的环。
- 默认不删除任何文件；开启删除时进回收站。

## 日志与诊断

- `src/main/core/logger.ts` 提供无 Electron 依赖的 `AppLogger`，写入 `userData/logs/app.log`，约 5MB 轮转并保留 3 个备份。
- 主进程记录启动环境、IPC 耗时/失败、扫描/方案/执行摘要、未捕获异常、渲染进程崩溃与子进程退出。
- 渲染进程通过 `diagnostics:log` IPC 上报 `window.error`、`unhandledrejection` 和 React ErrorBoundary 捕获的错误；不会逐条记录普通点击。
- 每次 apply 继续写独立的 `apply-<runId>.log`。导出时把最近的 app 日志与最多 6 个 apply 日志合并为一个文本诊断包。
- 日志与导出内容会做基础脱敏（用户主目录、token/password 等字段），但文件路径仍可能包含作品目录名；导出由用户主动选择保存位置，应用不会自动上传。
- 测试：`tests/core/logger.test.ts` 覆盖脱敏、格式、轮转、读取与诊断包生成。

## 更新与网络

- `core/updates.ts` 通过 GitHub Releases API 检查最新版本，选择与当前架构匹配的 NSIS 安装包和 `SHA256SUMS.txt`。
- 下载在软件内进行，边下边计算 SHA-256；校验不通过会删除文件。只有用户确认升级后才启动安装程序。
- 自动更新默认关闭；开启后每天最多提示一次，提示状态写入 `general.lastUpdatePrompt`。这是应用唯一的网络请求路径。
- 设置导出会移除最近路径与 ffmpeg 路径；导入保留当前设备路径。

## 代码签名

- 本地开发使用当前用户范围的自签名证书，签名内层 `Sotto.exe`、ffmpeg 与便携版外壳；签名机制与 electron-builder 的 `CSC_LINK` / `CSC_KEY_PASSWORD` 一致。
- 自签名证书只在本机受信任；正式发布需换成 CA 签发的 OV/EV 证书，否则其他用户仍会看到未知发布者。详见 [SIGNING.md](SIGNING.md)。

## 打包与 32 位

Electron 34 是最后一个仍提供 `win32-ia32` 产物的稳定线之一。`electron-builder` 同时产出 x64 与 ia32 的 NSIS 安装包和 portable 单文件。32 位包使用兼容版 ffmpeg（见 `scripts/fetch-ffmpeg.mjs` 与 `THIRD_PARTY_NOTICES.md`）。

## 测试

- `tests/core/*.test.ts`：纯逻辑单元测试（VTT/SRT、LRC、命名、扫描、配对、方案、执行/撤销）；
- `npm run typecheck`：主进程 + 渲染进程严格类型检查；
- `npm run screenshots`：用演示数据渲染真实 Electron 窗口截图，供视觉回归。