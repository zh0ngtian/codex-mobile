# iOS 附件直接选择实施计划

> **For agentic workers:** 使用 superpowers:executing-plans 在当前会话逐项执行；不委派共享工程和发布状态。

**Goal:** iOS 点图片直接进入相册、点文件直接进入文件选择器，取消后可重新选择，多选附件进入原有处理流程；Android 保持原行为。

**Architecture:** 新增仅在 iOS 主 WebView 安装的 `AttachmentPickerBridge.swift`。在原生注入脚本中捕获 `.attachment-picker input[type=file]` 的 click，按 accept 分流到 PHPickerViewController / UIDocumentPickerViewController。选中文件转换为 FileList 并触发原 input 的 change，继续复用已有 onSelectImages，不修改共享前端或 Android。

**Tech Stack:** Swift、PhotosUI、UniformTypeIdentifiers、WKUserScript、Vitest、XCTest。

---

### 任务 1：建立失败回归

文件：`tests/ci/ios-attachment-picker.test.ts`、`mobile/ios/CodexMobileUITests.swift`。

- [x] 测试原生注入脚本将图片与文件点击分流，阻止默认菜单；其他文件上传控件不拦截。
- [x] 测试取消不触发 change、重新选择仍可用，多文件的名称、MIME、字节和顺序完整回传，失效请求不污染新输入。
- [x] 运行 `npm test -- tests/ci/ios-attachment-picker.test.ts`，确认因缺少桥实现而失败。
- [x] 添加模拟器测试：打开新聊天，加号→图片后查找 `codex.attachments.photos`，加号→文件后查找 `codex.attachments.files`，并检查不存在照片来源菜单。

### 任务 2：实现原生桥

文件：`mobile/ios/AttachmentPickerBridge.swift`、`.github/workflows/build-ios.yml`。

- [x] 实现 `CodexMobileAttachmentPickerBridge.configure(webView)`，注册独立 script handler，使用 weak WebView，注入捕获脚本。
- [x] 图片使用 `PHPickerConfiguration.filter = .images` 与多选；保留 PNG/JPEG/GIF/WebP 字节，不支持的相册格式转换 JPEG。
- [x] 文件使用 `UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)`，保留多选、名称、MIME 和原始字节。
- [x] 用户取消、读取失败、模态关闭都完成请求；旧页面结果被请求 ID 和 isConnected 检查丢弃。
- [x] 流水线安装新 Swift 文件，并在 WebView 构造后执行 configure；外部网页容器不安装桥。
- [x] 运行 `npm test -- tests/ci/ios-attachment-picker.test.ts tests/ci/ios-local-build.test.ts tests/ci/mobile-packaging-workflows.test.ts tests/ui/attachments.test.ts`，预期全部通过。

### 任务 3：原生验证与交付

- [ ] `npm run ios:prepare -- --version 0.2.117` 准备独立工程；XcodeBuildMCP 编译到已启动 iPhone 17 Pro，XCTest 验证两个原生入口及取消后重新选择。
- [ ] `npm run build`、`git diff --check`；确认共享前端、Android 源码和 Android 流水线 diff 为空。
- [ ] 按中文 Conventional Commits 提交本次文件，普通推送到 origin/main；保留原工作目录其他未提交修改。
- [ ] 推送后重新读取两端渠道，选高于双方的统一版本，执行固定流水线构建 APK 和未签名 IPA。
- [ ] 使用 `apk-server.py publish-channel codex-mobile` 发布两个包；通过独立 JSON、HEAD、完整 GET 核对版本、大小和 SHA-256。
- [ ] 回复两个固定下载地址、版本、大小、SHA-256 与 IPA 签名状态；清除本次无用临时文件。

## 已完成验证

- 36 项附件与构建回归通过，TypeScript / Vite 构建通过。
- iOS 26.5 专用模拟器完成图片→取消、文件→取消、再次图片→取消和实际选图回传验证；选中的图片进入待发送附件区并可移除。
- 本次测试未发送对话消息，没有生成需要归档的服务端测试会话。
- 共享前端、Android 原生源码和 Android 流水线均无本次变更。
