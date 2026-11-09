# MCPWindow Mobile

MCPWindow 的 Flutter 移动端工程，面向 Android 与 iOS。

## 定位

移动端是桌面端的便捷入口，不直接托管本地 MCP 进程：

- 一眼查看关键服务器状态；
- 接收离线、崩溃和凭证到期告警；
- 审批高风险操作；
- 远程启动、停止和重启服务器；
- 手动添加服务器或导入 `mcp.json` 并同步至桌面端。

完整配置、深度日志分析和本地 stdio 进程托管继续由桌面端提供。

## 当前状态

已实现并通过桌面端局域网配对服务接入真实数据：

- 总览关键指标；
- 服务器搜索、状态筛选、详情和远程操作（启动/停止/重启/删除）；
- 告警列表与全部已读（数据来自桌面端实时探测）；
- 高风险操作审批（桌面端暂无审批工作流时为空列表）；
- `mcp.json` 智能识别导入，新增服务器同步至桌面端；
- 桌面端配对连接：设置页输入地址与令牌，或从剪贴板智能识别
  `mcpwindow://pair/v1?...` 二维码内容 / URL+token 文本；
- 未配置配对信息时回退到演示数据源，便于离线验证交互。

## 配对服务协议

桌面端开启“移动端配对”后在局域网提供 HTTP + WebSocket 服务（默认端口 42101，
占用时自动顺延），除 `/health` 外所有接口需要 `Authorization: Bearer <token>`：

```text
GET  /health
GET  /mobile/snapshot
GET  /mobile/summary | /mobile/servers | /mobile/alerts | /mobile/approvals
POST /mobile/servers/{id}/start|stop|restart
POST /mobile/servers            # 新增服务器
DELETE /mobile/servers/{id}
POST /mobile/alerts/read-all
POST /mobile/approvals/{id}/respond  {"approved": true|false}
GET  /mobile/events             # WebSocket，?token= 鉴权，推送快照更新
```

传输层测试：`npm run test:pairing`（桌面端仓库根目录）。

## 技术栈

Flutter + Dart + Riverpod + go_router + Dio + flutter_secure_storage。

## 开发

本项目使用工作区内的 Flutter Stable SDK：

```bash
../../tools/flutter/bin/flutter pub get
../../tools/flutter/bin/flutter analyze
../../tools/flutter/bin/flutter test
../../tools/flutter/bin/flutter run
```

如果 VS Code 打开的是 `MCPWindow` 根目录，`.vscode/settings.json` 已配置：

```text
../../tools/flutter
```

为当前项目的 Flutter SDK 路径。

## 本机工具链

当前工作区还提供以下本地工具：

```text
../../tools/jdk-17/Contents/Home       # Java 17
../../tools/android-sdk                # Android SDK 36（无模拟器镜像）
../../tools/ruby-3.4                   # Ruby 3.4
../../tools/cocoapods                  # CocoaPods 1.16.2
../../tools/Xcode.app                  # 指向 /Applications/Xcode.app
```

Android 调试包构建命令：

```bash
export JAVA_HOME=/Users/sim/Documents/MCPServer/tools/jdk-17/Contents/Home
export ANDROID_HOME=/Users/sim/Documents/MCPServer/tools/android-sdk
export ANDROID_SDK_ROOT="$ANDROID_HOME"
../../tools/flutter/bin/flutter build apk --debug
```

iOS 模拟器构建与运行（无签名，Xcode 27.2 已验证）：

```bash
../../tools/flutter/bin/flutter build ios --debug --simulator
xcrun simctl install <模拟器 UDID> build/ios/iphonesimulator/Runner.app
xcrun simctl launch <模拟器 UDID> top.terrafin.mcpwindowMobile
```

为节省本机存储，Android 模拟器（`mcpwindow_pixel` AVD 与系统镜像）已删除，
Android 真机/模拟器测试改在其他机器进行；本机仅保留 `mcpwindow-iphone` 一个
iOS 模拟器。Xcode 27.2 已激活，`tools/Xcode.app` 是指向 `/Applications/Xcode.app`
的路径入口。Android 调试包构建、iOS 无签名构建和 iOS 模拟器实际安装启动均已验证通过。

2026-11-07 完成移动端 ↔ 桌面端配对服务真实联调（iOS 模拟器，见
`scripts/e2e-mobile-pairing.mjs` 驱动）：移动端扫码/粘贴配对信息连接桌面端后，
总览与服务器列表展示桌面端真实快照；详情页远程启动/停止经配对 API
（`POST /mobile/servers/{id}/start|stop`）转发到桌面端，真实拉起/终止 stdio
服务器进程并回同步状态。联调中发现并修复：设置页保存配对信息后数据源不切换
（`PairingConfigController.reload` 未写回状态）、详情页持有旧快照服务器 id
导致远程操作静默失败（现优先取控制器最新数据，操作失败弹 SnackBar 提示桌面端
错误信息）。iOS 端需 `NSAppTransportSecurity/NSAllowsArbitraryLoads` 以允许
局域网明文 HTTP（`ios/Runner/Info.plist` 已配置）。

## 目录

```text
lib/
├── core/       # 主题、中英双语文案
├── data/       # 配对 API 客户端、配对/模拟仓库、mcp.json 与配对链接解析
├── models/     # 服务器、总览、告警、审批模型
├── state/      # Riverpod 状态控制（按配对配置切换数据源）
├── features/   # 总览 / 服务器 / 告警 / 审批 / 添加 / 设置
└── widgets/    # 状态标签、指标卡片、空状态
```
