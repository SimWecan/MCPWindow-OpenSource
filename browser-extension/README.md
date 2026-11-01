# MCPWindow Companion 浏览器扩展

当前版本 **0.8.5**，支持 Chrome、Edge 等 Manifest V3 浏览器。

## 已实现

- 添加、保存和删除多个远程 HTTP(S) MCP 服务器
- Bearer Token、Basic Auth、API Key 认证请求头
- 使用真实 MCP `initialize` 握手探测状态，普通 HTTP 200 不会误判在线
- 打开弹窗自动刷新、手动刷新、在线／需凭证／离线汇总
- 启动及每 30 分钟通过 Manifest V3 `alarms` 同步访问日志，弹窗关闭或 Service Worker 休眠后仍可唤醒；手动重新探测也会同步
- 服务器详情展示 14 天访问趋势、24 小时访问分布、热门端点、24 小时／14 天访问量与成功率；图表由本地 SVG 生成，不加载远程脚本或图表依赖
- 支持独立日志管理接口和 admin 凭证；日志按服务器与来源键去重，最多保留 20,000 条，并在 `chrome.storage.local` 持久化
- 普通弹窗宽 480px，钉住面板最大宽 520px；透明线性图钉与整体暗色风格一致，无额外拖动条或空状态提示卡
- 顶部图钉将管理面板固定到当前普通 HTTP(S) 网页；点击网页不会关闭，直接拖动 MCPWindow 标题区即可移动，位置限制在视口内并自动保存，快速关闭重开也能恢复
- 粘贴标准 `mcp.json` 或单服务器 JSON，本地智能识别并填写名称、地址与认证字段；识别过程不调用外部 AI、不上传配置，需用户核对后手动保存
- 多个远程配置默认填写第一项并提示总数量；本地 stdio 或无效项会提示跳过数量
- 支持按名称或地址搜索、按状态筛选，按名称、状态或最近探测排序；自定义顺序且无筛选时可长按约 500ms 拖动排序，刷新后保留；指针接近窗口上下边缘时自动滚动避让并补偿卡片位置，离开边缘、取消或松手后停止；普通点击或 Enter/Space 打开可视化详情，可查看探测结果并单独刷新，不展示完整凭证
- 记录添加、删除、单台探测和日志设置的成功或失败结果及原因，本地最多保留 50 条，支持清空，不记录凭证
- 通过 DOM `textContent` 渲染配置，避免服务器名称或地址注入 HTML

## 安装

1. 打开 `chrome://extensions/`（Edge 为 `edge://extensions/`）。
2. 开启“开发人员模式”。
3. 点击“加载解压缩的扩展”，选择本目录 `browser-extension/`；也可先解压发布包 `MCPWindow-Companion-0.8.5.zip`。
4. 点击工具栏 MCPWindow 图标，添加远程 MCP 地址、认证配置，或粘贴 `mcp.json` 后点击“智能识别并填写”。
5. 在添加窗口或服务器详情的“日志接口设置”中填写管理接口和 admin 凭证；留空管理接口时请求 MCP 同源地址，留空 admin 凭证时使用普通访问认证。
6. 点击顶部图钉图标将面板钉在当前网页；直接拖动 MCPWindow 标题区调整位置，再次点击图钉取消钉住。

## 访问日志接口约定

目标服务器需提供管理端点：

```text
GET /manage/access-logs?limit=20000
Accept: application/json
Authorization: Bearer <admin 凭证>
```

响应可为日志数组，或 `{ "logs": [...] }`、`{ "records": [...] }`。单条记录支持以下字段：

- 时间：`ts`、`timestamp`、`at` 或 `time`；支持 ISO 字符串、毫秒或秒级时间戳，缺失或无效时忽略该记录
- 标识：`id`、`sourceKey` 或 `request_id`；用于跨同步去重，缺失时按内容生成来源键
- 内容：`endpoint`／`path`／`url`、`client`／`clientIp`、`tool`／`method`／`action`
- 结果：`ok` 或 `status`／`statusCode`；耗时支持 `latencyMs`、`latency_ms`、`durationMs`、`duration_ms`，未知耗时保持为空
- 聚合记录可用非负 `count` 表示访问次数，缺省为 1

配置管理地址时，可填写服务根地址或以 `/manage` 结尾的地址。非本机管理接口必须使用 HTTPS。admin 凭证存在时优先用于日志请求；否则回退到该服务器的普通 Bearer、Basic 或 API Key 认证，不会把 admin 凭证用于 MCP 状态探测。

TerraFin 管理代理已提供上述 `/manage/access-logs` 端点，可直接接入真实日志。单台服务器日志接口不可用或鉴权失败时，仅记录该服务器的同步错误，不影响其他服务器日志或 MCP 在线状态。

## 限制与安全边界

- 当前只管理远程 HTTP(S) MCP，不直接托管本地 stdio 进程；后续通过 Native Messaging 或桌面 companion service 接入桌面版。
- 凭证和日志保存在当前浏览器的扩展本地存储中，不会发送给 MCPWindow 或其他服务，但浏览器扩展存储不等同于系统加密凭证库。
- 扩展请求 HTTP(S) 权限用于连接用户配置的服务器，`alarms` 权限仅用于 30 分钟日志同步。目标服务必须允许来自扩展源的请求；非 localhost 服务应使用 HTTPS。
- 钉住功能仅在用户主动点击后向当前普通 HTTP(S) 标签页注入面板；浏览器内置页、扩展商店等受限页面可能不允许注入。
- 这是状态探测、日志图表与配置管理版本，尚不包含远程启停、审批、告警通知或与桌面版配置同步。

## 测试

在仓库根目录执行：

```bash
npm run test:extension
```

该命令运行配置解析、MCP 探测、日志归一化／去重与图表聚合单元测试，再使用本机 Edge 启动隔离测试配置，验证真实扩展交互；可通过 `EDGE_PATH` 指定其他 Chromium 浏览器路径。交互测试包含 30 分钟 alarm、admin 鉴权、SVG 图表、增量去重、刷新持久化、钉住和拖动。
