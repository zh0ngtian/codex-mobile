# 会话电脑文件下载修复计划

> **执行方式：** 当前会话直接按 superpowers 的计划与 TDD 流程执行；软件发布前遵守 AGENTS.md 的流程确认要求。

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

### 任务 3：交付验证

- [ ] 按 `docs/commit-conventions.md` 提交并推送。
- [ ] 更新运行中的网关，构建高于固定渠道现有版本的 APK。
- [ ] 在手机从该会话点击照片并下载，核对保存文件大小和 SHA-256。
- [ ] 发布固定渠道并通过 JSON、HEAD、GET 核验版本、大小和摘要；清理本次临时校验文件。

## 已完成验证

- 初次回归：新下载接口返回 404，照片按钮返回 data URL，三个断言按预期失败；普通文件断言同样先失败。
- 修复后：80 个测试文件、637 条测试全部通过；本机 Node 26 的原生 Web Storage 与 jsdom 冲突，通过 `NODE_OPTIONS=--no-experimental-webstorage npm test` 使用 jsdom 存储运行。
- `npm run build:package` 通过，包含类型检查、前端构建及网关编译。
- 生产网关只读探针确认原照片可完整读取，字节数 9183577，SHA-256 `8d76c893e7fc93db1edd7dc7944dc045fcf3d97758b51676e4f680067124f755`。
