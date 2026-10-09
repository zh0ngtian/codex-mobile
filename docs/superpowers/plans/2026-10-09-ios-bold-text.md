# iOS 系统粗体文本实施计划

> 执行方式：在当前会话按 superpowers:executing-plans 与 test-driven-development 逐项执行。

**目标：** iOS 主界面跟随系统“粗体文本”，冷启动、页面重新加载及从系统设置返回时都使用最新字重。

**架构：** 原生容器通过 UIAccessibility.isBoldTextEnabled 读取当前设置，注入根节点 data-ios-bold-text 属性；通过粗体设置通知、进入前台通知和导航完成同步状态。CSS 用统一的字重增量保留正文、按钮、标题、Markdown 和代码文字层级；关闭时恢复现有字重。当前已有其他未提交修改，本次只提交字体相关文件，安装包从本次提交的独立快照构建。

**技术：** Swift / UIKit、WKUserScript、CSS 自定义属性、Playwright、Vitest、Xcode、Gradle。

## 任务一：先验证缺失行为

- [x] 新建 `tests/e2e/ios-bold-text.spec.ts`，读取真实 `src/styles.css`，渲染正文、strong、输入框、按钮和工具标题，设置 `data-ios-bold-text` 后断言字重增加，关闭后断言恢复；重复切换不得累加。
- [x] 运行 `npx playwright test --config tests/e2e/styles.config.ts`，确认失败来自字重没有响应。
- [x] 在 `tests/ci/ios-local-build.test.ts` 增加原生生成契约断言：启动注入、粗体文本状态通知、前台通知和导航完成同步。

## 任务二：实现和验证

- [x] 修改 `src/styles.css`：根节点 `--bold-text-weight-offset: 0`，`html[data-ios-bold-text="true"]` 设置为 `200`；原有数值字重使用 `min(900, calc(<原字重> + var(--bold-text-weight-offset)))`，正文基准为 400，语义加粗基准为 700。
- [x] 修改 `.github/workflows/build-ios.yml` 的硬化脚本：安装 `WKUserScript`，注册 `UIAccessibility.boldTextStatusDidChangeNotification` 与 `UIApplication.didBecomeActiveNotification`，每次 `didFinish` 重新读取设置并同步根节点。观察者使用 selector，WebView 使用现有弱引用。
- [x] 运行上述 Playwright 和 iOS CI 测试、`npm run typecheck` 与 `git diff --check`。
- [x] 使用 `npm run ios:prepare -- --version <新版本>` 及 `xcodebuild` 编译 iOS，模拟器开关粗体文本并检查截图。

## 任务三：提交和固定渠道交付

- [ ] 遵守 `docs/commit-conventions.md`，仅暂存本次计划、CSS、iOS 工作流与测试，提交并推送。
- [ ] 从已推送提交导出独立源码快照；选择高于两个固定渠道当前版本的版本号，构建未签名 IPA 与 APK。
- [ ] 执行 `/Users/zhongtian/WorkSpace/GlobalTranslation/scripts/apk-server.py publish-channel codex-mobile <安装包> --version <新版本> --notes 'iOS 支持系统粗体文本设置'`。
- [ ] 对 Android 与 iOS 固定 JSON、HEAD、完整 GET 验证版本、大小和 SHA-256，交付两个固定链接及签名状态；删除本次无用临时文件。

## 验证结果

- Playwright 实际渲染回归先出现字重未变化的失败，实现后通过；独立 `tests/e2e/styles.config.ts` 避免依赖网关进程。
- `npx vitest run tests/ci`：16 项通过；`npm run typecheck`、`git diff --check` 通过。
- XcodeBuildMCP 在 iPhone 17 Pro / iOS 26.5 成功编译、安装并启动；通过真实系统设置界面开启和关闭粗体文本，核对前台恢复、开启时冷启动和关闭后的字体恢复。验证图片保存在本机 `.mobile-build/ios-bold-text-evidence/`。
- 设置读取使用 Apple 官方 `UIAccessibility.isBoldTextEnabled`，监听 `boldTextStatusDidChangeNotification`。
- 两个平台使用 0.2.94；提交、推送、固定渠道发布和下载摘要核验属于提交后的交付动作。
