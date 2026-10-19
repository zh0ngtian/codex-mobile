# 视频附件、英文思考强度与分页对齐实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成已确认的三项交互修改并通过默认双端协调目标正式发布。

**Architecture:** 沿用SwiftUI/PhotosUI和网页原生附件桥的现有导入链路，视频走文件附件。模型档位通过现有Web业务投影使用真实目录原始英文值，侧栏分页沿用原有命令，仅修正文字起点。只改客户端，不部署网关。

**Tech Stack:** SwiftUI、PhotosUI、CoreTransferable、React/TypeScript、Vitest、XCTest、releasectl。

## 1. 三项客户端修改（同一实现任务，TDD）

**文件：** `mobile/ios/AgentUI/Composer/{ComposerBar,AttachmentSheet,AttachmentLoader,AttachmentPhotoTransfer,AttachmentImportStore}.swift`、`mobile/ios/AttachmentPickerBridge.swift`、`src/features/conversation/ConversationPage.tsx`、`src/ui/settings.ts`、`mobile/ios/AgentUI/Home/ProjectRow.swift`及对应附件、模型、原生界面回归。

- [ ] 先运行现有范围回归建立基线：`npm test -- tests/ui/settings.test.ts tests/ci/ios-attachment-picker.test.ts tests/ci/composer-attachment-flow.test.ts tests/native-ui/agentapp-attachment-atomic.test.tsx`。
- [ ] 先补失败测试：混选PNG/MP4保留视频原始字节、名称与MIME，视频按文件导入且受现有预算约束；模型返回`high, minimal, ultra`时精确保留该顺序和英文值，空目录没有选项。运行对应Vitest观察预期失败。
- [ ] 最小实现：照片选择器使用`.any(of: [.images, .videos])`；CoreTransferable同时接受`.image`和`.movie`文件表示，以有界读取导入视频，保留图片验证；网页桥接受图片/视频筛选并返回真实文件；Web照片input增加`video/*`，继续使用`selectImages`已有分类。
- [ ] 思考强度选项使用`label: option.reasoningEffort`，选中标签同样使用原值；继续由真实当前模型目录控制可用项和原生命令校验。
- [ ] “加载更多”与`ChatListRow`普通缩进会话使用同一文字起点（现为19+20pt），保留原分页状态和触区；用界面几何断言验收，不为纯间距改动添加实现镜像测试。
- [ ] 同一回归转绿，执行`npm run typecheck`，自审后按`docs/commit-conventions.md`提交；规格审查通过后再做质量审查。

## 2. 集成验收与现行文档

- [ ] 更新`docs/interaction-alignment.md`现行要求、验收要点和变更记录，区分本地已验证与待发布；`release/notes.md`仅写三项本次用户可感知变化。
- [ ] 排队取得共用模拟器独占锁，iPhone 17 Pro正常字号竖屏验收媒体混选、英文实际档位和分页文字对齐。模拟器资源、日志与截图记录在私有validation目录；如创建真实测试会话，验收后及时归档。
- [ ] 运行完整相关回归、前端构建及协调所需adapter-regression、coordinator-recovery、build-contract、typecheck，保存实际命令与结果。

## 3. 协调发布及交付

- [x] 在`codex-mobile-lan-production`登记`codex-mobile-20261019-media-effort-alignment`。
- [ ] 持续heartbeat，推送固定SHA，绑定真实validation文件后ready；main整合、版本分配、构建签名和正式发布交由协调器。
- [ ] 等待任务成功receipt，核对冻结SHA包含任务、GitHub双端、固定APK/Ad Hoc已签名IPA、HTTPS OTA及软件源unsigned版本和中文日志。
- [ ] 通过清单、HEAD及完整GET核对版本、大小和SHA-256，记录发布凭证及最终状态，提交推送文档收尾；交付正文提供固定OTA安装页和本次双端下载。
