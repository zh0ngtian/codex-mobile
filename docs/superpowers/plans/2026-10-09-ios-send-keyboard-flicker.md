# iOS 点击发送收起键盘闪烁修复计划

> **For agentic workers:** 使用 superpowers:executing-plans 连续执行。原生复现与发送布局共享模拟器，当前 Agent 完成。

**Goal:** 点击发送并收起键盘时，输入框保持稳定，消息正常提交且下一条草稿可编辑。

**Architecture:** 检查发送按钮默认失焦、React 清空草稿和原生键盘收起的先后顺序。复用键盘探针记录真实发送时的焦点、绘制帧高度和新增几何动画。使用 WKWebView 的自定义主图层，在 CALayer.add 入口阻止 position / bounds 动画，覆盖布局后追加的动画；进入发送状态变更前同步取消输入焦点。

**Tech Stack:** React、WKWebView、XCTest、Vitest。

## 1. 复现与失败回归

- [x] 在 `tests/ui/composer-maximize.test.tsx` 添加提交回调观察输入焦点的回归，使用真实 textarea.focus()，期望 onSubmit 前已经失焦；运行该用例确认旧实现失败。
- [x] 在 `mobile/ios/CodexMobileUITests.swift` 添加点击发送的回归：短文本、长中文、最大化输入均发送只要求回复固定标识的消息，检查键盘消失、草稿为空、逐帧几何动画数量为 0、位置稳定与再次编辑。
- [x] 在独立源码快照生成 iOS 测试工程，记录旧发送行为；仅测试工程安装诊断，正式包不包含探针。

## 2. 最小修复

- [x] 修改 `.github/workflows/build-ios.yml` 的 WKWebView 主图层，直接拒绝几何动画：

```swift
private class CodexMobileWebViewLayer: CALayer {
    override func add(_ animation: CAAnimation, forKey key: String?) {
        if let property = animation as? CAPropertyAnimation, let path = property.keyPath,
           path == "position" || path == "bounds" || path.hasPrefix("bounds.") {
            return
        }
        super.add(animation, forKey: key)
    }
}
class CodexMobileWebView: WKWebView {
    override class var layerClass: AnyClass { CodexMobileWebViewLayer.self }
}
```

- [x] 更新 `tests/ci/ios-local-build.test.ts` 原有主图层回归，与新入口保持一致。真实 XCTest 在键盘收起的 CADisplayLink 回调中检查新增几何动画数为 0，旧实现必须失败。

- [x] 在 `src/features/conversation/ConversationPage.tsx` 的有效 form 提交分支，先调用 `composerInputRef.current?.blur()` 再调用 `onSubmit(event)`，保留历史消息编辑阻止提交逻辑。
- [x] 运行 `npm test -- --exclude '.mobile-build/**' tests/ui/composer-maximize.test.tsx tests/ui/viewport.test.ts tests/ui/conversation-scroll.test.tsx tests/ci/ios-local-build.test.ts tests/ci/mobile-packaging-workflows.test.ts` 和 `npm run typecheck`，修复本次引入的失败。
- [x] 原生发送回归验证消息提交、收起键盘、输入框稳定与再次编辑；补跑对号收起草稿回归，录屏检查实际表现。

## 3. 交付

- [x] 在 `docs/ios-simulator-verification.md` 记录复现条件、修改和实际验证范围。
- [ ] 阅读提交规范，仅提交本次文件并推送 main，不混入并行的 iOS 内置浏览器修改。
- [ ] 推送后从提交生成独立 Android / iOS 构建快照，版本统一且高于两个固定渠道。
- [ ] 发布固定 APK / IPA 并分别核验 JSON、HEAD、完整 GET 的版本、大小、SHA-256。
- [ ] 删除本次临时源码和编译目录，保留安装包、校验和原生测试证据。

## 已确认的证据

旧实现只在 layoutSubviews 移除动画，发送时在首个 CADisplayLink 采样仍记录到 4 个主图层几何动画。新增原生断言因此失败。自定义 CALayer.add 入口阻止后，短消息和长中文发送均记录到 0 个几何动画，真实消息往返与再次输入通过。

模型层与呈现层在 Core Animation 提交之前可能暂时不同，因此单次高度差不是闪烁的充分证据。本轮将其保留为诊断，回归断言改为实际采样过帧、整个收起期间零几何动画、收起后连续位置稳定，以及消息和草稿行为正确。
