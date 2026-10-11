# iOS OTA 安装诊断实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 让局域网 OTA 服务能够确认手机是否请求安装页、manifest 和 IPA，支持定位“无法安装”的失败阶段。

**Architecture:** 在现有 HTTP handler 的响应日志入口输出单行 JSON 到 launchd 已有的权限 600 日志。只记录时间、客户端地址、方法、响应码和允许公开的路径；拒绝请求只记录 `[rejected]`，不输出查询参数、Header、Cookie 或凭据。诊断代码不改变 IPA 与安装协议。

**Tech Stack:** Python 标准库、unittest、launchd、现有私有 CA HTTPS。

---

### Task 1：响应可观测性

**Files:**
- Modify: `scripts/ios_ota_server.py`
- Test: `tests/ci/test_ios_ota_server.py`
- Modify: `docs/ios-ota-release.md`

- [x] 基线：`python3 -m unittest discover -s tests/ci -p test_ios_ota_server.py -q`，14 项通过。
- [x] 测试先行：真实 HTTPS 请求公开 JSON、IPA HEAD 和包含敏感查询参数的拒绝 URL，捕获 stderr；断言有 JSON 请求记录且拒绝记录不包含敏感信息。

```python
with patch.object(self.m.sys, 'stderr', output):
    with self.request('/channels/codex-mobile/current/latest-ios.json') as response:
        response.read()
    with self.assertRaises(urllib.error.HTTPError):
        self.request('/secret-password?token=secret-token')
self.assertNotIn('secret-password', output.getvalue())
self.assertNotIn('secret-token', output.getvalue())
self.assertTrue(output.getvalue())
```

- [x] 运行以上测试，确认因没有日志失败。
- [x] 在 `Handler.log_request` 中生成 `json.dumps` 记录。公开路径使用既有 allowlist；其它路径为 `[rejected]`。输出到 `sys.stderr` 并 flush。日志只表示响应开始，不声称 IPA 传输完成或安装成功。
- [x] 重跑服务全部测试，并执行 `git diff --check`。
- [x] 文档加入局域网连通性检查、日志读取命令与 USB 真机错误获取说明。
- [x] 按仓库提交规范提交并推送；合并主工作区，从长期主工作区 restart 服务，实际 HTTPS GET/HEAD 和日志交叉验证，归档测试 worktree。

### 设备排查状态

- 用户已确认 CA 完全信任；截图为系统“无法安装，请稍后再试”，状态栏显示 5G。
- 线上 0.2.125 的 IPA 验签、UDID、manifest、iPhoneOS 架构通过；尚不能从这些检查证明真机安装成功或证书未撤销。
- 等待手机访问固定 HTTPS JSON 的结果。真机目前不可连接；若网络可通仍失败，需通过 USB 连接设备取得系统安装错误，保持已有 App 数据。

### 验证结果

新增测试先失败（无日志，0 != 3），实现后服务测试 15 项通过；全部 iOS Python 测试 59 项通过。生产部署与手机重试结果由实际诊断会话继续记录，不能把日志补齐视为安装故障已经修复。
