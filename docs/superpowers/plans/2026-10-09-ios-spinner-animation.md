# iOS 加载图标旋转修复实施计划

> 按 superpowers:executing-plans 与 superpowers:test-driven-development 在当前会话逐项执行。

**目标：** 修复 iOS 状态转圈静止，覆盖通用加载、设备、分页、会话运行、搜索刷新、流式接收及发送按钮。

**架构：** 修改共享 CSS，普通 i 显式使用 inline-block，所有功能性状态指示器在减少动态效果模式下使用较慢旋转。骨架屏等装饰动画继续停用。使用独立工作树保护键盘相关未提交工作，构建只包含已推送代码。

**技术：** React、CSS、Playwright WebKit/Chromium、Xcode、Gradle。

## 任务一：复现与回归

- [x] 创建 `tests/e2e/ios-spinner.spec.ts` 与 `tests/e2e/spinner.config.ts`，加载真实 CSS，在 WebKit 和 Chromium 下分别验证默认与减少动态效果模式。断言普通行内父元素中的图标宽度为 18px、所有图标 transform 随时间变化、页面像素变化、减少动态效果时骨架屏停用。
- [x] 运行 `npx playwright test --config tests/e2e/spinner.config.ts`，确认失败来自行内元素宽度以及 animation:none。

## 任务二：最小修复

- [x] 在 `src/styles.css` 的 `.action-spinner` 添加 `display: inline-block; flex: 0 0 auto;`。
- [x] 从减少动态效果的 animation:none 规则中移除所有 spinner，保留骨架屏和装饰动画规则。
- [x] 在 spinner 定义后统一添加减少动态效果规则：`.action-spinner, .backend-loading, .project-more .action-spinner, .running-spinner, .sidebar-refresh-spinner, .stream-character-spinner, .send-button-running::before { animation-duration: 1.6s; }`。
- [x] 重跑旋转回归及 `npx playwright test --config tests/e2e/styles.config.ts`，运行 `npm run build` 和 `git diff --check`。

## 任务三：提交与双端发布

- [ ] 阅读 `docs/commit-conventions.md`，只提交本次 CSS、测试与计划；同步远端 main 后推送本次提交。
- [ ] 查询两个固定渠道版本，选择严格高于它们的统一版本；推送后从本次代码构建 APK 与未签名 IPA，核对原生版本和内置 CSS。
- [ ] 使用 `/Users/zhongtian/WorkSpace/GlobalTranslation/scripts/apk-server.py publish-channel codex-mobile <APK或IPA> --version <版本> --notes '修复 iOS 加载图标不旋转；减少动态效果模式保留较慢状态旋转'` 分别发布。
- [ ] 分别核验固定 JSON、HEAD 与完整 GET 的版本、大小、SHA-256，交付固定下载链接及 IPA 签名状态；清理本次无用临时文件。

## 验证结果

- WebKit 与 Chromium 的默认模式先因行内图标宽度仅 4px 失败；减少动态效果模式先因设备转圈 animation:none 失败。
- 修复后四项真实浏览器旋转及像素更新回归通过，系统粗体文本回归通过，24 项相关 CSS 测试通过。
- `npm run build` 与 `git diff --check` 通过；发布动作按上方清单在推送后执行。
