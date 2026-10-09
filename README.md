# Codex Mobile

[![Build Mobile Apps](https://github.com/loock-ai/codex-mobile/actions/workflows/build-android.yml/badge.svg)](https://github.com/loock-ai/codex-mobile/actions/workflows/build-android.yml)
[![npm](https://img.shields.io/npm/v/codex-mobile)](https://www.npmjs.com/package/codex-mobile)
[![GitHub Release](https://img.shields.io/github/v/release/loock-ai/codex-mobile)](https://github.com/loock-ai/codex-mobile/releases/latest)
[![Apache-2.0](https://img.shields.io/github/license/loock-ai/codex-mobile)](LICENSE)
![平台](https://img.shields.io/badge/platform-Web%20%7C%20Android%20%7C%20iOS-111111)

**在手机上查看、继续和管理运行在 Mac 上的真实 Codex 工作流。**

Codex Mobile 是一个移动优先的 Codex Remote 客户端。它通过轻量网关直接连接官方
Codex `app-server` V2，复用真实会话、项目、工具调用和审批，并可在一个客户端中
同时管理多台 Mac。

[快速开始](#快速开始) · [核心能力](#核心能力) · [系统架构](#系统架构) ·
[移动端构建](#移动端构建) · [已知边界](#已知边界)

> Codex Mobile 是独立开源项目，与 OpenAI 官方没有隶属关系。

## 界面预览

| 会话列表 | 对话详情 | 设备设置 |
| --- | --- | --- |
| ![会话列表](docs/assets/mobile-reference/remote-thread-list.jpg) | ![对话详情](docs/assets/mobile-reference/conversation-detail.jpg) | ![设备设置](docs/assets/mobile-reference/e2e-mobile-settings-final.png) |

## 快速开始

### 1. 安装网关

要求 Node.js 20.9 或更高版本，并确保本机已有可用的 `codex` CLI。

```bash
npm install -g codex-mobile
```

只在当前电脑访问：

```bash
codex-mobile start
```

默认打开 [http://127.0.0.1:18766](http://127.0.0.1:18766)。

### 2. 允许手机通过局域网连接

非回环监听必须配置访问口令：

```bash
HOST=0.0.0.0 \
CODEX_MOBILE_TOKEN='<随机口令>' \
codex-mobile start
```

在另一个终端显示连接地址和二维码：

```bash
codex-mobile auth
```

手机扫码后即可打开：

```text
http://<电脑局域网IP>:18766/?token=<随机口令>
```

纯文本脚本可使用 `codex-mobile auth --plain`。最近一次成功启动的实际端口和访问口令
保存在 `~/.codex-mobile/runtime.json`，文件权限为 `0600`。

### 3. 添加更多设备

在另一台 Mac 上用不同口令启动网关，然后在 Codex Mobile 的设备管理中输入其完整
地址。客户端会检查 `/api/host` 的 HTTP 轮询能力，通过 HTTP `initialize` 验证上游后保存
设备。

一个客户端最多保存 8 台设备，并可同时维持所有已启用设备的连接。

## 为什么做这个项目

Codex Desktop 很适合坐在电脑前完成开发任务，但长任务启动后，用户仍可能需要在
手机上：

- 查看进行状态和最终结果；
- 处理命令、文件修改和补充信息审批；
- 继续已有会话或快速发起新任务；
- 在 MacBook、Mac mini 等多台开发机器之间切换。

本项目不是把终端页面缩小后塞进 WebView，也不维护一套模拟 Codex 的聊天协议。
前端针对手机重新设计，业务数据仍来自真实的 Codex `app-server`。

## 核心能力

| 能力 | 说明 |
| --- | --- |
| 多设备 | 添加、测试、启停和切换多个网关；汇总各机器的连接与待审批状态 |
| 会话组织 | 全部机器时间流、单机项目分组、搜索、折叠、置顶、未读、重命名和归档 |
| 长会话 | 即时进入详情、骨架屏、错误重试、turns 分页和滚动位置保持 |
| 执行状态 | HTTP 拉取消息、reasoning、工具调用、执行计划和文件变更；可停止运行中的 turn |
| 模型与权限 | 从 app-server 读取模型、推理强度、服务档位、权限和审批策略 |
| Skill 调用 | 输入 `@` 搜索当前项目已安装的 Skill，选择后随消息直接调用 |
| 审批 | 支持命令、文件修改、附加权限和 `requestUserInput` |
| 文件与媒体 | Markdown/GFM、Mermaid 图表及源码查看/复制、图片与文件输入、当前位置、远程图片、远程文本、Markdown/HTML 预览和文件 Diff |
| 前后台恢复 | 后台暂停轮询，回到前台或网络恢复时立即同步；离线保留内容并显示同步状态 |
| 多端复用 | 同一套前端运行于 Web、Android 和 iOS，不在 App 中固化后端地址 |

### 移动端交互

- 会话列表以侧边栏组织，标题与机器切换栏联合吸顶。
- “全部”视图按时间汇总多台机器；单机视图按本机项目目录分组。
- 项目目录先展示，会话并发加载、独立渲染和独立重试。
- 首屏只加载最近 10 个 turns，滚动到顶部继续加载旧历史。
- 工具、审批、文件、Diff 和状态信息使用适合触控的底部 Sheet 展示。
- 运行状态只显示在具体会话上，不把机器连接状态与任务运行状态混在一起。

## 系统架构

```mermaid
flowchart LR
    C["手机浏览器 / Android / iOS"]
    C -->|HTTP 提交与轮询；语音按需 WebSocket| G1["MacBook 网关"]
    C -->|HTTP 提交与轮询；语音按需 WebSocket| G2["Mac mini 网关"]
    G1 -->|V2 JSON-RPC 透传| A1["Codex app-server"]
    G2 -->|V2 JSON-RPC 透传| A2["Codex app-server"]
    A1 --> R1["本机会话与运行时"]
    A2 --> R2["本机会话与运行时"]
```

每台 Mac 运行自己的网关和 app-server，设备之间不互相代理。网关负责：

- 提供静态前端，也可关闭静态资源进入 gateway-only 模式；
- 校验局域网访问口令；
- 提供 `/api/host`、`/api/status` 和 `/api/projects` 控制面；
- 为 HTTP 客户端持有回环地址上的 app-server 会话连接，缓存有界执行状态和待审批；
- 对写请求持久去重，并提供 `/api/rpc`、`/api/events` 和 `/api/operations`；
- 实时语音通过按需 `/api/realtime` WebSocket 共享同一会话；保留 `/ws` 兼容旧客户端；
- 在 Managed 模式下启动和管理 app-server 生命周期。

会话历史仍以 app-server 为准，网关不建立第二套历史数据库。写操作记录保存在
`$CODEX_HOME/codex-mobile-http`（默认 `~/.codex/codex-mobile-http`），用于防止弱网
重试重复执行；网关重启后，无法确认的操作不会自动重放。遇到“请求结果待确认”时先检查
会话，相同内容重试沿用原操作 ID，勿修改内容后反复发送。

文字交互不需要手机常驻 WebSocket：前台执行中每 3 秒拉取，空闲每 15 秒拉取；网络失败
退避至最长 30 秒，回前台或网络恢复立即同步。页面显示真实工具活动、执行计划（若上游
提供）、等待审批及最近同步状态，不估算进度百分比。只有明确标记为 final answer 的
回复完成后才发送通知并更新未读状态；后台暂停时会在恢复同步后产生，启动或重连的
首轮历史同步不会补发旧通知或重设未读。新版客户端要求网关支持 `httpPolling`，旧网关
需先升级。

## 运行模式

### Managed（默认）

网关自动启动并管理一个仅监听回环地址的 app-server：

```bash
CODEX_APP_SERVER_MODE=managed \
CODEX_APP_SERVER_PORT=18765 \
codex-mobile start
```

原始 app-server 不应监听局域网地址，只有网关对外提供服务。

### External

连接已经运行的 app-server，网关不管理其生命周期：

```bash
CODEX_APP_SERVER_MODE=external \
CODEX_APP_SERVER_URL=ws://127.0.0.1:18765 \
codex-mobile start
```

### Gateway-only

移动 App 已内置前端时，后端可以只提供 HTTP 接口和按需语音通道：

```bash
CODEX_MOBILE_SERVE_STATIC=false codex-mobile start
```

此时网关根路径返回 `404`，`/api/*` 和 `/ws` 仍可使用。

## 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 网关监听地址；局域网访问使用 `0.0.0.0` |
| `PORT` | `18766` | 网关端口，也可通过 `start --port` 指定 |
| `CODEX_MOBILE_TOKEN` | 空 | 访问口令；非回环监听时必填 |
| `CODEX_MOBILE_HOST_ID` | 自动生成 | 稳定的设备标识 |
| `CODEX_MOBILE_HOST_NAME` | 主机名 | 客户端展示的设备名称 |
| `CODEX_MOBILE_UPLOAD_DIR` | `~/.codex/codex-mobile-uploads` | 图片以外附件的上传目录 |
| `CODEX_MOBILE_SERVE_STATIC` | `true` | 设为 `false` 启用 gateway-only |
| `CODEX_APP_SERVER_MODE` | `managed` | `managed` 或 `external` |
| `CODEX_APP_SERVER_PORT` | `18765` | Managed app-server 回环端口 |
| `CODEX_APP_SERVER_URL` | `ws://127.0.0.1:18765` | External 模式的上游地址 |
| `CODEX_HOME` | `~/.codex` | Codex 状态目录 |

内置 App 可能发送 `Origin: null` 或其他本地页面 Origin。网关允许跨来源访问控制面，
但 HTTP API 和 WebSocket 始终需要正确 Token。

## 从源码开发

```bash
git clone https://github.com/loock-ai/codex-mobile.git
cd codex-mobile
npm install
npm run dev
```

开发模式同时运行：

- Vite：`http://0.0.0.0:5173`，提供前端和 HMR；
- 网关：`http://0.0.0.0:18766`；
- Managed app-server：`ws://127.0.0.1:18765`。

`npm run dev` 默认读取：

```text
~/Library/Application Support/CodexMobileWeb/gateway.env
```

示例配置：

```bash
export HOST='0.0.0.0'
export PORT='18766'
export CODEX_APP_SERVER_MODE='managed'
export CODEX_APP_SERVER_PORT='18765'
export CODEX_MOBILE_HOST_ID='macbook-pro'
export CODEX_MOBILE_HOST_NAME='MacBook Pro'
export CODEX_MOBILE_SERVE_STATIC='false'
export CODEX_MOBILE_TOKEN='<独立口令>'
```

### 验证

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

## 移动端构建

[最新 GitHub Release](https://github.com/loock-ai/codex-mobile/releases/latest) 提供：

- Android APK 及 SHA-256 校验文件；
- 未签名 iOS IPA 及 SHA-256 校验文件。

Android App 固定检查局域网更新清单
`http://192.168.123.79:8765/channels/codex-mobile/latest.json`，发现新版本后从固定地址
`http://192.168.123.79:8765/channels/codex-mobile/latest.apk` 下载，经 SHA-256 校验成功后
调起系统安装器。手机必须与更新服务器处于同一局域网；首次使用需要在 Android 系统中
允许 Codex Mobile 安装未知应用，App 不支持静默安装。

iOS IPA 未签名，安装到真实设备或上传 TestFlight 前仍需使用 Apple Developer 证书
签名。

仓库使用固定提交的 PakePlus Android/iOS 项目作为原生容器，并把当前 `dist/` 静态
资源内置到 App。构建产物只包含上述固定更新服务器地址，不包含网关 Token 或其他私人配置。

发布流程：

- `main` 的应用相关代码变化会触发 Android、iOS 构建和 GitHub Release；
- npm 包只在网关、CLI 或包配置变化时随同发布，也可在手动工作流中显式启用；
- Android、iOS 与同次发布的 npm 包共用一个解析后的版本号。
- 仓库修改提交并推送后，还须在更新服务器所在 Mac 构建更高版本 APK，通过
  `apk-server.py publish-channel codex-mobile` 覆盖固定局域网渠道并回验摘要。

相关工作流：

- [build-android.yml](.github/workflows/build-android.yml)
- [build-ios.yml](.github/workflows/build-ios.yml)
- [publish-npm.yml](.github/workflows/publish-npm.yml)

### 本地 iOS 与模拟器

```bash
npm ci
npm run ios:prepare -- --version 0.2.91
open .mobile-build/ios/pakeplus/PakePlus.xcodeproj
```

选择 `PakePlus` scheme 和 iPhone 模拟器运行。工程内置当前前端，并复用发布流水线的
固定容器配置与原生补丁；生成目录会在下次准备成功后替换。原生容器支持键盘避让，
App 原生版本号与前端发布版本保持一致。

[本地构建、XCTest 流程与模拟器验证结果](docs/ios-simulator-verification.md)。

## 项目结构

```text
codex-mobile/
├── bin/                  # npm CLI、访问地址和终端二维码
├── src/
│   ├── app-server/       # V2 客户端、会话恢复、分页与列表加载
│   ├── backends/         # 多设备注册表、探测和连接管理
│   ├── features/         # 会话、列表、审批、设置和设备管理 UI
│   └── ui/               # 消息、附件、图标和展示辅助逻辑
├── server/               # HTTP 会话网关、进程管理和项目目录读取
├── tests/                # 协议、服务端、UI、CI 和移动端 E2E 测试
├── protocol/             # app-server V2 协议基准与生成物
├── docs/plans/           # 设计与实施记录
└── .github/workflows/    # 移动端和 npm 发布流水线
```

协议基准见
[`protocol/app-server-v2/README.md`](protocol/app-server-v2/README.md)，总体设计见
[`docs/plans/2026-07-26-codex-mobile-web-design.md`](docs/plans/2026-07-26-codex-mobile-web-design.md)。

## 安全与仓库边界

- 非回环监听必须配置 Token；当前 Token 方案适用于可信局域网。
- 跨不可信网络使用时，应增加 HTTPS、可信反向代理和正式身份认证。
- 公开仓库和正式构建产物不包含局域网地址、访问口令、Codex 登录态、API 密钥、
  本机会话、用户项目内容或移动端签名材料。
- App 中保存的设备地址和 Token 位于客户端本地存储，不会提交到本仓库。

## 会话图片加载

- 同一已完成回合包含多张查看图片时，默认折叠为“过程截图”，点击后展开；单张图片、生成图片和正式回复中的图片仍正常显示。
- 本地图片进入可见区域后加载最长边 640 px 的等比缩略图，点击预览时读取完整原图。网关和客户端均限制缓存大小，客户端在同一设备连接中复用图片 60 秒，失效图片短缓存 15 秒。
- 新客户端连接旧网关时会回退到原有文件读取；缩略图优化需要同时升级网关。图片接口与其他文件读取使用同一访问口令。

## 回合代码改动统计

- 手机发起的 Git 回合在开始前捕获工作目录树，结束时比较净增删行数；命令写文件、新文件和结束前已提交的改动也能统计。捕获使用独立临时 index，不更改用户 index 或工作目录。
- 网关将统计保存在 Codex 数据目录的 `codex-mobile-turn-changes/`，重新打开会话和网关重启后继续读取。完整实时 diff 在网关缩减消息前计算并保存。
- 旧回合缺少文件补丁时，仅采用成功工具输出中明确的 Git commit 记录恢复，校验提交时间属于该回合；多个提交需要连续父提交链并按净差异统计。无法可靠恢复时显示“代码改动统计不可用”，不显示虚假的 0 行。
- 外部桌面回合的开始通知到达时可能已经修改文件，因此该通知之后捕获的基线不作为精确统计；仍可使用完整 diff 或明确的提交记录。并发修改同一目录也会影响工作目录净差异；该数字不是对每个编辑动作的归因。
- 非 Git 目录或超出捕获容量（5,000 个候选路径、单文件 16 MiB、总计 64 MiB）不使用快照，可用的完整 diff 或提交证据继续生效。统计恢复需要同步升级设备网关。

## 已知边界

- 会话置顶保存在当前设备本地，不同步至 Codex app-server 或其他设备；分页等能力以实际运行的 CLI 版本为准。
- 大型会话的 `thread/read(includeTurns:true)` 响应可能很大，正常路径优先使用
  `thread/resume` 初始分页和 `thread/turns/list`。
- app-server 的持久化 `ThreadItem` 可能是有损表示，前端也会合并逻辑回合。
- 不同 app-server 进程之间没有全局实时状态。Codex Desktop 与本项目使用独立进程
  时，网页无法仅靠 V2 列表接口准确显示桌面进程正在执行的任务。
- iOS 自动化产物未签名；正式分发不在无证书构建范围内。

## 许可证

本项目使用 [Apache License 2.0](LICENSE)。
