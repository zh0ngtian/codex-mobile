# 对话用量与额度卡片实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**目标：** 将对话页圆圈入口改为参考图式卡片，增加 K/M 格式的会话累计输入、输出 token 消耗与缓存命中率。

**架构：** 复用 App 已有 tokenUsage 和 rateLimits，不增加 RPC 或服务端状态。现役网页新版与 iOS 原生已有弹层，复用既有交互；用量格式化和窗口选择为纯函数，浮层在现有 React 组件树中管理开闭，避免受 header 的 backdrop-filter 或 overflow 裁剪。

**技术栈：** React、TypeScript、CSS、Vitest、Testing Library、现有 iOS 验证与 releasectl。

---

## 任务 1：实现卡片及回归测试

**文件职责：**

- 修改 `src/features/conversation/ConversationControls.tsx`：保留圆圈和菜单，移除旧状态底部弹层；保留现有上下文计算导出供旧调用使用。
- 新增 `src/features/conversation/ConversationUsagePopover.tsx`：卡片、锚定、关闭与焦点恢复，以及卡片的 token/额度纯函数；不引入全局通用浮层框架。
- 修改 `src/features/conversation/ConversationPage.tsx`：圆圈开闭状态、按钮锚点、卡片传值；切换线程关闭浮层。
- 修改 `src/styles.css`：卡片及透明外部关闭区域样式，清理旧状态弹层专用样式。
- 修改 `src/i18n.tsx`：新增中英文文案。
- 修改 `src/features/conversation/ModernConversationControls.tsx` 中现役 ModernContextUsage：复用布局，改用五行共享用量口径。
- 新增 `src/features/conversation/usage-metrics.ts`：共享纯函数、严格缺失校验与 K/M 格式化，供网页和原生投影复用。
- 修改 `src/native-ui/{protocol,workspace-adapter}.ts`、`mobile/ios/NativeUI/NativeSnapshot.swift`：可选 inputTokenUsage/outputTokenUsage 显示字符串、inputCacheHitPercent 与 fiveHourRateLimit；旧快照兼容。
- 修改 `mobile/ios/NativeUI/{NativeUsageDetailsView,NativeContextUsageButton,NativeVisualReference}.swift`：原生五行，切换会话关闭，离线验收数据。
- 修改 `tests/ui/native-ui-workspace.test.ts`、`tests/ci/native-ui-model-smoke.swift`、`mobile/ios/NativeUIUITests.swift`：桥接投影、旧快照解码和真实模拟器交互断言。
- 修改 `release/notes.md`、现有桥接文档：本次用户变化和新增可选展示字段。
- 修改 `tests/ui/conversation-controls.test.tsx` 并按需新增 `tests/ui/conversation-usage-popover.test.tsx`：用真实组件及函数验证用户可见行为。

- [x] 1. 先编写失败测试，验证 7 天、5 小时窗口不混淆；缺失窗口显示暂无数据；null/NaN/负数不当作零；格式化覆盖 950→950、1000→1K、128450→128.5K、999999→1M、3084000→3.1M。

```tsx
expect(formatTokenCount(128_450)).toBe("128.5K");
expect(formatTokenCount(999_999)).toBe("1M");
expect(formatTokenCount(3_084_000)).toBe("3.1M");
```

- [x] 2. 运行 `npm test -- tests/ui/conversation-controls.test.tsx tests/ui/conversation-usage-popover.test.tsx`，确认新增断言因缺少功能失败，并保存日志到仓库外验证目录。
- [x] 3. 实现最小功能。格式化使用十进制 K/M，最多一位小数；输入、输出和缓存值只读取 total，最近上下文继续读取 last。窗口匹配按 `windowDurationMins` 选择 300 与 10080，不能以 primary/secondary 下标猜含义。

```ts
const input = formatTokenCount(tokenUsage?.total?.inputTokens);
const output = formatTokenCount(tokenUsage?.total?.outputTokens);
const tokenText = input ?? t("暂无数据");
```

- [x] 4. 浮层通过触发按钮 `getBoundingClientRect()` 锚定并约束视口边界，优先图标下方右对齐；透明遮罩和卡片独立于 header 的裁剪层。卡片内点击不关闭；外部点击、Escape、重复触发关闭；focus cleanup 恢复焦点。保留按钮现有 aria-label，增加 aria-expanded/aria-haspopup。
- [x] 5. 补充/运行组件行为测试，验证实际五行文本、实时 rerender、缺失数据、关闭和焦点恢复，运行 `npm run typecheck`。确认直接依赖 ConversationPage 的回归测试仍通过。
- [x] 6. 自审 `git diff --check`，依仓库中文 Conventional Commits 规范提交，正文包括「新增功能」「主要修改」。

## 任务 2：独立审查、界面验收与发布

- [x] 1. 子代理依次完成需求符合性与代码质量审查；修复问题并重验本次受影响范围。
- [x] 2. 使用 iPhone 17 Pro、正常字号、竖屏验证卡片显示、关闭、K/M 数值与无数据状态，截图与参考图同屏比较。保存 `design-qa.md` 和仓库外图像证据，不引入不相关设备验收；创建真实测试会话时及时归档。
- [x] 3. 运行协调器要求的 adapter-regression、coordinator-recovery、build-contract、typecheck，保存真实日志与 validation JSON；继续 heartbeat。
- 原步骤4、5（已取消）：原定ready、正式发布及渠道验收不再属于本轮交付；用户于2026-10-20明确要求仅合入main、不发布，执行结果见下文。

## 自审

本计划覆盖已确认的五行信息与缓存命中率、K/M 修订、触发位置、关闭交互、数据口径、缺失状态、iPhone 验证和客户端协调发布。实现细节不改变已批准产品方案；没有未决产品问题。

## 用户修订（2026-10-17）

「对话 Token」改为「输入 Token xxK/M（缓存命中 xx%）」「输出 Token xxK/M」。新增失败测试验证累计输入/输出与last的区分、缓存比率、零输入/无效数据；同步网页与原生可选快照字段、内存参考和截图断言。卡片宽度仅为容纳后缀适当增加，保留字体、颜色和圆角。尚未发布的旧总量显示字段删除。

## 实施验证记录

- 实现提交 ed055af → 用户输入/输出与缓存率修订 6cbcffc → 独立质量审查发现工作区隐藏后 portal 残留，新增两例真实生命周期 RED 后修复 d9aaa87。最终规格与质量审查通过。
- 248 项相关网页/投影回归、17 项真实 Swift 宿主契约、124 项构建契约、166 项 Python 发布回归、30 项协调恢复与 typecheck 通过。
- iPhone 17 Pro（iOS 26.5、正常字号、竖屏）两项原生 UI 测试通过；首轮失败来自点击被系统 popover 屏蔽的背景文字，改为明确空白坐标后，真实关闭与重开断言通过。
- 测试全部使用内存 fixture，无真实远端测试会话需要归档；专用测试 App 已卸载并释放共享模拟器锁。视觉证据见根目录 design-qa.md；发布等待本任务最终成功 receipt，不把本地验证当作发包完成。

## 缓存标签文案修订

用户要求输入行改为 `100K (缓存 80%)`，网页与原生统一用英文括号和简短「缓存」标签。比例计算和 K/M 格式不变；先将精确文案断言改为新格式，观察失败后修改显示字符串，再验证网页和 iPhone 17 Pro 原生卡片。2026-10-17当时未处理协调器修复，正式发布未完成；后续交付范围以用户2026-10-20的仅源码合并要求为准。

## 2026-10-20 主分支整合（不发布）

基于main `b0e2cee` 合并分支提交 `2cafce3`，保留原生缺少缓存数据时不显示括号、现行额度与刷新时间、旧界面及旧测试已移除的后续改动。现役AgentUI用量卡片与保留的NativeUI组件统一使用“缓存／Cache”短标签；网页集成断言沿用当前入口。同步现行交互约定，不修改发布清单或版本，不登记ready、不构建APK/IPA、不发包或部署网关。

6文件133项定向回归、typecheck与4个变更Swift文件语法检查通过；本轮不重跑模拟器UI，历史截图与原生验收仅作为当时的证据。无新增远端测试会话。日志目录为仓库外 `~/Library/Application Support/ReleaseCoordinator/validations/usage-card-main-20261020/`，最终整合提交及推送状态以Git记录为准。
