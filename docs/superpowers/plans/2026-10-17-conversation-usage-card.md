# 对话用量与额度卡片实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 将对话页圆圈入口改为参考图式卡片，增加 K/M 格式的会话累计 token 消耗。

**架构：** 复用 App 已有 tokenUsage 和 rateLimits，不增加 RPC 或服务端状态。用量格式化和窗口选择为纯函数，浮层在现有 React 组件树中管理开闭，避免受 header 的 backdrop-filter 或 overflow 裁剪。

**技术栈：** React、TypeScript、CSS、Vitest、Testing Library、现有 iOS 验证与 releasectl。

---

## 任务 1：实现卡片及回归测试

**文件职责：**

- 修改 `src/features/conversation/ConversationControls.tsx`：保留圆圈和菜单，移除旧状态底部弹层；保留现有上下文计算导出供旧调用使用。
- 新增 `src/features/conversation/ConversationUsagePopover.tsx`：卡片、锚定、关闭与焦点恢复，以及卡片的 token/额度纯函数；不引入全局通用浮层框架。
- 修改 `src/features/conversation/ConversationPage.tsx`：圆圈开闭状态、按钮锚点、卡片传值；切换线程关闭浮层。
- 修改 `src/styles.css`：卡片及透明外部关闭区域样式，清理旧状态弹层专用样式。
- 修改 `src/i18n.tsx`：新增中英文文案。
- 修改 `tests/ui/conversation-controls.test.tsx` 并按需新增 `tests/ui/conversation-usage-popover.test.tsx`：用真实组件及函数验证用户可见行为。

- [ ] 1. 先编写失败测试，验证 7 天、5 小时窗口不混淆；缺失窗口显示暂无数据；null/NaN/负数不当作零；格式化覆盖 950→950、1000→1K、128450→128.5K、999999→1M、3084000→3.1M。

```tsx
expect(formatTokenCount(128_450)).toBe("128.5K");
expect(formatTokenCount(999_999)).toBe("1M");
expect(formatTokenCount(3_084_000)).toBe("3.1M");
```

- [ ] 2. 运行 `npm test -- tests/ui/conversation-controls.test.tsx tests/ui/conversation-usage-popover.test.tsx`，确认新增断言因缺少功能失败，并保存日志到仓库外验证目录。
- [ ] 3. 实现最小功能。格式化使用十进制 K/M，最多一位小数；累计值只读取 total，最近上下文继续读取 last。窗口匹配按 `windowDurationMins` 选择 300 与 10080，不能以 primary/secondary 下标猜含义。

```ts
const totalTokens = tokenUsage?.total?.totalTokens;
const isValidCount = typeof totalTokens === "number" && Number.isFinite(totalTokens) && totalTokens >= 0;
const tokenText = isValidCount ? formatTokenCount(totalTokens) : t("暂无数据");
```

- [ ] 4. 浮层通过触发按钮 `getBoundingClientRect()` 锚定并约束视口边界，优先图标下方右对齐；透明遮罩和卡片独立于 header 的裁剪层。卡片内点击不关闭；外部点击、Escape、重复触发关闭；focus cleanup 恢复焦点。保留按钮现有 aria-label，增加 aria-expanded/aria-haspopup。
- [ ] 5. 补充/运行组件行为测试，验证实际四行文本、实时 rerender、缺失数据、关闭和焦点恢复，运行 `npm run typecheck`。确认直接依赖 ConversationPage 的回归测试仍通过。
- [ ] 6. 自审 `git diff --check`，依仓库中文 Conventional Commits 规范提交，正文包括「新增功能」「主要修改」。

## 任务 2：独立审查、界面验收与发布

- [ ] 1. 子代理依次完成需求符合性与代码质量审查；修复问题并重验本次受影响范围。
- [ ] 2. 使用 iPhone 17 Pro、正常字号、竖屏验证卡片显示、关闭、K/M 数值与无数据状态，截图与参考图同屏比较。保存 `design-qa.md` 和仓库外图像证据，不引入不相关设备验收；创建真实测试会话时及时归档。
- [ ] 3. 运行协调器要求的 adapter-regression、coordinator-recovery、build-contract、typecheck，保存真实日志与 validation JSON；继续 heartbeat。
- [ ] 4. 提交并推送确定 SHA，调用 `releasectl ready --task conversation-usage-card-20261017 --sha <已推送实际 SHA> --validation <实际验证文件>`，等待批次成功 receipt。不独立发包或推进 main。
- [ ] 5. 读取 receipt，核对 GitHub APK/unsigned IPA、LAN 双端、已签名 HTTPS OTA、软件源 unsigned 版本和中文更新日志。交付固定 OTA/APK/IPA 链接、版本、大小、SHA-256 与 IPA 签名状态。

## 自审

本计划覆盖已确认的四行信息、K/M 修订、触发位置、关闭交互、数据口径、缺失状态、iPhone 验证和客户端协调发布。实现细节不改变已批准产品方案；没有未决产品问题。
