# Remote 网关凭据续期修复部署计划

> **执行方式：** 使用 superpowers:executing-plans 和 superpowers:test-driven-development，由主执行者完成。

**目标：** 部署 `7d04f8d8` 的续期修复，验证原有 Remote 目标的连接、侧栏刷新和对话读取。

**架构：** 在现有独立工作区核对和验证源码；通过原 release coordinator 完成 main／gateway／verify。只更新服务端，保留现有网页产物、配置和配对。

**工具：** Vitest、Python unittest、releasectl、launchd、实际浏览器。

- [x] 核对 `HEAD` 与远端 `main`，对照正在运行的冻结 `a6c9ff0b`，确认运行差异仅为 `server/remote/managed-auth.ts`。保留原进程、服务摘要和身份目录的私有比较数据。
- [x] 复用源码阶段已观察的 RED：有效凭据遇强制续期故障无法连接；再跑 `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/server/remote-managed-auth.test.ts` 核对 GREEN。源码阶段 303 项相关检查的口径见交互约定。
- [x] 运行四项门禁：`python3 -B -m unittest discover -s tests/ci -p 'test_*.py'`、在协调器目录运行 `python3 -B -m unittest discover -s tests`、`NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ci --maxWorkers=2 --testTimeout=60000`、`npm run typecheck`。记录退出码和日志。
- [x] 向 `remote-auth-expiry-deploy-20261118` 提交已推送完整 SHA，验证文件指定 `scope=gateway-only`、`webUi=false`；等待共同成功凭证，核对冻结 SHA、开发 CI、安装摘要、新进程及保留网页。
- [x] 核对实时 Remote 状态、原配对与原目标，通过现有 HTTP 接口验证只读 RPC。实际网页计时从点击至本轮成功结束／正文可见；若某环节失败，记录时间和原因，不计为成功样本。不发送消息、不新建会话。
- [x] 同步交互约定和运维文档的现行状态，保留脱敏证据。仅文档收尾按共享 main 锁交付，不重复部署。

部署来源 `7d04f8d8d14668b3d2e6eb52a3a5bdf091274a27`；成功批次 `9d9d2ddd-e55a-4af7-91a6-27e7a938e989`，冻结 `48b4301a2c07a886fe02316d51847a10f9e33cbf`，开发 CI `44260282326` attempt 1 成功。持久 receipt SHA-256 为 `7700bf3fa3f81c653bec88af3657935199d4ade9e42e9f8cfde3205397763532`。新进程与实际 server／dist／bin／manifest 摘要及安装归档同凭证一致；网页摘要、9 份私有配置／身份文件、原工作区 HEAD／index 和两个完整目标身份保持。24 项凭据回归、290 项适配器、59 项协调器、164 项构建契约及类型检查通过。未发布客户端。

| 只读生产接口 | FWWJ5VYDY4 | mac_pc |
| --- | ---: | ---: |
| 连接初始化 | 1.31 秒（200） | 7.36 秒（200） |
| 会话列表（1 条） | 0.86 秒（200） | 2.55 秒（200） |
| 读取一条已有会话正文 | 9.31 秒（200） | 11.63 秒（200） |
| 项目目录 | 7.02 秒（200） | 10.85 秒（500） |

Edge 双设备网页实测：首轮从点击至按钮停止 56.48 秒，稍后的后台重连使两台首次在 94.56 秒同时显示已连接，仍未获得成功刷新。第二轮起点两台已显示连接，按钮 83.47 秒停止，125.96 秒取样时仍显示正在加载会话；期间项目目录多次返回 500，部分请求经历约 20–21 秒。已有对话首次点击后提示设备尚未连接；连接后点击重试，4.86 秒显示正文和输入框。接口和网页测量不是同一个样本，不作为性能分位数或成功刷新时长。未新建会话或调用推理，测试临时页和探针已关闭。
