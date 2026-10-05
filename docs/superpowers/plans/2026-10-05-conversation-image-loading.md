# 会话图片加载优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 消除指定会话打开时批量读取过程截图的问题，保留图片展示与原图预览，并交付固定渠道 APK。

**Architecture:** 多张 imageView 过程截图按回合默认折叠，单张输出图片与正式回复图片保持可见。图片进入可见区域后取最长边 640 px 的缩略图，点击后才取原图；客户端缓存按设备和访问口令隔离，合并并发请求，限制缓存字节数和时效。网关生成缩略图并按文件 mtime/size 缓存，重用现有鉴权；旧网关仅在接口不存在时回退 fs/readFile。

**Tech Stack:** React、TypeScript、Node.js、sharp、Vitest、Playwright、Android WebView。

---

## 已验证基线

会话 `01a10361-da31-7473-9af9-2599e3d58612` 最近五轮 summary 5,495 bytes，读取 4–6 ms；details 7,158 bytes。前端实际挂载 43 张本地图片，27 张有效、16 张失效；有效原图 6,509,659 bytes、Base64 8,679,576 bytes，全部像素约 226,996,992 bytes。固定渠道为 0.2.76。

### 任务 1：鉴权缩略图接口

**Files:** 新增 `server/image-preview.ts`、`tests/server/image-preview.test.ts`；修改 `server/gateway.ts`、`package.json`、`package-lock.json`、`tests/server/npm-package.test.ts`。

- [x] RED：通过真实 PNG 请求 `/api/images/preview?path=...&thumbnail=1`，断言无口令 401、有口令返回 JPEG、长边不超过 640 px；原图请求返回原始文件字节；不存在文件 404；文件覆盖后不返回旧缓存。

```ts
expect((await fetch(endpoint)).status).toBe(401);
const thumbnail = await fetch(`${endpoint}&token=secret`);
expect(thumbnail.headers.get("content-type")).toBe("image/jpeg");
const info = await sharp(Buffer.from(await thumbnail.arrayBuffer())).metadata();
expect(Math.max(info.width!, info.height!)).toBeLessThanOrEqual(640);
```

- [x] 运行 `npx vitest run tests/server/image-preview.test.ts --maxWorkers=1`，确认接口尚不存在导致测试失败。
- [x] GREEN：使用 sharp 的 `rotate().resize(640,640,{fit:"inside",withoutEnlargement:true}).flatten({background:"#fff"}).jpeg({quality:80})`；限制输入大小和像素，缓存最多 128 个条目、8 MiB，合并同文件并发转换。原图直接流式返回，不走 Base64。只开放绝对图片路径，HTTP 缓存使用 private，检查文件状态后生成 ETag。
- [x] 运行新增接口与既有 gateway/npm-package 测试，确认通过。

### 任务 2：折叠、延迟加载和缓存

**Files:** 新增 `src/features/conversation/image-cache.ts`、`tests/ui/image-loading.test.tsx`；修改 `src/features/conversation/Timeline.tsx`、`src/features/conversation/sheets/RemoteFileSheets.tsx`、`src/backends/file-upload.ts`、必要的 `src/styles.css`。

- [x] RED：两张过程截图默认不发读取请求，点击“过程截图（2）”后才出现；单张图、正式回复图不被折叠。模拟 IntersectionObserver，断言进入视口前无请求。相同设备图片卸载再挂载与并发挂载只请求一次，设备之间不复用；缓存按时效刷新；暂存文件失效不反复读取。点击缩略图前不取原图，点击后原图预览保持可用。

```ts
expect(request).not.toHaveBeenCalled();
fireEvent.click(screen.getByRole("button", { name: "过程截图（2）" }));
await waitFor(() => expect(request).toHaveBeenCalled());
```

- [x] 运行 `npx vitest run tests/ui/image-loading.test.tsx --maxWorkers=1`，确认上述行为失败。
- [x] GREEN：`RemoteImage` 接收已有 backend，使用 IntersectionObserver 的 `rootMargin:"160px"`；不支持该 API 时正常读取。缩略图 fetch 使用二进制 Blob，缓存小型 data URL，最长 60 秒、总计 8 MiB；缺失图片短缓存 15 秒，网络错误允许恢复重试。原图在点击时读取，所有预览路径保持原尺寸和缩放控件。多张 imageView 专门用过程截图按钮展开，并从原来的“之前消息”区域中去重，imageGeneration 保持原有展示。
- [x] 运行 image-loading、image-preview、conversation、thread-session 聚焦测试，通过后进行整体审查。

### 任务 3：集成、真机验收和发布

**Files:** 本计划验收记录、必要的 README 更新；证据放到仓库外 `../codex-mobile-proof/conversation-image-loading`。

- [x] 进行独立规格审查，再进行代码质量审查；有问题修复后重新审查。
- [x] 运行 `npm test -- --maxWorkers=2`、`VITE_APP_VERSION=0.2.77 npm run build:package`、`git diff --check`。
- [x] 原始会话仅执行读取，记录首次打开与再次打开的图片请求量、字节数，验证展开过程截图与点击原图；真机读取正式回复，确认布局与图片预览。
- [ ] 按 `docs/commit-conventions.md` 编写中文 Conventional Commit，合并到 main 并推送；版本以发布前最新渠道为准，必须严格更高。
- [ ] 用 GitHub Build Mobile Apps 构建同签名 APK，部署本地网关的新接口，安装真机验证后执行 `apk-server.py publish-channel codex-mobile <APK> --version <version> --notes <notes>`。
- [ ] 固定 JSON、HEAD、GET 的版本、大小、SHA-256 一致后交付固定下载地址；清理本次临时文件和工作树。

## 修复与验收证据

- 干净基线：Node 26 必须提供 localstorage-file；正确环境下 75 个文件、550 项测试通过。
- 前端 RED：首轮7项新测试全部失败；另补 after-final 图片重复、旧 WebView 缺 AbortSignal.timeout、旧网关 CORS 拒绝、路径切换错误沿用可见状态、失效图片隐藏后复用节点的回归，均实际确认 RED 后 GREEN。新增缓存边界检查也通过。
- 服务端 RED：缺 sharp 的依赖断言、缺图片端点、空文件/HEAD 预检、Node 最低版本、host 能力标志、并发过载，均实际见到失败后实现。
- 规格审查指出旧网关跨域缺 CORS，已通过已有 /api/host 的 imagePreview 标志确认能力后回退，并复审通过。质量审查指出排队 FD 和取消问题，已改为获得转换名额后才打开文件，最多2个活动转换+16个排队；共享等待者逐个取消，队列满503，源文件转换时变化409。
- 同一会话的真实只读历史快照浏览器验证：原部署前端首屏发出50次 fs/readFile、43条不同路径；修改后首屏图片请求0。展开最近截图组只加载3张可见缩略图，合计55,049 bytes；点击才取286,248 bytes原图，尺寸984×2136保持。再次打开并展开最近组不重复读取这3张缩略图；滚动新出现的另一张图片单独读取37,479 bytes。
- 该浏览器耗时为只读历史快照的渲染测量，不作为实际手机或 app-server 冷启动耗时。手机真实APK另行验证；验收不向原会话发送消息。
- 证据保存在 `/Users/zhongtian/WorkSpace/codex-mobile-proof/conversation-image-loading/`。

- 最终规格复审与质量复审均通过；质量审查独立定向验证38项通过。

- 最终全量验证：77个文件、588项测试通过；VITE_APP_VERSION=0.2.77 package构建和diff检查通过。该提交时APK构建、安装与固定渠道发布尚待执行，实际交付以固定更新清单和仓库外发布核验记录为准。
