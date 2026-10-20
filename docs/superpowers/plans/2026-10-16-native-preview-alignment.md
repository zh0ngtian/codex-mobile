# 网页设计稿到原生 iOS 界面的实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development 或 superpowers:executing-plans 按任务执行；步骤使用复选框跟踪。

**Goal:** 将现有可选 SwiftUI 界面对齐用户给定的 codex-mobile-preview 网页设计稿，所有入口继续调用现有业务。

**Architecture:** 沿用 NativeSnapshot/NativeUIStore 和共享 TypeScript 业务桥；本轮只改变原生表现及必要的只读展示元数据。不更换网络、持久化、默认界面、最低系统版本或签名身份。使用 SwiftUI Button、Menu、Form、Toggle、sheet、popover、系统字体和 SF Symbols，不引入第三方 UI 库。

**Tech Stack:** SwiftUI（现有 iOS 18 起支持）、Observation、现有 TypeScript/React 适配器、Vitest、Swift smoke、XCTest、releasectl。

---

## 视觉依据

- `/Users/zhongtian/.codex/visualizations/2026/10/15/01a13e63-7708-7150-8eeb-6712c74ff479/codex-mobile-preview/src/Prototype.tsx`
- 同目录 `src/prototype.css` 与浏览器实际画面；以本轮最新文件为准，不复用旧截图目标。
- 关键状态：对话收起/聚焦、上下文用量、模型与思考强度、权限、速度、侧栏、设备标题菜单、设置及子页、消息和会话长按。
- 系统状态栏、键盘和 home indicator 由 iOS 提供。真实动态名称保留。网页演示数值不写入生产状态。

## 任务一：展示数据与原生界面对齐

**Files:** `mobile/ios/NativeUI/` 中 header、composer、sidebar、settings、group、message、code 相关组件；`src/native-ui/{protocol,workspace-adapter,workspace-panels,adapters}.ts`（只在需要已有数据的展示投影时修改）；`tests/ui/native-ui-workspace.test.ts`、`tests/ci/native-ui-model-smoke.swift`、`mobile/ios/NativeUIUITests.swift`。

- [x] 对照现有组件与设计稿逐项列出差异，保持已有真实功能可达。
- [x] 先写行为回归并执行到预期失败：顶部用量数据来自本轮 context 和已有 rateLimits；模型/强度选择按 contextId 校验；关闭调节面板保留输入；侧栏/设置改动不移除必要业务入口。
- [x] 运行 `npx vitest run tests/ui/native-ui-workspace.test.ts tests/ci/ios-native-ui.test.ts` 保存红灯证据。
- [x] 用原生组件实现：顶部 context 已用圆环与详情；输入底栏为附件、权限、速度、模型+思考强度文字；合并模型/强度为分组面板，权限有图标、说明、选中标记；保留发送/停止/排队、附件、Skill 与工作区入口。
- [x] 侧栏品牌设备标题居中（按最新网页实测），项目末尾不再显示新建图标；设备菜单按设计稿保留设备切换、草稿、刷新、设置；设置分应用/连接/通知并在底部显示真实版本。应用更新现有能力应保持可达，不增加设计稿没有的假设置。
- [x] 核对消息长按、过程二级折叠、代码卡语言/复制与正文排版，修正与设计稿有实质差异的组件。
- [x] 未提供数据不伪造百分比；套餐/时间只显示已有可靠窗口数据及其含义，数值范围钳制；未知保持数据不可用表达。
- [x] 执行相关 Vitest、真实 Swift smoke 与 iOS 编译；规格审查通过后再做质量审查，修复真实问题。

## 任务二：模拟器、视觉验收与发布

**Files:** `design-qa.md`、`README.md`、`docs/native-ui-business-bridge.md`、`release/notes.md` 与本计划。

- [x] 排队独占模拟器；同状态同画布捕获设计稿与原生截图，统一密度并并排比较。
- [x] XCTest 验证新调节面板、用量、设置导航、草稿与大字体布局，保存截图及日志。
- [x] 修复 P0/P1/P2 并复拍，`design-qa.md` 记录五类视觉表面及最终 passed/blocked；不得以编译代替视觉验收。
- [x] 运行 ready 必需 `adapter-regression`、`coordinator-recovery`、`build-contract`、`typecheck`，提交符合中文 Conventional Commits 规范的变更并推送固定 SHA。
- [x] 更新中文用户变化日志；任务 `native-preview-alignment-20261016` 持续 heartbeat；ready 后等待协调批次成功，核对 GitHub APK/unsigned IPA、固定 LAN 双端、已签名 HTTPS OTA 及软件源版本/日志。
- [x] 归档本轮创建的测试会话；交付固定 OTA、APK、IPA 链接及版本/大小/SHA-256，明确模拟器与真机验证边界。

## 交付记录

- 代码提交 `4c3dae37665640189b0adb4fec330a11f3d54716` 已推送并由协调器纳入成功批次 `4d8da967-2996-4f7d-9e0a-cbbe1b5ba8c8`，冻结 `991dde36fe4e8d669f18b6787d67e32f8074ebd1`；版本 `0.2.178` / `2178`。
- GitHub 双端、固定 LAN APK/Ad Hoc 已签名 IPA、HTTPS OTA 及软件源 unsigned 版本/中文日志均核对；另独立对固定双端执行 JSON、HEAD 与完整 GET 大小/散列比对。
- 123文件1279项回归、157项发布适配器、30项协调器恢复、Swift编译/类型检查和8项去重关键原生UI场景通过；视觉验收见根目录 `design-qa.md`。有一次未修改的旧网关30ms异步用例在并发构建时偶发失败，独立16项与最终全套1279项重跑均通过，未扩大到服务端修改。
- 未创建真实远端测试会话；专用模拟器已关闭。未进行真机覆盖安装与数据保留验收。
- 公开交付摘要见 [发布凭证](evidence/2026-10-16-native-preview-alignment-release.json)，权威共同凭证为本机 ReleaseCoordinator receipts 中的同批 JSON。
