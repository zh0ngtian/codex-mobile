# 页面横向移动修复实施计划

> **执行要求：** 使用 superpowers:executing-plans 与 TDD；复用独立工作树，完成提交推送及双端固定渠道交付。

**目标：** 修正“左右滑动”的范围，让整个 App 页面不在水平方向滚动或回弹，保留纵向滚动、文本操作、自动聚焦和内容局部滚动。

**架构：** 在页面根节点阻断横向溢出及滚动链，历史编辑布局使用可收缩 grid 列和换行操作区。iOS 主 WKWebView 禁用外层 UIScrollView 回弹，内层网页继续独立滚动，独立网页浏览器保持原行为。

**技术栈：** React、CSS、Playwright、Swift/WKWebView、PakePlus、Ad Hoc OTA。

## 任务 1：复现与修复
- [x] 浏览器基线后新增 280/320/393px 与特大字号历史编辑回归，检查 document/conversation-scroll 无横向溢出、根横向 overscroll 禁用；先运行看到失败。
- [x] `src/styles.css` 根节点加入 `overflow-x: clip; overscroll-behavior-x: none;`；会话 scroller 显式 `overflow-x: hidden;`；编辑消息容器承接限定宽度，编辑 grid 设置 `grid-template-columns: minmax(0, 1fr)`，textarea `min-width: 0`，操作区 `flex-wrap: wrap`。
- [x] `mobile/ios/build-recipe.yml` 主 WebView 外层滚动设置 `scrollView.bounces = false` 与 `scrollView.alwaysBounceHorizontal = false`，防止原生橡皮筋拖动；纵向滚动仍由内层 conversation-scroll 处理。
- [x] 运行交互回归、相关 Vitest 和前端构建；原生使用独立 WKWebView 模拟器手势探针验证拖动期间的页面横向位置，验证纵向滚动及输入正常。

## 任务 2：交付
- [ ] 中文 Conventional Commits 提交推送 main。
- [ ] 排队获取固定渠道锁，以双端/OTA 当前最高版本加一统一构建；Android 配置驱动构建，iOS 使用现有 ios:release。
- [ ] 上游最新软件源说明预检并上传同一已签名 IPA，保留开发者署名。
- [ ] 固定 APK/IPA JSON、HEAD、完整 GET、HTTPS OTA 与软件源全部核验；保留证据后归档工作树。

## 已完成验证

- 修改前 Chromium / WebKit 在 280px、特大字号下复现会话滚动区横向溢出 19px。
- 修改前 iOS 26.5 模拟器实际左右拖动，网页横向采样 112px、原生外层峰值 150px；修复后两者均为 0，纵向拖动通过。探针使用真实打包 CSS，仅加入 UI 测试工程，不连接网关、不生成测试会话。
- Chromium、WebKit、mobile WebKit 共 3 项 E2E 通过，覆盖窄屏、字号、点击同步聚焦、输入、横向滚轮、纵向滚轮、取消后侧栏恢复；mobile WebKit 的实际手势由 XCUITest 补充。
- 相关 Vitest 74 项通过；前端类型检查与构建通过；UI 测试工程配置重跑保持幂等。
