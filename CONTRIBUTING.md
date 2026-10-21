# 贡献指南

## 开发环境

- Windows 10/11
- Node.js 20+（建议 22 LTS）
- npm 10+
- 可选：ffmpeg（音频转码与截图测试）

```powershell
npm install
npm run dev
```

仅调试 UI：`npm run dev:web`（浏览器打开 http://localhost:5174，使用内置演示数据）。

## 代码结构

- `src/main/core/`：纯逻辑 + 文件操作，尽量不依赖 Electron，方便单测；
- `src/shared/`：主进程与渲染进程共享的类型、设置、命名规则；
- `src/renderer/`：React 界面，所有文件访问必须走 `MurmurApi`；
- `tests/core/`：核心引擎测试。

## 提交前检查

```powershell
npm run typecheck
npm test
npm run build
npm run screenshots   # 改了 UI 时
```

## 约定

- TypeScript strict；不用 `any` 逃逸类型检查（确有必要时局部标注并说明）。
- 不在渲染进程引入 Node API。
- 任何会修改用户文件的逻辑，必须先进入 `PlanResult` 预览，并写入撤销日志。
- UI 文案使用简体中文，代码与注释使用英文。
- 新功能请附带测试；修 bug 请附复现步骤。

## 发布

1. 更新 `package.json` 版本与 `CHANGELOG.md`；
2. `npm run fetch:ffmpeg -- --arch x64` / `--arch ia32`（如随包分发）；
3. `npm run pack:win`；
4. 在 GitHub Release 上传 `release/` 下的安装包与 portable 包，并附 SHA-256。
