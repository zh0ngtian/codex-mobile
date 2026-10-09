# 叠加页面滑动隔离实施计划

> **For agentic workers:** 使用 superpowers:executing-plans 逐项执行。弹层、侧栏和手势共享状态，由当前 Agent 连续完成。

**Goal:** 叠加页面只有最上层响应滑动，遮罩和内容边界不会滚动底层页面。

**Architecture:** 用共享 Hook 注册打开的侧栏和 ActionSheet，按实际 z-index 和同层 DOM 绘制顺序确定最上层。非 passive 的 touchmove / wheel 监听只允许最上层内部有剩余空间的滚动容器响应，首层打开时锁住文档滚动，末层关闭时恢复原样；侧栏在新弹层出现时取消已有拖动。

**Tech Stack:** React、TypeScript、Vitest、Playwright、PakePlus Android / iOS。

## 1. 失败回归

文件：`tests/ui/action-sheet.test.tsx`、`tests/ui/sidebar-swipe.test.tsx`。

- [x] 增加遮罩、标题、无滚动内容、内容顶部/底部的 touchmove 和 wheel 回归，期望边界事件 `defaultPrevented === true`；内部仍有空间时期望 false。
- [x] 增加双弹层及关闭顺序回归，确保只有最高层可滚动，关闭最高层后恢复下一层，末层关闭后恢复文档 overflow。
- [x] 增加侧栏滑动中打开 ActionSheet 的回归，检查 `dragging` 清除且 onClose 不调用。
- [x] 执行 `npm test -- tests/ui/action-sheet.test.tsx tests/ui/sidebar-swipe.test.tsx`，确认新增回归因缺少隔离机制失败。

## 2. 修复与浏览器验证

文件：新建 `src/ui/overlay-scroll.ts`；修改 `src/ui/ActionSheet.tsx`、`src/features/threads/sidebar-swipe.ts`、`src/styles.css`；新增 `tests/e2e/overlay-scroll.spec.ts` 和对应 fixture / config。

- [x] 实现 `useOverlayScrollIsolation(open, layerRef)`：登记 layerRef.current；栈为空后注销监听并恢复 documentElement / body 的原始 overflow 及优先级。
- [x] 实现最上层选择、最上层内部滚动方向与边界检查；Touch 单指位移以相邻点差值判断，Wheel 使用 deltaX / deltaY；禁止遮罩和低层默认滚动。
- [x] ActionSheet 为遮罩注册独立 ref，并停止触摸、指针、滚轮事件冒泡，保留原有点击关闭和焦点逻辑，焦点恢复使用 preventScroll 防止列表跳动；侧栏使用同一注册 Hook，touchstart / move / end 校验层级，失去顶层资格时清理拖动。
- [x] 遮罩、侧栏背景增加 `overscroll-behavior: none`，保留内部内容滚动样式。
- [x] 执行相关 Vitest、`npm run typecheck`；用 Chromium 实际 wheel / touch 手势检查背景 scrollTop 不变、顶层内容正常滚动、关闭后列表恢复。

## 3. 提交和交付

- [ ] 检查本次 diff；按 `docs/commit-conventions.md` 创建 `fix(弹层): 修复叠加页面滑动穿透`，正文说明新增功能为无及主要修改；只暂存本次文件，提交并推送。
- [ ] 从已推送提交生成独立构建快照，避免混入工作区的键盘改动。
- [ ] 查询两个固定渠道，选择高于两者的统一版本，按仓库现有流水线构建 APK 和未签名 IPA。
- [ ] 用指定 `apk-server.py publish-channel` 发布两包；分别核对 JSON、HEAD、完整 GET 的版本、文件大小与 SHA-256。
- [ ] 删除本次临时源码及构建目录，保留安装包和验证记录；交付双端固定链接、统一版本、大小、SHA-256 及 IPA 签名状态。
