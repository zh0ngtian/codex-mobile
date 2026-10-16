# 新版非原生界面接入计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已确认的移动网页设计接到现有真实功能，默认仍使用旧版，用户可在设置中即时切换并保存选择。

**Architecture:** 复用 App、BackendWorkspace、ThreadListPage、ConversationPage 现有状态与业务回调，仅增加展示分支和有作用域的样式。偏好 Provider 放在 NativeSwitchBoundary 恢复检查点之后，不以模式为 key 重建工作区；iOS 原生界面设置保持独立。原型数据、模拟键盘和设备外框不进入生产。

**Tech Stack:** React 19、TypeScript、现有 Vite/Vitest、现有 WebView 键盘桥、发布协调器。

---

## 已确定的边界

- 用户明确选择：默认旧版，手动开启新版试用。
- 最新设计源：`/Users/zhongtian/.codex/visualizations/2026/10/15/01a13e63-7708-7150-8eeb-6712c74ff479/codex-mobile-preview/src/Prototype.tsx` 和 `src/prototype.css`。
- 保留当前真实功能语义：全部设备按关注/最近显示，单设备按关注/项目显示；不新建跨设备项目数据模型。保存草稿继续适用于新对话，将入口移入该页面的更多菜单，不增加续聊草稿存储协议。
- 时间余量按所展示套餐窗口到重置时刻的剩余时间比例换算；缺少真实数据时显示暂无数据。
- 新版不显示语音按钮、项目右侧编辑图标、顶部菜单管理设备和设置中的应用更新条目。版本放设置底部；现有更新逻辑和旧版入口保留。
- 使用真实输入框和系统键盘，保留附件、排队、停止、审批、历史编辑、分页、回退和原生菜单桥。
- 验证使用浏览器及自动化测试；不进行真机操作。

## Task 1：独立且可恢复的新版偏好

**Files:** 新建 `src/features/web-ui/preference.tsx`、`tests/ui/web-interface-preference.test.tsx`；修改 `src/App.tsx`、`src/features/backends/BackendManagerSheet.tsx`、`src/native-ui/switch-context.tsx`。

- [ ] 先写行为测试：空存储或损坏值默认 legacy；开启/关闭正确持久化；切换不重挂载子组件且保留输入；存储写入失败明确反馈并保留先前模式；非 iOS 也能在设置找到开关。

```tsx
expect(readWebInterfacePreference(storage)).toBe(false);
// 在同一个 Provider 内输入草稿，点击“使用新版界面”，再断言草稿仍在且挂载次数未增加。
expect(storage.getItem(WEB_INTERFACE_KEY)).toBe('modern');
```

- [ ] 执行 `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ui/web-interface-preference.test.tsx`，确认缺少偏好模块/行为导致失败。
- [ ] 增加默认 legacy 的 context，只有持久化成功才提交模式。Provider 设置 `document.documentElement.dataset.webInterface`，卸载恢复；原生运行模式不应用现代 CSS。App 在检查点恢复后包裹 Provider，新增键加入原生检查点白名单。

```tsx
<NativeSwitchBoundary initialRegistry={initialRegistry}>
  {registry => <WebInterfaceProvider><RestoredAppBootstrap initialRegistry={registry} /></WebInterfaceProvider>}
</NativeSwitchBoundary>
```

- [ ] 旧设置和新设置共用可访问开关组件；不 reload、不更换工作区 key。
- [ ] 跑新增测试、`tests/ui/native-ui-switch-app.test.tsx` 和 typecheck；分别完成规范审查、质量审查后提交。

## Task 2：侧栏和全局设置

**Files:** 修改 `src/features/threads/ThreadListPage.tsx`、`src/features/backends/BackendManagerSheet.tsx`、`src/App.tsx`；新建 `src/features/web-ui/modern.css`，按需拆分展示组件；扩展 `tests/ui/thread-list-page.test.tsx`、`tests/ui/backend-components.test.tsx`。

- [ ] 先测试新版顶部设备选择只调用列表筛选，草稿/设置/刷新接真实回调，关闭侧栏有入口，顶部搜索使用原 query；开启新版后设置仍能关闭新版。

```tsx
fireEvent.click(screen.getByRole('button', { name: '搜索会话' }));
fireEvent.change(screen.getByRole('searchbox'), { target: { value: '任务' } });
expect(onQueryChange).toHaveBeenCalledWith('任务');
```

- [ ] 运行新增定向测试，确认控件或回调缺失导致失败。
- [ ] 新版侧栏铺满宽度；头部圆按钮、Codex/设备菜单与搜索，正文白底大间距文件夹行，底部新对话胶囊。现有长按、加载、分页、未读、折叠和单/多设备分组逻辑共用；传 `onCloseSidebar={closeSidebar}`。
- [ ] 新版设置使用分组导航：应用（语言、字号、Web 界面、iOS 原生开关）、连接（设备、传输）、通知。复用现有表单与方法；设备新增/编辑/扫码不丢失；版本页脚来自真实 appUpdate。
- [ ] CSS 全部限定 `[data-web-interface="modern"]`；根安全区、键盘变量与侧滑结构保留。主入口导入样式，无设备外框或固定原型尺寸。
- [ ] 跑相关 UI/侧滑/项目分页测试及 typecheck；规范审查通过后做质量审查，修复并提交。

## Task 3：对话头部、用量、输入区和选择器

**Files:** 修改 `src/features/conversation/ConversationPage.tsx`、`ConversationControls.tsx`、`src/features/settings/ComposerSettings.tsx`、`src/App.tsx`、`src/features/web-ui/modern.css`；按需新建展示组件；扩展对应 `tests/ui` 用例。

- [ ] 先测试：菜单保存新对话草稿连接现有回调；context 环展示实际 used ratio；套餐/时间剩余分行，未知数据不伪造；速度/权限选择后恢复原输入焦点和选择；模型/强度两个列表；发送/排队/停止及历史编辑保持原行为。

```ts
const remaining = Math.max(0, Math.min(100, (resetsAt - nowSeconds) / (windowDurationMins * 60) * 100));
expect(remaining).toBe(50); // 测试使用固定时间与真实结构的窗口。
```

- [ ] 运行新增定向测试，记录预期失败。
- [ ] 头部右侧 context → 新建 → 更多；环形灰底黑弧不显示旁边数值，展开三行明细。旧 helper 被原生投影使用，因此保留原语义，另加时间计算。
- [ ] 新版用户气泡软粉色，assistant 正文平铺；保留 Markdown、媒体、工具详情、复制/编辑菜单和滚动节点。
- [ ] 同一个受控 textarea 支持收起和多行展开，工具顺序为加号、权限、闪电、模型+强度文字、发送/停止。模型文字无下拉箭头且靠左；保留 `.composer-wrap` 和 ResizeObserver；不导入模拟键盘。
- [ ] 保存草稿仅在支持的新对话更多菜单中出现，禁用条件沿用原实现；已有会话原菜单动作全部保留。
- [ ] 跑用量、分页、滚动、输入、附件、菜单、模型设置回归及 typecheck；完成规范和质量独立审查后提交。

## Task 4：视觉验收与协调发布

**Files:** 更新 `README.md`、`release/notes.md`；证据放仓库外 `~/Library/Application Support/CodexMobile/validation/web-preview-redesign-20261016/`。

- [ ] 使用可控网关 fixture/真实 App 页面检查：旧版默认、开关、侧栏、长会话、多行输入、键盘/弹层、设置、新旧往返状态保留。截图比对设计，修复可见差异。
- [ ] 跑 `npm run typecheck`、相关 UI 集、`npm test -- tests/ci` 与发布适配器/恢复 Python 回归，保存命令、退出码和日志；已有基线问题单独记录。
- [ ] 更新使用入口及中文版本说明；`git diff --check`、按提交规范提交并 push 当前分支。
- [ ] 写入实际验证 JSON（`adapter-regression`、`coordinator-recovery`、`build-contract`、`typecheck`），给任务 `web-preview-redesign-20261016` ready 已推送 SHA。
- [ ] 等待协调批次成功 receipt，核对 GitHub 双端、固定 LAN APK/签名 IPA、OTA、unsigned 软件源版本。不单独分配版本或手工发布。
- [ ] 最终回复开关位置、验证范围、版本与 OTA/APK/IPA 链接、两包大小和 SHA-256，注明 IPA 已签名。
