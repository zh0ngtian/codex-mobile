# Bark 自动命名等待网关部署计划

> **执行代理须知：** 使用 superpowers:subagent-driven-development 逐项执行，先规格审查、再质量审查；各步骤以复选框跟踪。

**目标：** 将已验证的 Bark 最新名称及自动命名等待逻辑部署到现役网关，核对实际进程、文件摘要和兼容行为。

**架构：** 复用现有 `releasectl` 的 `codex-mobile-gateway-production` 与 `codex-mobile-main-production` 互斥。协调器负责整合、冻结、服务端构建与部署，保留已部署前端、依赖和启动配置；本轮不发布客户端，不改 App 版本或客户端更新日志。

**技术栈：** TypeScript、Vitest、Python unittest、WebSocket、HTTP、launchd 和现役发布协调器。

---

用户明确授权“部署网关”。任务 `bark-auto-title-gateway-20261023` 已登记；来源 main 基线为 `8f174ba70c28154b3ac04d72049dc000a02c4f5d`，复用已附加独立 worktree，保持主工作区无关改动。仓库外证据目录为 `~/Library/Application Support/ReleaseCoordinator/validations/codex-mobile-20261023-bark-auto-title-gateway/`。

TDD 已在修复阶段完成：两项新时序回归先失败，修复后9文件195项回归和七种真实本机网关／HTTP Bark 时序验收通过；125秒超时、失败、关闭清理及订阅注销已有覆盖。原始证据在 `~/Library/Application Support/CodexMobile/validations/bark-await-auto-title-20261023/`，失败历史保留。本轮若发现新缺陷，先补失败回归再最小修复，不覆盖失败批次或临时改生产文件。

## 任务一：准备来源与部署门禁

**文件：** 修改本计划、`docs/interaction-alignment.md`；四项检查与来源绑定写入仓库外 `validation.json`。

- [x] 登记唯一网关任务、确认现役协调器健康、复用独立 worktree并开始30秒 heartbeat。
- [x] 记录部署前实际进程、部署 marker及server/bin/manifest/frontend摘要，核对固定客户端渠道仍为0.3.31；不输出访问口令或私有配置。
- [x] 执行 `python3 -B -m unittest discover -s tests/ci -p 'test_*.py'`，记录 adapter-regression；217项通过。
- [x] 在 `/Users/zhongtian/WorkSpace/release-coordinator` 执行 `python3 -B -m unittest discover -s tests -p 'test_*.py'`，记录 coordinator-recovery；59项通过。
- [x] 执行 `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ci --maxWorkers=2 --testTimeout=60000`，记录 build-contract；21文件144项通过。
- [x] 执行 `npm run typecheck && npm run build:server`，记录 typecheck及服务端构建；两条命令均通过，未运行客户端Web/APK/IPA构建或签名。
- [x] 引用已通过的195项回归和七场景证据，逐字节绑定本次5个运行文件；补测已发布客户端不发送automatic标记时，成功命名解除等待、失败按125秒超时通知的兼容路径。
- [x] 更新部署进行中状态，中文 Conventional Commit并推送固定来源分支；validation.json绑定完整来源SHA和四项真实passed、命令、时间、退出码、日志与SHA-256。
- [ ] 来源规格审查通过后完成质量审查，解决阻塞意见才ready。

四项门禁均在运行源码 `8f174ba70c28154b3ac04d72049dc000a02c4f5d` 上执行，真实退出码均为0；日志、起止时间、计数及SHA-256保存在本轮仓库外证据目录。继承证据的七份日志散列与原清单一致，5个运行文件与上述来源逐字节一致，初次整合握手失败日志继续保留。门禁之后只更新本计划及交互约定，最终部署来源读取 `validation.json.sourceCommit`；不将文档提交视为运行代码变更或重新运行已成功的功能／UI测试。

部署前指纹记录现役网关来源 `264eab100def5b46d7d86303ce45894a877ae003`、launchd PID `73987`，部署入口与已安装server/bin/manifest相符，frontend、启动脚本与环境文件摘要已留存；固定APK／IPA均为0.3.31。`gateway-before.json` 与 `channels-before.json` 只保存脱敏结果，不在文档复制私有配置。

现役0.3.31请求格式兼容探测真实退出码0：不发送 `automatic` 字段时，四种自动命名成功场景均在保存后收到新名称，手动候选未保存保持现有名，总结失败约125秒后使用现有名通知；六场景均只通知一次。`legacy-compatibility.json`、`legacy-before/ordering-results.json` 与 `legacy-before.log` 保留摘要、事件及真实HTTP记录。探测只使用隔离app-server及本机网关／Bark接收端，未访问生产网关、用户手机或真实模型。

## 任务二：现役协调器部署

**文件：** 协调器生成冻结清单和持久receipt；任务只保存仓库外状态与摘要。

- [ ] 从任务一validation读取实际sourceCommit，执行下方实际命令；不手改版本、冻结清单或生产安装目录。
- [ ] 以最多45秒一次的定向wait跟踪prepare/main/gateway/verify；只报告阶段变化，真实失败保留现场并只关联最新失败叶节点修复。
- [ ] 核对任务与批次complete、error为null、来源包含、冻结SHA、gateway摘要和运行PID、冻结开发CI成功；网关清单CI应跳过客户端构建及Release。
- [ ] 先完成成功receipt规格审查，再完成质量审查；不将客户端参数或UI一并宣称发布。

```bash
python3 - <<'PY'
import json
from pathlib import Path
import subprocess

validation = Path.home() / 'Library/Application Support/ReleaseCoordinator/validations/codex-mobile-20261023-bark-auto-title-gateway/validation.json'
source = json.loads(validation.read_text())['sourceCommit']
subprocess.run([
    str(Path.home() / '.local/bin/releasectl'),
    'ready', '--task', 'bark-auto-title-gateway-20261023',
    '--sha', source, '--validation', str(validation),
], check=True)
PY
```

## 任务三：独立回验与文档收尾

**文件：** 修改本计划、`README.md`、`docs/README.md`、`docs/interaction-alignment.md`；新增 `docs/superpowers/plans/evidence/2026-10-23-bark-auto-title-gateway-deploy.json`。

- [ ] 独立核对实际launchd PID、进程命令、认证健康接口、部署marker及server/bin/manifest/frontend摘要，匹配同一成功receipt；确认前端与启动配置未被替换。
- [ ] 使用实际部署模块在本机隔离app-server／Bark接收端核对新名称等待及旧客户端请求格式；不向用户手机推送或创建真实会话。
- [ ] 固定APK/IPA仍为部署前0.3.31及原大小/散列，明确本轮无客户端构建、签名、渠道更新或网关外部署。
- [ ] 以字段白名单保存公共凭证，同步现役网关状态及兼容边界：旧客户端成功保存可解除等待，缺少automatic标记时的失败由125秒超时释放；客户端新标记尚待后续发布。
- [ ] 文档规格、质量及整体收尾审查通过后，在共享main锁内核对最新远端并提交推送；纯文档不重跑正式部署。
- [ ] 最终答复部署结果、已生效范围与客户端未更新的边界，不提供旧安装包冒充本次产物。
