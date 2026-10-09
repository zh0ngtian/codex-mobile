# 键盘同步与审批回复实施计划

> **For agentic workers:** 使用 superpowers:executing-plans；独立审批任务依照 subagent-driven-development 执行和审查。

**Goal:** 输入栏跟随系统键盘实际位置收起，支持完整审批和问题回答。

**Architecture:** 保留网页界面和现有原生几何防闪烁。从 UIKeyboardLayoutGuide 约束视图的 CASpringAnimation 读取系统弹簧参数，生成网页关键帧并按已过时间定位。原生完整视口和安全区提供稳定终点，keyboardDidHide 还原布局；不再使用独立 ease-out、最低100ms或逐帧跨进程传位置。审批子任务复用 app-server 请求与 HTTP/WebSocket 链路。

**Tech Stack:** React、TypeScript、WKWebView、UIKit、Vitest、XCTest。

## 键盘
- [x] 旧网页动画与系统曲线不同，且强制最短100ms；增加先失败的时间线、延迟resize、重复通知和分段视口行为回归。
- [x] 新增 `mobile/ios/KeyboardDismissal.swift` 并接入本地/CI统一打包。读取当前系统弹簧参数（实测 mass=1、stiffness=555.0265、damping=47.118、duration=0.3833），不硬编码系统常数。
- [x] 网页扣除桥接和resize已过时间，目标改变也保持同一时间线；原生完整视口避免键盘附件工具栏中间高度造成二次移动；didHide、willShow、进入后台清理。
- [x] 修复动画拖尾探针：WAAPI优先级高于inline top，必须独立计算目标。真实Chromium负例先错误报告0，修复后准确检出230.40625px。
- [x] 原生复验重复草稿、中文、多行、发送、最大化、小字体再次编辑；最终4项XCTest通过，9次带拖尾断言的收起残差0–0.015625px。录屏和连续帧保留。

## 审批与回答
- [x] 独立worktree完成可读审批、协议决策、问题选项及文字回复、必填校验与请求生命周期，先失败测试再实现。
- [x] 规格/质量审查补齐保密答案持久化去敏、请求解决时释放pending、网关旧快照不复活resolved请求，覆盖HTTP和WebSocket。
- [x] 合并审批3个提交；mock HTTP完整App浏览器回归通过。服务端补丁需要部署本机网关。

## 交付
- [x] 执行全量 Vitest、typecheck、build、iOS相关Python回归、diff检查与独立审查。
- [ ] 依提交规范提交并推送；持有固定渠道发布锁，分配高于双端当前清单的统一版本，构建APK及Ad Hoc签名IPA。
- [ ] 验证JSON、HEAD、GET版本大小SHA-256及HTTPS OTA；归档测试会话，清理临时构建，交付固定链接和证据。

## 已完成验证

- 全量 Vitest 848项/95文件通过；客户端与网关生产构建通过。
- iOS发布相关Python测试87项通过。
- 键盘网页时间线14项行为/打包回归通过，真实WAAPI拖尾探针负例通过。
- 审批mock HTTP端到端2项通过；服务端HTTP快照与WebSocket生命周期真实网关回归通过。

## 诊断中的纠正

UIWindow自身键盘导引不更新，改用根控制器视图；逐帧evaluateJavaScript有WebKit进程延迟，改为复用系统弹簧时间线。只验证didHide终点不能证明中段同步，因此加入录屏核对；旧探针也被WAAPI top覆盖，已用真实浏览器负例修复。小字体再次编辑的分段视口问题以稳定原生终点解决，不放宽原有单帧位移阈值。

最终原生结果：`viewport-final.xcresult` 两项、`drafts-send-final.xcresult` 两项均通过。12条仅由本次原生回归创建的测试会话已归档，模拟器锁已释放。
