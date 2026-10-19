# 视频附件、英文思考强度与分页对齐实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 完成已确认的三项交互修改并通过默认双端协调目标正式发布。

**Architecture:** 沿用SwiftUI/PhotosUI和网页原生附件桥的现有导入链路，视频走文件附件。模型档位通过现有Web业务投影使用真实目录原始英文值，侧栏分页沿用原有命令，仅修正文字起点。只改客户端，不部署网关。

**Tech Stack:** SwiftUI、PhotosUI、CoreTransferable、React/TypeScript、Vitest、XCTest、releasectl。

## 1. 三项客户端修改（同一实现任务，TDD）

**文件：** `mobile/ios/AgentUI/Composer/{ComposerBar,AttachmentSheet,AttachmentLoader,AttachmentPhotoTransfer,AttachmentImportStore}.swift`、`mobile/ios/AttachmentPickerBridge.swift`、`src/features/conversation/ConversationPage.tsx`、`src/ui/settings.ts`、`mobile/ios/AgentUI/Home/ProjectRow.swift`及对应附件、模型、原生界面回归。

- [x] 先运行现有范围回归建立基线：`npm test -- tests/ui/settings.test.ts tests/ci/ios-attachment-picker.test.ts tests/ci/composer-attachment-flow.test.ts tests/native-ui/agentapp-attachment-atomic.test.tsx`。
- [x] 先补失败测试：混选PNG/MP4保留视频原始字节、名称与MIME，视频按文件导入且受现有预算约束；模型返回`high, minimal, ultra`时精确保留该顺序和英文值，空目录没有选项。运行对应Vitest观察预期失败。
- [x] 最小实现：照片选择器使用`.any(of: [.images, .videos])`；CoreTransferable同时接受`.image`和`.movie`文件表示，以有界读取导入视频，保留图片验证；网页桥接受图片/视频筛选并返回真实文件；Web照片input增加`video/*`，继续使用`selectImages`已有分类。
- [x] 思考强度选项使用`label: option.reasoningEffort`，选中标签同样使用原值；继续由真实当前模型目录控制可用项和原生命令校验。
- [x] “加载更多”与`ChatListRow`普通缩进会话使用同一文字起点（现为19+20pt），保留原分页状态和触区；用界面几何断言验收，不为纯间距改动添加实现镜像测试。
- [x] 同一回归转绿，执行`npm run typecheck`，自审后按`docs/commit-conventions.md`提交；规格审查通过后再做质量审查。

## 2. 集成验收与现行文档

- [x] 更新`docs/interaction-alignment.md`现行要求、验收要点和变更记录，区分本地已验证与待发布；`release/notes.md`仅写三项本次用户可感知变化。
- [x] 排队取得共用模拟器独占锁，iPhone 17 Pro正常字号竖屏验收媒体混选、英文实际档位和分页文字对齐。模拟器资源、日志与截图记录在私有validation目录；如创建真实测试会话，验收后及时归档。
- [x] 运行完整相关回归、前端构建及协调所需adapter-regression、coordinator-recovery、build-contract、typecheck，保存实际命令与结果。

## 3. 协调发布及交付

- [x] 在`codex-mobile-lan-production`登记`codex-mobile-20261019-media-effort-alignment`。
- [x] 持续heartbeat，推送固定SHA，绑定真实validation文件后ready；main整合、版本分配、构建签名和正式发布交由协调器。
- [x] 等待任务成功receipt，核对冻结SHA包含任务、GitHub双端、固定APK/Ad Hoc已签名IPA、HTTPS OTA及软件源unsigned版本和中文日志。
- [x] 通过清单、HEAD及完整GET核对版本、大小和SHA-256，记录发布凭证及最终状态，提交推送文档收尾；交付正文提供固定OTA安装页和本次双端下载。

实现提交`f94291f`及网页限制修正`137f585`均有预期红/绿证据。主变更117项相关回归、修正27项及iOS18 SDK类型检查通过；独立规格复审31项通过。原生20/40MiB不变，网页视频保留100MiB单文件上限。七项不同iPhone 17 Pro界面用例已通过：原子混选、照片、取消、等待期间停止、真实目录英文顺序与选择、模型独立档位及分页像素对齐；真实目录由现役网关model/list独立拉取。验收工程资源路径和系统Add按钮文案差异已按既有构建recipe/稳定identifier修正，不涉及产品运行修复。最终质量审查、全量门禁及正式发布均已完成，详见以下凭证。

## 正式发布及交付（已完成）

成功批次`b0bc6727-7082-40dc-aab5-24c1063c7fe8`，冻结main`39d40a9511517a2549d1388b42639a1dc805ef18`，版本**0.3.15（3015）**。任务源码`bc619b831382f035b03b946ae60f7043b648834a`已推送且为冻结提交祖先，原任务状态complete。正式双端CI`39214165191`及必要开发CI成功；十个阶段全部验收。

最终本地146文件1607项、204项适配器、59项协调恢复和typecheck通过；前端构建、iOS18 SDK及七项不同iPhone 17 Pro正常字号竖屏验收通过。规格与质量独立审查通过，网页100MiB限制修正有真实稀疏文件红/绿回归。完成后退出夹具、释放模拟器锁；没有创建真实测试会话。最后两项测试完成后的Xcode模拟器诊断收集闲置5分钟，保存进程采样后仅终止该次`simctl diagnose`子进程，Xcode正常退出0且结果包成功生成，未跳过测试。

[固定OTA安装页](https://192.168.123.79:8766/channels/codex-mobile/current/install.html)、[APK](http://192.168.123.79:8765/channels/codex-mobile/latest.apk)与[Ad Hoc已签名IPA](http://192.168.123.79:8765/channels/codex-mobile/latest.ipa)已通过清单、HEAD、完整GET、版本、大小和SHA-256独立回验；HTTPS IPA也完整下载核对，使用既有CA验证TLS。软件源为同版本GitHub unsigned IPA，中文日志与本次三项实际变化一致，既有开发者署名保留并核对当前gh账号。签名Bundle ID、Team、application-identifier、完整权限散列和钥匙串组与0.3.14一致。

| 产物 | 大小（bytes） | SHA-256 |
| --- | --- | --- |
| APK | 4724631 | `22b02db15200bab209717717eb52092a4b07bbcea1117920a9bb2177289d6077` |
| IPA（Ad Hoc已签名） | 4677367 | `1b2178ff7a93bffce790d984440b1249b410d1bf32a979027def28ecce83c568` |
| GitHub unsigned IPA | 4674525 | `329613342c894c89b1f35267136567c382a4ed171b00f42020ad3f9407929f23` |

成功receipt保存在本机`ReleaseCoordinator/receipts/b0bc6727-7082-40dc-aab5-24c1063c7fe8.json`；独立回验为`validations/codex-mobile-20261019-media-effort-alignment/final-channel-verification.json`。[公共验收摘要](evidence/2026-10-19-media-effort-alignment-release.json)保留本次版本、来源与校验值。未部署网关，未进行真机覆盖安装及数据保留验证。此收尾只修改文档，不触发新的客户端构建或发布。
