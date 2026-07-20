# Retake Whiteboard

[English](./README.md)

Retake Whiteboard 是面向 Retake 视频创作工作流的无限画布。当前 MVP
聚焦图片阶段：图片 Block、标注驱动的图片编辑，以及通过 Codex/MCP
执行和写回结果。

## 当前范围

图片阶段 MVP 已包括：

- 文生图和图生图 Operation 流程；
- 带可视化标记和逐项说明的标注编辑；
- 预先创建一到四个结果 Block，并支持逐张写回；
- Project、Board、Asset、Execution、Group 和轻量 History 记录；
- Codex/MCP 执行，并复用未来 Direct API Adapter 所需的同一套数据模型。

视频生成、在线协作、Direct Provider API 和动态插件发现目前还不是完整的产品流程。

## 环境要求

- Node.js 20.19 或更高版本（使用 Node.js 22 时需 22.12 或更高版本）；
- npm；
- 已安装 Codex CLI，并可使用 Codex Plugin；
- Codex 环境中可用的真实图片生成或编辑能力。

Retake 插件负责读取 Operation、组织执行上下文和写回结果，不会自行提供图片生成模型。

## 安装

### 让 Codex 自动安装（推荐）

把下面这段发给 Codex：

```text
请从 https://github.com/retake-tools/whiteboard.git 安装 Retake Whiteboard Codex 插件。

请 clone 仓库到 ~/src/retake-whiteboard，运行 npm install，
再运行 npm run mcp:test 和 npm run codex:install。

安装完成后请校验插件、Skill 和 MCP 工具，并告诉我是否需要开启一个新的 Codex 任务。
不要复制或修改仓库中的 .retake/ 用户数据。
```

这会安装包含 Retake Skill 和 MCP 工具的完整插件。仅复制 Skill 不足以运行完整流程，
因为 Execution、Asset 和结果 Block 都需要通过 MCP 写回。

### 手动安装

```bash
mkdir -p ~/src
git clone https://github.com/retake-tools/whiteboard.git ~/src/retake-whiteboard
cd ~/src/retake-whiteboard
npm install
npm run mcp:test
npm run codex:install
```

安装脚本会把此 checkout 注册到默认的 personal Codex marketplace，并制作一个最小插件包。
该插件包只包含 manifest、MCP 配置、Skill、启动桥接脚本、README 和许可证；不会把
`.retake/` 白板数据、依赖、构建产物、内部调研或测试产物复制到 Codex 插件缓存。

仓库 checkout 不要放在 `~/plugins/retake-whiteboard`；该路径保留给安装器管理的最小插件源包。

MCP bridge 仍从此 checkout 执行，因此安装后需要保留仓库和 `node_modules`。安装完成后，
请新建一个 Codex 任务，以加载新的 Skill 和 MCP 工具。

## 本地开发

安装依赖并启动网页：

```bash
npm install
npm run dev
```

开发服务默认运行在 `http://127.0.0.1:18770`。

白板内容保存在 Git 忽略的 `.retake/` 目录中。不要直接修改快照 JSON；应通过白板 UI、
local service 或 MCP 工具操作，以保持 Asset 和 Execution 血缘关系一致。

如需与日常开发端口分离的稳定 release-style preview：

```bash
npm run production
```

该命令会先构建，然后在 `http://127.0.0.1:18771` 启动 production preview。
`npm run preview` 保留为预览已有 `dist/` 的 Vite 兼容别名。

## Codex 使用流程

1. 启动 Retake Whiteboard 网页，并创建或打开一个 Project 和 Board。
2. 创建文生图、图生图或标注编辑 Operation。
3. 第一次使用时，将当前 Codex workspace 绑定到对应的 Retake Project 和 Board。
4. 在 Operation Block 中生成 Codex Prompt，并在一个新的 Codex 任务中执行。
5. Codex 使用可用的真实图片能力生成或编辑图片，再通过 Retake MCP 工具写回 Asset、
   Execution 和结果 Block。

`Codex Managed` 是内置执行配置，不需要配置独立的模型 Provider 或 API Key；但当前
Codex 环境仍必须具备真实图片生成或编辑能力。Direct API、ACP 和第三方模型配置属于
可选的用户本地设置，不随项目默认值分发。

Codex 只是一个执行通道，不是 Retake 的产品后端。插件负责执行和打包，独立 Web App
仍是主要产品界面，从而让未来 Direct API、Hosted Web 和商业版本可以复用同一套
Project、Board、Asset 和 Execution 模型。

## 验证

```bash
npm run typecheck
npm run build
npm run mcp:test
npm run plugin:package:test
npm run skill:validate
```

`npm run mcp:test` 必须顺序运行，因为契约测试共享并重置 Git 忽略的 `.retake-test/`
工作区；它不会重置真实的 `.retake/`。视觉或交互改动还应在命名清晰的临时 Project
和 Board 中验证，不要使用已有的用户 Board。

## 架构边界

- `Block` 管理用户可见的画布状态和位置；
- `AssetRecord` 管理资产元数据和存储引用；
- `ExecutionRecord` 管理一次能力执行，包括 route、status、input、output、
  provider/model 元数据和错误；
- `Plugin` 定义能力，`Adapter` 执行能力，`Skill` 定义可兼容的创作或流程行为；
- Canvas 协调工作流，但不持有 Provider 专属逻辑。

MCP 写回和未来 Direct API 执行必须汇合到同一套 Asset 与 Execution 记录。

## 参与贡献

仓库边界、验证方式和安全 UI 测试说明请参阅 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 许可证

Retake Whiteboard 使用 [MIT License](./LICENSE)。
