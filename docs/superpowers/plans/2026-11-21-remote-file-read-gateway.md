# 远程文件直读与网关部署计划

> 按 Superpowers 执行计划、测试驱动开发及完成前验证逐项执行。

**目标** 减少普通文件下载启动前的远程往返，部署到生产网关，并用同一组文件复测。

**实现** 基线为 main `eb2a4e0a`。文本预览的 `fs/readFile` 已经直接访问目标，视频 Range 和 HEAD 仍需要先取文件大小。普通 GET 下载从首个已验证的读取窗口一起取得大小、版本和字节，超过 100 MiB 继续以首窗版本分段，沿用独立 SHA-256 校验和背压。网关批次同时包含已在 main 上的图片查询优化。

- [x] 在 `tests/server/media-consumers-remote.test.ts` 断言小文件 GET 的 `f.stats` 为 0、`f.reads` 为 1，HEAD 只做一次元数据查询。补空文件和目录用例，大文件验证后续分段使用首窗版本。执行 `npm test -- tests/server/media-consumers-remote.test.ts -t '下载隔离字节|空文件下载'`，确认 GET 查询次数的断言在旧实现失败。
- [x] 在 `server/remote/files.ts` 的读取生成器增加首窗元数据交付。由 `server/remote/file-read-python.ts` 在首窗安全打开常规文件并把读取长度限制为文件大小和 100 MiB 中较小的值；网关同时验证元数据、分块和总摘要协议。在 `server/media-file-source.ts` 和 `server/file-download.ts` 用首窗结果确定响应长度，关闭时释放生成器。重跑小文件、空文件、替换、错误和大文件用例。
- [x] 完成远程网关、会话、中继、媒体及文件回归，执行 `npm run typecheck`、`npm run build:server`、`npm test -- tests/ci --maxWorkers=2 --testTimeout=60000`，以及项目发布适配器和协调器 Python unittest。
- [ ] 在独立工作树推送固定 SHA，持续 heartbeat，向 `remote-file-read-gateway-20261121` 提交 `gateway-only`、`webUi=false` 的验证清单。等待协调器完成，核对批次回执、开发 CI、现役进程和安装摘要。
- [ ] 比较部署前后的同一 Remote 目标和文件，核对文本预览 RPC、普通下载和原图字节、缩略图格式及响应时间，同步交互约定。
