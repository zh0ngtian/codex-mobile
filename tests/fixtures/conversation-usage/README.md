# 对话用量卡片验收

使用真实 `ConversationPage` 与现役网页界面 Provider，数据只保存在当前页面内存中，不连接网关、不创建远端测试会话。

```sh
npm exec -- vite --host 127.0.0.1 --port 4187 --strictPort
```

打开 `/tests/fixtures/conversation-usage/` 后点击右上角圆圈。默认显示上下文余量 93%、周期剩余 72%、时间剩余 43%、输入 Token 100K (缓存 80%)、输出 Token 28.5K。

- `?tokens=3084000`：验证输入 3M (缓存 80%)、输出 84K。
- `?tokens=none`：验证五行缺失数据。
- `?interface=legacy`：验证传统网页入口。

正式 iOS 原生浮层使用 `NativeVisualReference` 和 `NativeUIUITests` 验证，参考模式不建立业务 WebView 或网关连接。
