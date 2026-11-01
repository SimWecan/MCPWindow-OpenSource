# MCPWindow v0.8.4

跨平台 MCP 服务器可视化管理台（Windows / macOS / Linux，优先适配 Windows 与 macOS）。支持多个独立 MCP 服务器的接入、真实状态探测、进程托管、分区授权和第三方 Tool 插件扩展。

## 功能

- **总览仪表盘**：服务器状态分布、14 天访问/崩溃趋势、24 小时访问走势、热门工具排行；支持手动同步最新访问日志并即时重算统计图表
- **分区管理**：业务维度 + 工程维度双视角，支持新建、搜索、编辑、归档和删除；服务器接入窗口可直接新建所属分区并自动选中，删除分区会归档其下服务器并回收相关授权
- **多服务器接入与管理**：在主控台独立展示和管理多个 MCP 服务器，支持查看连接配置、访问凭证、运行趋势和日志详情；可手动接入或一键导入标准 `mcp.json`（`mcpServers` 格式）
- **卡片手动排序**：长按服务器卡片后拖动，位置限制在服务器列表内，松手保存手动顺序；指针接近窗口上下边缘时自动滚动避让并补偿卡片位置，离开边缘、取消或松手后停止；普通点击仍进入详情，刷新后保持排序
- **批量与配置克隆**：分组选择服务器后批量启动、停止、归档或移动分区，逐台执行并报告结果；可克隆独立配置，同一分区禁止同名服务器
- **Tags、收藏和自定义视图**：按名称、描述、命令或 Tags 搜索，筛选收藏，保存最多 20 组包含分区、标签和收藏条件的自定义视图
- **多种连接认证**：HTTP(S) 服务器接入支持 **Bearer Token、Basic Auth、API Key** 下拉选择；API Key 可自定义请求头，认证配置真实用于 MCP `initialize` 握手和状态探测
- **真实运行探测**：等待本机加密配置恢复后自动重新探测（不读缓存），校验 MCP 协议版本、能力与服务信息（在线 / 需凭证 / 离线），普通 HTTP 200 不会误判在线；桌面端通过 Electron 网络栈遵循 macOS / Windows 系统代理，长期运行时每 30 分钟自动刷新，支持手动刷新和异常诊断
- **独立进程托管与资源监控（桌面版）**：本地 MCP 由独立守护进程托管，应用启动只按配置与凭证确认状态，应用退出或最小化不会改变 MCP 运行状态；重新打开后自动恢复受管进程状态。支持真实启动、停止、重启和进程树回收，启动须通过 stdio `initialize` 握手；每 10 秒采样 CPU、内存与运行时长
- **主题化关闭窗口与系统托盘**：关闭管理窗口时通过同风格弹窗选择最小化、退出或取消；最小化后主窗口从任务栏隐藏并驻留右下角系统托盘，单击图标恢复，托盘菜单支持打开和退出。两种关闭选择均不影响 MCP 服务器
- **远程实时管理**：配置独立管理代理地址与全局 admin 凭证后，启停、分区新增/删除、凭证发放/修改/吊销直接下发到对应服务器；服务器确认并回读成功后才更新界面，失败会显示原因。进程运行状态与 MCP 访问状态分别核实：进程运行但普通访问凭证缺失或无效时显示“需凭证”，不会误判为进程停止，也不会在退出应用时发送远程停止命令
- **第三方凭证发放与到期提醒**：支持 Bearer Token、Basic Auth、API Key 三种认证类型，可自动生成或手动填写密钥、自定义 API Key 请求头，并按分区授权、限流、设置有效期、启停或吊销；总览提醒已过期仍启用及 7 天内到期凭证
- **日志统计与持续同步**：访问次数与崩溃趋势、访问端点分布、来源客户端分布及访问与崩溃明细；桌面版启动及每 30 分钟同步本地访问日志，配置管理端时改用远程 `GET /manage/access-logs`，因此 macOS 无需服务器本地文件也能持续获取 TerraFin 日志；手动“重新探测”也会同步，按服务器与来源键去重，支持 TerraFin `request.log` 和常见 JSONL 访问日志；总览和日志统计均提供“刷新日志”，同步新增记录并重新生成可视化图表
- **首次历史记录导入**：手动接入或导入新 MCP 服务器后，自动检测其项目目录及常见日志位置；发现历史记录时弹窗询问，确认后才导入，未发现则正常接入；拒绝历史导入后仅同步之后的新记录，检测不同步密钥文件且不扫描全盘
- **AI 辅助管理**：可配置多个 API 提供方和 API Key，通过下拉框选择模型；兼容 OpenAI Chat Completions、OpenAI Responses 与 Anthropic Messages 协议，可适配 ChatGPT、Claude、DeepSeek、Kimi、千问等服务；管理操作须经用户授权确认
- **Tool 插件扩展**：导入第三方 Tool 插件扩展 MCPWindow 自身功能，支持多插件独立启停、调用和删除，并提供参数 Schema 校验与权限隔离；支持已安装插件搜索、状态筛选、名称／版本／发布者排序，以及最多 50 条本地操作记录与失败原因回查；支持 SemVer、HTTPS 更新检查、SHA-256 完整性摘要及受信任来源管理。完整性摘要不是公钥身份签名，来源信任也不会绕过权限或校验
- **浏览器 Companion 扩展**：透明线性图钉固定管理面板，加宽界面并支持直接拖动 MCPWindow 标题区在视口内移动、保存位置；本地智能识别 `mcp.json` 并填写认证配置、服务器搜索、状态筛选、名称／状态／最近探测排序及操作记录、服务器卡片长按排序、可视化详情与单台状态刷新；排序拖动接近窗口上下边缘时自动滚动避让，离开边缘、取消或松手后停止；通过浏览器 alarms 每 30 分钟同步访问日志，在详情中展示 14 天趋势、24 小时分布和热门端点；详见 `browser-extension/README.md`
- **界面个性化**：支持中文 / English 切换和多套主题，默认主题与软件 Logo 保持一致；适配窄窗口显示
- **配置备份恢复**：导出脱敏配置备份，按名称合并恢复并自动跳过冲突、重映射分区和清除敏感字段

## 当前版本

**0.8.5**：桌面端新增已安装 Tool 插件搜索、状态筛选、名称／版本／发布者排序，以及最多 50 条本地操作记录与失败原因回查。浏览器 Companion 同步提供服务器搜索、状态筛选、多种排序及添加、删除、探测、日志设置操作记录。

## 下一周期开发路线

- **浏览器扩展增强**：提供告警提醒、快捷跳转和远程 HTTP MCP 受控操作；本地 stdio 管理通过 Native Messaging 或桌面 companion service 与 MCPWindow 连接
- **移动端适配**：以远程管理 API 为主要方向，提供状态、告警、审批和受控操作；移动端不直接托管本地 MCP 进程
- **安全边界**：沿用凭证加密、权限隔离和用户确认机制；浏览器与移动端不暴露完整管理凭证，高风险操作必须经过授权审批

## 开源说明

- 基于 MIT License，任何 MCP 服务器机主均可下载、部署与二次开发
- 数据默认保存在本机（浏览器 / Electron localStorage），不经过任何远端；导入 `mcp.json` 时凭证头等敏感字段不会上传
- 公共版本不预置个人服务器、路径、凭证或开发者联系方式；可在 `src/data/localConfig.ts` 中按需添加自己的首次启动示例
- 主进程启动日志写入系统临时目录 `mcpwindow-main.log`，便于部署后排障

## 技术栈

Vite + React 18 + TypeScript + Zustand（localStorage 持久化）+ ECharts + Electron + electron-builder

## 版本历史

见 [CHANGELOG.md](CHANGELOG.md)。

## 开发

```bash
npm install          # 首次安装依赖
npm run dev          # 浏览器预览（http://localhost:7100）
npm run dev:electron # Electron 开发模式（Windows / macOS / Linux 均可用）
npm test             # 前端单元测试（含 30 分钟轮询调度）
npm run test:e2e     # 真实 Electron 窗口交互测试
```

## 打包分发

```bash
npm run electron:dir    # 免安装目录产物（release/，可用 MCPWINDOW_OUT 覆盖输出目录）
npm run electron:build  # 完整安装包
# Windows -> NSIS + portable；macOS -> dmg + zip；Linux -> AppImage + deb
```

国内网络环境建议配置二进制镜像：

```bash
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
```

> 应用资源默认封装为 `app.asar`。需要签名分发时，通过 `CSC_LINK` 提供证书路径或 base64 内容，并用 `CSC_KEY_PASSWORD` 提供证书密码；未配置证书时生成的是未签名包，不代表已完成签名。
> macOS 打包需在 macOS 上执行；无证书的 CI 构建可配 `CSC_IDENTITY_AUTO_DISCOVERY=false` 明确跳过签名。
> 打包入口为 `scripts/build.cjs`（程序化调用 electron-builder，规避 CLI 与部分 Node 版本的参数解析兼容问题）。

## 目录结构

```
MCPWindow/
├── build/              # 应用图标（icon.ico / icon.png）
├── electron/           # Electron 主进程与预加载脚本（.cts，输出 .cjs；含进程托管 IPC）
├── scripts/            # build.cjs 程序化打包入口
├── src/
│   ├── pages/          # 功能页：总览 / 分区 / 服务器（主控台+详情）/ 凭证 / 日志 / AI
│   ├── store/          # zustand 全局状态（含种子数据、持久化）
│   ├── data/           # 确定性种子数据 + 本机 mcp.json 导入解析
│   ├── components/     # ECharts 封装、弹窗、服务器表单
│   └── utils/          # 统计聚合、在线探测、进程控制
└── release-*/          # 打包输出（MCPWINDOW_OUT 可覆盖）
```
