# 会话电脑文件下载修复计划

> **执行方式：** 当前会话直接按 superpowers 的计划与 TDD 流程执行；用户已于本次交付确认继续发布，遵守 AGENTS.md 的计划与 TDD 要求。

**目标：** 手机点击会话中电脑图片文件后，可预览并通过原设备网关下载原文件，不需要人工复制照片或逐个生成公开链接。

**架构：** 在现有鉴权网关新增 `/api/files/download/<文件名>`，用 `path` 指定源文件并保留原字节，支持 GET/HEAD 和 attachment 响应。客户端把预览与下载地址分开：预览继续使用已有读取链路，下载使用当前 backend 的 HTTP URL；URL 文件名后缀同时适配 Android 现有 DownloadManager。通用文件预览也复用该下载接口。

**技术栈：** Node.js HTTP/file streams、React、Vitest、Android WebView/DownloadManager。

### 任务 1：失败测试

- [x] 在 `tests/server/file-download.test.ts` 验证缺失口令被拒绝、中文文件名、原文件字节和大小、HEAD、缺失文件及非法路径。
- [x] 在 `tests/ui/image-preview.test.tsx` 通过最终回复 Markdown 的中文电脑路径验证打开照片后，下载 href 指向当前 backend 的文件接口，包含口令和真实 path，不使用 data URL；补通用文件覆盖。
- [x] 运行 `npm test -- tests/server/file-download.test.ts tests/ui/image-preview.test.tsx`，记录接口 404 和旧 data URL 导致的失败。

### 任务 2：实现

- [x] 新增 `server/file-download.ts`，检查绝对路径、打开普通文件、设置 attachment/长度/MIME/cache-control，流式传输，错误统一处理并关闭句柄。
- [x] `server/gateway.ts` 将该路由纳入鉴权和 CORS，交给文件下载处理器；GET/HEAD/OPTIONS 按协议处理。
- [x] `src/backends/file-upload.ts` 新增 `remoteFileDownloadUrl(backend, path)`，通过 URLSearchParams 编码口令和路径。
- [x] `ImagePreviewSheet.tsx` 新增可选 downloadHref；`RemoteFileSheets.tsx` 将当前 backend 传入文件预览，并给图片及普通文件下载动作传入网关地址。
- [x] 运行聚焦测试、全量测试、类型检查和生产构建。

### 任务 2b：真机发现的预览重挂载

- [x] 真机在原会话打开图片后，周期性会话刷新导致预览关闭，阻断下载点击。
- [x] 新增 `会话轮询重绘最终回复时保留已打开的文件预览` 回归测试，先验证重绘后找不到 dialog 的失败。
- [x] 将 Markdown 的组件声明保持为稳定类型，通过 Context 传入当前图片和链接渲染回调，避免轮询卸载预览。
- [x] 聚焦 91 条测试与类型检查通过；随后完成全量检查并重新构建 APK。

### 任务 3：交付验证

- [x] 真机复测发现普通 `thread/resume` 历史中的图片响应进入写操作持久缓存，触及 64 MiB 上限后无法打开会话。补充失败测试：连续八次打开 9 MiB 图片会话，以及旧客户端待确认导航请求恢复。
- [x] 普通导航 resume 使用临时请求缓存；包含模型等设置覆盖的 resume 和发送消息仍保留原持久确认机制。客户端清除旧普通导航待确认项。

- [x] 按 `docs/commit-conventions.md` 提交并推送原文件下载修复；真机补充修复同样按规范提交。
- [ ] 更新运行中的网关，构建高于固定渠道现有版本的 APK。
- [ ] 在手机从该会话点击照片并下载，核对保存文件大小和 SHA-256。
- [ ] 发布固定渠道并通过 JSON、HEAD、GET 核验版本、大小和摘要；清理本次临时校验文件。

## 已完成验证

- 初次回归：新下载接口返回 404，照片按钮返回 data URL，三个断言按预期失败；普通文件断言同样先失败。
- 修复后：80 个测试文件、637 条测试全部通过；本机 Node 26 的原生 Web Storage 与 jsdom 冲突，通过 `NODE_OPTIONS=--no-experimental-webstorage npm test` 使用 jsdom 存储运行。
- `npm run build:package` 通过，包含类型检查、前端构建及网关编译。
- 生产网关只读探针确认原照片可完整读取，字节数 9183577，SHA-256 `8d76c893e7fc93db1edd7dc7944dc045fcf3d97758b51676e4f680067124f755`。

- 原文件接口已更新到运行中的网关，生产 HEAD/GET 确认返回原照片 9183577 字节和一致 SHA-256。
- 首版 v0.2.79 已覆盖安装且签名与旧版一致；真机发现轮询卸载弹层后暂未发布，补充修复后重新构建并复测。
