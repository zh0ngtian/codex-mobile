# iOS 输入栏图标与正文字号 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 加号菜单去掉 Skill 与插件入口，按参考图改善图标大小和间距，输入文字跟随当前对话页正文尺寸。

**Architecture:** 沿用同一原生 TextField、系统菜单、上下文守卫和业务命令；仅删除加号菜单的 mentions 选项，不删除其他 Skill/插件功能。网页输入呈现元数据携带当前正文基准尺寸，原生 host 将其用于编辑器及行高预算；完整原生模式采用现有助手正文 14.5pt 基准。图标尺寸与触摸区域分开，保留至少 44pt 操作区、自然增长上限及模型和推理可见标签。

**Tech Stack:** SwiftUI、UIKit、TypeScript/React、Vitest、XCTest、现役 releasectl OTA-only。

---

### Task 1: 菜单、尺寸与呈现元数据（单一实现任务）

**Files:**
- 修改 `mobile/ios/NativeUI/NativeComposerAttachmentAction.swift`、`NativeComposerAttachmentMenu.swift`：移除 `.mentions` 选项及失效说明，保留照片、文件、位置的顺序与命令。
- 修改 `mobile/ios/NativeUI/NativeComposerView.swift`、`NativeComposerConfigurationView.swift`：统一图标视觉尺寸、规则间距和发送圆形尺寸，保留单行模型与推理、44pt 命中区域，字号更改同步到输入行高预算。
- 修改 `src/native-ui/protocol.ts`、`web-composer.ts` 与 `mobile/ios/NativeUI/NativeWebComposerPresentation.swift`、`NativeWebComposerHost.swift`：网页呈现增加兼容可选正文尺寸。`useWebInterface().modern` 为 true 时基准 `16 * .8875`，旧版为 `16`，与两份 CSS 的助手正文相同；随页面切换发布，不从已保存偏好推断实际模式。完整原生采用现有助手正文基准 `14.5`。字号只乘一次 snapshot.fontScale，并保留系统 Dynamic Type。
- 修改 `tests/ci/native-ui-menu-smoke.swift`、相关 Swift smoke 与 `tests/ui/native-ui-web-composer.test.tsx`：验证三项业务菜单与上下文、当前网页模式及字号元数据、旧 payload 解码和实际字号解析，不为样式值增加镜像测试。
- 修改 `docs/native-ui-business-bridge.md`、`release/notes.md` 中受影响的用户说明。

- [ ] 运行干净基线：`NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ci/ios-native-ui.test.ts tests/ui/native-ui-web-composer.test.tsx --maxWorkers=2`。
- [ ] 先修改菜单实际命令 smoke 的 expected 为 `photos/files/location`、派发次数为 3；新增真实网页呈现用例，要求发布当前界面正文字号并在模式切换后更新。运行观察功能缺失导致 RED，保存仓库外日志。
- [ ] 最小实现三项菜单，移除无用 `.mentions` 映射；保留所有原命令与上下文检查，其他 Skill/插件能力不动。
- [ ] 最小实现字体数据：`bodyFontSize?: number`；旧网页传 16、新网页传 14.2，NativeWebComposerHost 传给编辑器；完整原生传 14.5。新增字段不得改变旧 payload 可解码性；编辑器计算字体与 UIFont 行高使用同一结果。
- [ ] 对照截图调整视觉：图标约 20pt 基准（原 16pt），发送圆形约 32pt（原 28pt），常规工具栏间隙 4pt、配置项间隙 8pt 作为首轮尺寸；图标与标题独立字体，44pt 命中区域保持。最终在 iPhone 17 Pro 正常字号竖屏截图校准，不新增图中未请求的功能。
- [ ] 关联测试 GREEN、`npm run typecheck` 与完整 Swift SDK 编译检查，自审后按中文 Conventional Commits 提交；正文含“新增功能”和“主要修改”。不推 main、不自行发包。

### Task 2: 实际 UI 与发布（主任务）

- [ ] 取得共用模拟器锁，复用离线生产 App fixture 和独立 QA Bundle，在 iPhone 17 Pro、正常字号、竖屏验证：输入和正文实际字体一致；菜单仅照片/文件/位置；图标和间距视觉核对；模型与推理可见、菜单可选；文本自然增长、缩回且有上限；选择/取消保留草稿与光标。
- [ ] 完成规格审查后进行质量审查；发现缺陷由原实现者修复并复核。保存截图、原始 xcresult、探针及日志，卸载 QA App、释放锁；离线数据不创建远端会话。
- [ ] 运行四项发布检查：Python `tests/ci` 回归、现役协调器恢复测试、相关客户端构建契约、TypeScript。推送固定 SHA，校验远端成功后将本任务 ready 到 `codex-mobile-ios-ota-production`。
- [ ] 等待成功 receipt，核对任务 SHA 包含、必要开发 CI、签名身份/entitlements/钥匙串连续性；固定 LAN IPA 与 HTTPS OTA 清单、HEAD 和完整 GET 的版本/大小/SHA-256 一致。
- [ ] 本轮只发布签名 IPA 与 OTA；不创建 GitHub Release/APK/软件源版本。证据复制到仓库外后归档本任务 worktree，交付 OTA 安装页、固定 IPA、版本/大小/SHA-256。

## 证据目录

`~/Library/Application Support/CodexMobile/validation/ios-composer-spacing-font-20261017/`。
