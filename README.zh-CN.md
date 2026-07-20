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

codex:install 命令必须构建 Web App 并启动后台 production 服务。安装完成后请校验插件、
Skill、MCP 工具和 production 服务，告诉我打开 http://127.0.0.1:18771，并说明是否需要
开启一个新的 Codex 任务。不要复制或修改仓库中的 .retake/ 用户数据。
```

这会安装包含 Retake Skill 和 MCP 工具的完整插件。仅复制 Skill 不足以运行完整流程，
因为 Execution、Asset 和结果 Block 都需要通过 MCP 写回。

`npm run codex:install` 会构建 Web App、安装 Codex Plugin，并启动后台 production 服务。
命令完成后请打开 <http://127.0.0.1:18771>。请保留 checkout 和 `node_modules`，以便网页与
MCP bridge 持续可用。

可以在 checkout 中管理后台服务：

```bash
npm run production:status
npm run production:restart
npm run production:stop
```

安装 Codex 的任务结束后，后台服务仍会继续运行。电脑重启后如果服务不可访问，请在
checkout 中运行 `npm run production:start`。

### 手动源码安装

```bash
mkdir -p ~/src
git clone https://github.com/retake-tools/whiteboard.git ~/src/retake-whiteboard
cd ~/src/retake-whiteboard
npm install
npm run dev
```

然后打开 <http://127.0.0.1:18770>。这是带热更新的前台开发服务，可用 `Ctrl+C` 停止。

如果手动源码安装后还要加入 Codex Plugin，请先停止该终端中的开发服务，可选运行
`npm run mcp:test`，再运行 `npm run codex:install`。安装命令会切换到后台 production
流程，并使用 <http://127.0.0.1:18771>。

安装脚本会把此 checkout 注册到默认的 personal Codex marketplace，并制作一个最小插件包。
该插件包只包含 manifest、MCP 配置、Skill、启动桥接脚本、README 及其截图和许可证；不会把
`.retake/` 白板数据、依赖、构建产物、内部调研或测试产物复制到 Codex 插件缓存。

仓库 checkout 不要放在 `~/plugins/retake-whiteboard`；该路径保留给安装器管理的最小插件源包。

MCP bridge 仍从此 checkout 执行。安装 Plugin 后请新建一个 Codex 任务，以加载新的 Skill
和 MCP 工具。

## 如何使用

Retake 会把提示词、原图、Operation 和生成结果保留在同一张无限画布上。在网页中搭好
工作流，从 Operation Block 生成 Codex Prompt，再由 Retake 插件把完成的图片写回预先
准备好的结果 Block。

### 文生图

将 Text Block 连接到文生图 Operation，选择画幅比例和结果数量，再交给 Codex 执行。

![文生图工作流生成真实感海景客厅](./assets/readme/text-to-image.jpg)

### 图生图

把原始 Image Block 和修改提示词连接到 Operation，在保留原始构图的同时修改指定的
视觉属性。

![图生图工作流把海景客厅从黄昏改为蓝调夜景](./assets/readme/image-to-image.jpg)

### 标注编辑

直接在原图上绘制编号标记、箭头、自由画笔、区域笔刷、矩形或椭圆。每个标记都可以
填写独立修改说明，也可以在执行前补充一条全局说明。

![带矩形、箭头、区域笔刷和逐项说明的标注编辑器](./assets/readme/annotation-edit.jpg)

Codex 完成 Operation 后，原图、标注编辑 Operation 和最终结果会继续连接在画布上。本例中，
沙发被改为森林绿色天鹅绒，落地灯移动到沙发旁，并在不改变房间构图的情况下加入珊瑚色云层。

![标注编辑完成后连接在画布上的原图和生成结果](./assets/readme/annotation-edit-result.jpg)

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
npm run production:test
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
