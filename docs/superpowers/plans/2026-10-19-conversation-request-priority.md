# 会话打开请求优先级实施计划

> 按superpowers:executing-plans在本会话逐项执行，不委派其他任务。

**目标：** 保留侧栏刷新，消除后台请求洪峰对前台打开会话的排队影响。

**结构：** 用共享origin调度器限制后台任务，在AppServerClient到HttpRpcTransport间传递可选优先级，只给自动列表刷新加后台标记。保留默认前台、写入对账和关闭语义。

**技术：** TypeScript、Vitest、React/WKWebView、iOS模拟器。

## 1. 回归与最小实现

- [x] 新建tests/ui/http-request-priority.test.ts：使用可手动resolve的fetch，跨两个相同origin的HttpRpcTransport提交4个background请求，断言只发出2个；随后thread/resume立即发出且后台队列等前台完成后继续；全部后台请求最终返回。
- [x] 添加关闭取消排队请求、不同origin独立以及网络超时从实际派发开始计时的用例；运行`npm exec vitest run tests/ui/http-request-priority.test.ts`，确认旧实现因无后台并发控制而失败。
- [x] 新建src/backends/http-request-scheduler.ts，导出共享调度器与请求优先级类型；后台FIFO且每origin最多2个，默认前台直接启动，取消排队任务不占名额。
- [x] 修改src/app-server/client.ts传递可选priority；修改src/backends/http-transport.ts在创建网络截止时间之前调度，并在close时取消排队任务。运行上述回归直至通过。

## 2. 标注刷新与验证业务

- [x] 在tests/ui/thread-list-loader.test.ts增加自动刷新所有摘要和项目均传background、手动分页不被标注的断言，运行该文件确认失败。
- [x] 修改src/app-server/thread-list-loader.ts，仅为load入口创建后台client包装器，保留原client身份合并与手动分页入口；修改src/backends/probe.ts项目目录读取可选priority，并在src/App.tsx的loadThreads中使用background。
- [x] 运行`npm exec vitest run tests/ui/http-request-priority.test.ts tests/ui/http-transport.test.ts tests/ui/app-server-client.test.ts tests/ui/thread-list-loader.test.ts tests/ui/backend-probe.test.ts`及`npm run typecheck`；修正真实问题，保持既有协议与分页断言。

## 3. 模拟器与交付

- [x] 更新docs/interaction-alignment.md现行规则、验收点及变更记录。
- [x] 使用现有独立临时Xcode工程嵌入本分支前端，保留原有诊断探针与同上游临时网关；持有模拟器锁运行真实关注会话10次，侧栏刷新保持开启。
- [x] 保存脱敏耗时与对比报告；安装不带诊断改写的正常构建到模拟器；停止临时服务并释放锁。
- [x] 运行本次相关回归、类型检查与必要构建，检查diff；按中文Conventional Commits提交并推送codex/conversation-request-priority。保持主线程源码、main及发布渠道不变。
