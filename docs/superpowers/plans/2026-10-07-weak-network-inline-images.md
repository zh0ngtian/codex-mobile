# 图片会话弱网加载修复计划

> **执行方式：** 当前会话直接执行 superpowers 计划与 TDD。沿用用户已经确认的部署流程，不向原始会话发送消息。

**目标：** 打开 `01a112d6-2d97-77b0-8823-0d6a264713a8` 时先显示文字，输入照片按可见区域加载缩略图，点开后再读取原图；历史和实时通知使用同一图片引用，避免反复传输原图。

**架构：** 网关将协议中用户图片的 data URL 和无文件引用的生成图片保存为内容寻址的私有文件，返回本地引用。复用现有鉴权图片缩略图、原图和下载接口。只转换图片字段，不截断正文、改写工具参数或发送内容。缓存限额 256 MiB，重复图片复用文件，失败时保留原协议结果。普通客户端沿用 RemoteImage 的可见区域和缩略图加载机制。

**技术栈：** Node.js、SHA-256、文件缓存、现有 sharp 图片预览、Vitest、Android WebView / ADB。

## 基线

- 最新版本 0.2.81；首次 resume 的 summary 页仍携带两张完整 JPEG，响应 9,146,269 字节。本地请求约 0.133 秒；在 1 Mbps 下纯传输下限 73.17 秒。
- 两张照片分别占 4,326,159 和 4,815,563 个字符，文字并非慢在上游模型计算。
- 弱网验证使用 HTTP 响应限速和延迟，分别为 262,144 B/s + 400 ms、65,536 B/s + 1,200 ms；明确记录这是网络限速模拟，不冒充蜂窝信号实测。

## 任务 1：失败测试

文件：`tests/server/http-session.test.ts`、`tests/server/inline-images.test.ts`、`tests/ui/conversation.test.tsx`、`tests/ui/history-edit.test.ts`。

- [x] 真实网关返回带两张 data URL 的 resume，断言响应小于 32 KiB、正文完整、两张图片保留、原文件字节不变、缩略图可鉴权读取；旧响应大小和实时事件摘要断言按预期失败。
- [x] 同样覆盖 summary 补页与实时 userMessage 通知，断言不再返回 base64 原图；生成图片无 savedPath 时也可预览原图。
- [x] 缓存覆盖重复请求、并发写入、重启复用、容量淘汰和写入失败回退。导航持久化回归改为核对引用文件原字节，不再要求大 data URL 进入文字响应。
- [x] 图片来源保留用户可读名称：`imageSourcesForItem({type:"userMessage",content:[{type:"image",url:"/cache/hash.jpg",name:"图片"}]})` 返回名称“图片”和本地引用。
- [x] 历史编辑附件兼容完成 RED→GREEN：缓存引用重发时转换为标准 `localImage`，保留原文件，不把设备路径误传为远程图片 URL。

执行：`NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/server/http-session.test.ts tests/server/inline-images.test.ts tests/ui/conversation.test.tsx tests/ui/history-edit.test.ts`，先记录预期失败。

## 任务 2：实现与验证

文件：新增 `server/inline-images.ts`；修改 `server/http-session.ts`、`src/ui/conversation.tsx`、`src/app-server/history-edit.ts`。

- [x] `InlineImages` 解码支持的图片 data URL，以 SHA-256 定位私有原图，原子写入并限制总容量；只扫描本缓存拥有的文件。
- [x] HTTP 历史响应中的 `userMessage.content[].url` 改为缓存引用，保留 name；生成图片无 savedPath 时增加缓存 savedPath，有可靠 savedPath 时删除重复内联 result。
- [x] 在通知 bounded 截断之前转换图片，按通知顺序处理，避免原图截断导致丢图；审批和语音仍沿用现有协议。
- [x] `imageSourcesForItem` 使用协议 name，缩略图、原图和下载复用现有组件及网关。
- [x] 聚焦测试通过后运行 `NODE_OPTIONS=--no-experimental-webstorage npm test` 和 `VITE_APP_VERSION=0.2.83 npm run build:package`。
- [x] 用相同原始会话和相同限速参数测量修复后的文字响应；手机显示两张输入缩略图和原照片文件链接。下载仍需最终 APK 验证。

## 弱网测量结果

- 相同原会话首次响应从 9,146,269 字节降到 4,829 字节，完整正文和两张输入图片引用保留。
- 协议限速：262,144 B/s + 400 ms 从 35.297 秒降到 0.589 秒；65,536 B/s + 1,200 ms 从 60 秒超时降到 1.377 秒。
- LGE_AN10 / Android 12 真机经过共享带宽 HTTP 代理；重度正文响应 1.475 秒、4,830 字节，两张缩略图 44,237 / 52,522 字节。ADB 首次采样到正文为 5.136 秒，两张图片为 8.115 秒；这是 UI 采样上限，不声称精确首帧时间。
- 中度真机正文响应 0.609 秒；ADB 正文可见上限 3.036 秒，两张缩略图可见上限 5.411 秒。模拟代理恢复后不修改手机原设备连接配置。

## 任务 3：交付

- [ ] 阅读 `docs/commit-conventions.md`，检查 diff，中文 Conventional Commit 提交并推送。
- [ ] 以已推送源码构建高于固定渠道的 APK，更新网关和连接手机；检查原会话文字、两张输入照片和下载。
- [ ] 发布固定局域网渠道，并通过 JSON、HEAD、GET 核对版本、字节数和 SHA-256。
- [ ] 将弱网测量保存在仓库外 `../codex-mobile-proof/weak-network-v0.2.82-image-session`，清理无用临时文件和恢复测试配置。

- 最终全量验证：81 个测试文件、648 条测试通过；类型检查、前端和网关打包通过。手机 HTTP 代理相关的三个原空设置均已恢复为空，临时代理和测试网关已停止。

- 并行会话已推送主分支排序修复 `ce050f4`；为避开并行交付版本占用，最终 APK 选用 0.2.83。弱网候选证据目录保留原名称，记录对应的同一图片投影修复。
