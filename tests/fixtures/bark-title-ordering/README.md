# Bark 与自动会话命名顺序验收

从仓库根目录运行：

```bash
npx tsx tests/fixtures/bark-title-ordering/probe.ts "$HOME/Library/Application Support/CodexMobile/validations/bark-await-auto-title-20261023"
```

夹具启动真实网关、本机 HTTP Bark 接收端及隔离 app-server 协议替身，按客户端现有“总结接口返回候选 → `thread/name/set` 保存”顺序发请求。它不挂载客户端界面，不调用真实模型、不连接生产网关、不向用户手机推送；每个场景结束后关闭服务、删除临时状态。参数指定的仓库外目录保存事件顺序与实际接收名称。

| 场景 | 受控顺序 | 检查内容 |
| --- | --- | --- |
| name-first | 总结返回并保存后，主任务完成 | 通知采用已保存的新名称 |
| task-first | 主任务完成后，再放行总结和保存 | 通知等待保存后使用新名称 |
| task-before-summary | 主任务完成后才发起总结请求 | 创建会话时已登记等待，通知仍使用新名称 |
| save-ack-late | 总结已返回，但保存确认晚于主任务完成 | 等保存成功后再通知 |
| save-failed | 总结成功，但名称保存失败 | 使用现有名称，完成通知不丢失 |
| summary-failed | 主任务完成后，总结失败 | 保留现有名称，完成通知不丢失 |
| candidate-unsaved | 只生成候选，不执行名称保存 | 通知不能把未保存候选当正式名称 |

各场景还检查重复完成事件不会生成第二条通知。四个自动命名成功场景断言收到新名称，且 Bark 接收事件晚于名称保存；失败和手动未保存候选不采用候选名。手动候选在既有会话内操作，不登记新会话的自动命名等待。100毫秒延迟仅用于确定事件顺序，不是生产耗时测量或拟定的通知等待时间。125秒超时、旧请求迟到与关闭清理由 `tests/server/automatic-thread-names.test.ts` 的受控时钟验证。
