# GPT-6-Luna 标题总结网关部署计划

> **执行代理须知：** 使用 superpowers:subagent-driven-development 执行本计划的单个部署任务，完成后依次进行独立规格审查和质量／整体审查。步骤以复选框跟踪。

**目标：** 将标题总结固定使用 `gpt-6-luna`、`low` 和 Fast（`serviceTier: priority`）的已验证源码部署到现役网关。

**架构：** 复用现有 `releasectl`、`codex-mobile-gateway-production` 目标与 `codex-mobile-main-production` 共享锁。协调器整合和冻结来源，构建服务端并更新现有安装；保留前端、依赖及启动配置。本轮仅部署网关，不发布客户端或修改普通会话默认配置。

**技术栈：** TypeScript、Vitest、Python unittest、WebSocket、HTTP、launchd、GitHub Actions 和现役发布协调器。

---

用户已明确要求部署网关。任务 `title-luna-gateway-20261023` 已登记，主代理已开始30秒 heartbeat。使用现有隔离工作区 `/Users/zhongtian/.codex/worktrees/conversation-title/codex-mobile`、分支 `fix/title-summary-gpt6-luna-20261023`；不改主工作区。起始 main 为 `f12a901790b5cd986bf357f91d4f0981824e099b`。

TDD已在源码阶段完成：先新增协议断言，真实运行出现3项缺少模型／强度／Fast参数的失败；最小修复后3文件73项标题总结、自动名称等待及Bark回归、服务端构建均通过。证据位于 `~/Library/Application Support/CodexMobile/validations/title-summary-gpt6-luna-20261023/`，保留red日志。上游只读模型目录确认 `gpt-6-luna` 支持low及priority Fast。部署过程中若发现新运行缺陷，须先补失败回归再修复，不覆盖失败证据。

## 任务一：部署、独立回验与源码收尾

**文件：** 本计划及 `docs/interaction-alignment.md` 记录部署准备；部署完成后同步 `README.md`、`docs/README.md`、交互约定和本计划，新增公共凭证 `docs/superpowers/plans/evidence/2026-10-23-title-luna-gateway-deploy.json`。运行源码不再修改。原始状态、日志、探测脚本和receipt摘要只保存在仓库外目录 `~/Library/Application Support/ReleaseCoordinator/validations/codex-mobile-20261023-title-luna-gateway/`。

- [x] 确认现役协调器0.1.7健康，登记唯一网关任务并复用隔离工作区，记录main基线。
- [x] 记录部署前PID、实际入口、认证健康、marker、server/bin/manifest/frontend及启动文件摘要；只读保存固定APK／IPA清单版本、大小和散列，不输出私有环境或口令。
- [x] 执行四项真实门禁，保存命令、时间、退出码、日志与SHA-256；全部退出0后才准备ready。

```bash
python3 -B -m unittest discover -s tests/ci -p 'test_*.py'
# 名称 adapter-regression；预期217项成功。

cd /Users/zhongtian/WorkSpace/release-coordinator
python3 -B -m unittest discover -s tests -p 'test_*.py'
# 名称 coordinator-recovery；预期59项成功。

cd /Users/zhongtian/.codex/worktrees/conversation-title/codex-mobile
NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ci --maxWorkers=2 --testTimeout=60000
# 名称 build-contract；预期21文件144项成功。
npm run typecheck && npm run build:server
# 名称 typecheck；两条命令退出0，不运行客户端Web/APK/IPA构建。
```

- [x] 核对现有TDD及73项回归的日志散列；以下命令退出0证明本轮所有服务端源码和相关测试与已验证来源一致，复用已通过的功能回归。

```bash
git diff --exit-code f12a901790b5cd986bf357f91d4f0981824e099b -- server tests/server/title-summaries.test.ts tests/server/automatic-thread-names.test.ts tests/server/bark-notifications.test.ts
```

- [x] 更新部署进行中状态，按中文Conventional Commits提交并推送准备来源分支；仓库外 `validation.json` 绑定完整来源SHA及四门禁证据，不改版本、客户端日志或冻结清单。
- [ ] 从实际validation读取来源并提交ready。此后由协调器负责正式main、构建与部署，不直接修改生产安装目录或重复重启。

```bash
python3 - <<'PY'
import json
from pathlib import Path
import subprocess
validation = Path.home() / 'Library/Application Support/ReleaseCoordinator/validations/codex-mobile-20261023-title-luna-gateway/validation.json'
source = json.loads(validation.read_text())['sourceCommit']
subprocess.run([str(Path.home() / '.local/bin/releasectl'), 'ready', '--task', 'title-luna-gateway-20261023', '--sha', source, '--validation', str(validation)], check=True)
PY
```

- [ ] 每次最多45秒定向wait，状态不变时退避；实际失败保留批次和错误，只关联最新失败叶节点修复，不resume失败或更改冻结身份。
- [ ] 核对task／batch complete、error为空，prepare/main/gateway/verify齐全；持久receipt与状态receipt一致，来源在frozen tasks及verify任务中、并为冻结祖先。
- [ ] 核对同冻结SHA开发CI成功；清单CI成功且客户端build／Release均skipped，网关批次无App版本分配。
- [ ] 独立核对实际PID、命令、监听及认证健康、marker和四类文件摘要与成功receipt匹配；前端与启动配置相对部署前不变。
- [ ] 从**实际安装的** `npm-dist/server/gateway.js` 导入createGateway，在本机隔离app-server／HTTP环境分别请求手动和automatic标题总结。协议替身返回一页用户消息、独立ephemeral临时会话及JSON标题；捕获thread/start和turn/start，断言两次均指定 `model: gpt-6-luna`、`serviceTier: priority`，临时会话配置 `model_reasoning_effort: low`、回合 `effort: low`；断言只总结原用户消息、未调用原会话改名或全局配置写入。保存真实退出码、结果、脚本／日志散列及安装模块散列。探测只访问随机回环端口与临时状态，结束关闭并清理，不调用真实模型或用户Bark，不创建真实远端会话。
- [ ] 只读核对固定APK／IPA仍与本轮部署前清单版本、大小、散列一致；本任务未构建、签名或发布客户端。不得把后续并行发布的变化冒记成本任务产物。
- [ ] 用白名单公共JSON保存批次、来源、冻结、receipt摘要、CI、运行与参数探测结果；README和交互约定将该固定模型配置更新为已部署，保留普通默认设置与真机验收边界。公共凭证不得含口令、私有路径或完整环境。
- [ ] 仅文档检查通过后提交并推送工作分支，等待独立规格审查，再进行质量／整轮审查；结果未返回前保持pending。
- [ ] 两段审查通过后，在共享main锁内fetch并整合最新main，必要时对整合结果做相关回归；完成纯状态收尾并以非force方式推送main，回读完整SHA。保留被保护的worktree。
- [ ] 最终答复实际部署生效的模型、low与Fast及验证边界；本轮不提供旧安装包冒充新产物。
