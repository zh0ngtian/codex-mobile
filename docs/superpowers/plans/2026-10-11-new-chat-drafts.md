# 新对话本地草稿实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 superpowers:executing-plans 在当前隔离 worktree 中逐项实施。连续的数据流与发布操作由当前 Agent 完成。

**Goal:** 新对话可手动保存多条本地草稿，侧栏刷新左侧的“草稿”入口显示全部记录，选择记录直接恢复完整新对话。

**Architecture:** IndexedDB 保存文本、图片 data URL、文件 ArrayBuffer 二进制字节、目标设备/项目和模型/推理/服务档位/权限/审批。恢复保留草稿 ID，重复保存覆盖当前记录；turn/start 确认成功按记录 revision 删除，失败和待确认保留。设备不存在时显示错误，不改变草稿目标。列表复用 ActionSheet。

**Tech Stack:** React / TypeScript / IndexedDB / Vitest / Playwright Chromium 与 WebKit。

## Task 1：本地持久化

**Files:** `src/features/drafts/new-chat-drafts.ts`、`tests/ui/new-chat-drafts.test.ts`、`package.json`、`package-lock.json`。

- [x] 添加真实 IndexedDB 的内存实现 fake-indexeddb 作为测试依赖；写入草稿、换 repository 实例读取，检查附件字节和全部配置。
- [x] 写更新原草稿、跨设备排序、只删除指定 revision、不可用存储拒绝的测试，运行看到失败。
- [x] 实现 `NewChatDraftStore.save(input, id?)`、`list()`、`remove(id, revision?)`、`restoreNewChatDraft(record)`，事务完成才报告成功。
- [x] 运行 `npm test -- tests/ui/new-chat-drafts.test.ts` 并确认通过。

测试关键断言：
```ts
expect(await restored.files[0].file.text()).toBe('local attachment');
expect(record.settings).toEqual(input.settings);
expect(await store.list()).toHaveLength(1); // 重复保存更新原记录
await store.remove(record.id, oldRevision); // 不删除新保存内容
```

## Task 2：保存、列表及完整恢复

**Files:** `src/App.tsx`、`src/features/conversation/ConversationPage.tsx`、`src/features/threads/ThreadListPage.tsx`、`src/features/drafts/DraftsSheet.tsx`、`src/styles.css`、`src/i18n.tsx`、`tests/ui/thread-list-page.test.tsx`、`tests/e2e/new-chat-drafts.spec.ts`、`tests/e2e/new-chat-drafts.config.ts`。

- [x] 先测试刷新左侧草稿按钮及点击回调；浏览器测试保存/重启/恢复/更新/删除、真实附件字节、发送失败保留与成功移除。
- [x] 新对话 composer 增加保存按钮、保存状态与失败反馈，图片读取/消息启动时禁用保存。
- [x] `ConfiguredApp` 打开全局 DraftsSheet；选择草稿设置目标 backend，并发送包含配置、ID/revision 和恢复附件的 WorkspaceCommand。
- [x] BackendWorkspace 恢复草稿时保留 `cwd: null`，覆盖默认配置；bootstrap 不覆盖已恢复配置；首条 `turn/start` 与延迟确认均按 revision 删除对应草稿。
- [x] 列表展示文本摘要、设备、项目、保存时间、图片/文件数，提供单条删除；缺失设备明确报错，禁用设备恢复时启用。
- [x] 运行单元测试、`npm run build` 与 `npx playwright test -c tests/e2e/new-chat-drafts.config.ts`，检查窄屏截图。

恢复命令：
```ts
setCommand({ id: ++commandIdRef.current, backendId: record.backendId,
  type: 'new', cwd: record.cwd, savedDraft: record,
  draft: record.text, draftImages: restored.images, draftFiles: restored.files });
```

## Task 3：交付

**Files:** `README.md`、本计划验证记录。

- [x] 更新 README 的当前能力与本地保存边界，完成相称 UI 回归、类型检查和构建。
- [x] 阅读提交规范，运行 `git diff --check`，提交带“新增功能”“主要修改”正文的中文 Conventional Commit，合入当前 main 并推送。
- [x] 排队获得发布锁，读取双端渠道与 GitHub Release 的最高版本，分配同一更高版本；使用 GitHub Actions 构建 APK/unsigned IPA、本机 `npm run ios:release` 签名发布。
- [x] 发布 APK 至固定渠道；两端 JSON、HEAD、完整 GET 校验版本/大小/SHA-256；核对软件源 unsigned IPA 与当前 GitHub 用户署名，保留本机签名包与 ota-release.json。
- [x] 本计划记录验收与交付；提供固定 OTA 页、APK、IPA 链接、版本、大小、散列和签名状态。清理无用临时文件，归档使用过的测试会话。

## 开发验证记录

- 在独立 worktree 应用 superpowers:writing-plans、test-driven-development、executing-plans；按既有授权由当前 Agent 连续实施和发布，收尾采用 finishing-a-development-branch。
- 基线附件/列表/Skill 50 项通过；存储缺失、草稿入口缺失与保存按钮缺失的 RED 均已观察到。保存中继续编辑的测试先失败，加入内容版本校验后通过。
- 文件 Blob 在 WebKit 的 IndexedDB 写入失败，改为完整 ArrayBuffer 字节。两端恢复文件内容均为原始字节，临时 blob 预览地址不持久化；成功发送及导航时释放预览地址。
- 草稿/列表/附件/Skill/语言/旧安装兼容/HTTP 回归 88 项通过；生产类型检查与构建成功。
- Playwright Chromium 与 mobile WebKit 共 10 项通过：重启恢复、真实附件内容与发送、更新原草稿、失败保留/成功移除、完整配置与无项目恢复、初始化竞争、单条删除、配额失败、附件独立保存、保存期间继续编辑和停用设备恢复。280/320/393px 无横向溢出，截图已检查。
- 完整 UI 回归在 `NODE_OPTIONS=--no-experimental-webstorage` 下 640 项通过、1 项既有失败：`sidebar-refresh.test.tsx` 禁止 App 全部 setInterval，但基线已有 HTTP 操作两秒对账定时器（原 HEAD 第 2044 行）；本次没有新增定时器，不改动该过时断言。默认 Node 运行还会因实验 localStorage 产生环境失败，使用仓库已有的 Node 参数消除。
- 未创建真实 Codex 测试会话；未占用共用模拟器或操作真机。浏览器/构建证据不代表真机覆盖安装和数据保留验收。

## 固定渠道发布验收

- 功能提交 `d635959` 已推送 main，统一分配 0.2.155 / build 2155，持有主工作区固定渠道发布锁。
- 本机设备 IPA 构建、Ad Hoc 签名和独立验签通过，身份及完整钥匙串组保持连续；HTTPS OTA 与固定 LAN IPA 的 JSON/HEAD/完整 GET 已核对。
- IPA：3,788,620 字节，SHA-256 `e7a53808e202c831ad11a8ddb803607068657c5f64ebac0bb3ce338fe9edd017`。已检查包内包含本次草稿运行代码。
- 额外验证 WebKit 的 file:// 页面写入文字/ArrayBuffer、关闭页面后重新打开读取原文和文件字节通过，适配现有 App 的本地资源加载方式；该检查仍不是 iPhone 真机验收。

- GitHub Actions `38139567516` 双端构建、契约验证及 Release 发布成功；下载包与 GitHub asset digest、构建回执中的来源提交一致。
- APK：4,719,371 字节，SHA-256 `841b8555e3271c2e4f73d7076591ea74ee2c005fe4ea5171543538c59c375724`；固定 JSON、HEAD 与完整 GET 通过。
- 软件源已同步同版本 unsigned IPA：3,765,148 字节，SHA-256 `ac8715581419effb8b004b634e83138cab48bbf7bbd3d9dfb6cf4ce83ad54803`；公开版本/build/downloadURL/大小与 GitHub Release 和全包下载一致。根据当前 GitHub 登录用户检查署名，原 `zh0ngtian` 保持。
- 长期凭证位于主工作区 `.mobile-build/new-chat-drafts-release/0.2.155/`：双端包、unsigned 包、签名/OTA/渠道回验、GitHub 来源、软件源回执、UI 回归与构建日志、截图、file:// 存储检查。Ad Hoc 已签名包仅发布 OTA/LAN，没有上传软件源或 GitHub。
- 本次测试只使用独立浏览器模拟数据，没有产生需要归档的真实 Codex 会话。收尾归档本任务 worktree，清理本次临时文件，并释放固定渠道锁。
