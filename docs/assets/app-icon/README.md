# 应用图标

生产图标 `codex-mobile-app-icon-1024.png` 使用 ChatGPT 官方 iOS 图标原件生成，原件保存在 `chatgpt-official-ios-1024.png`。原件来自 [OpenAI 帮助中心的官方图标说明](https://help.openai.com/en/articles/7905742-what-does-the-official-chatgpt-ios-app-icon-look-like)，原图地址为 https://images.ctfassets.net/j22is2dtoxu1/intercom-img-d177d076c9a5453052925143/49d5d812b0a6fcc20a14faa8c629d9fb/icon-ios-1024_401x.png 。原件 SHA-256：`e799e2fa0d4149a2ec28fc595c8bfb4990bcbb478649791b42acff7cde6e805e`。

图标依据用户提供的手机截图：白色背景上的扁平黑色结形标志，没有手机叠层或立体渐变。仓库原件离线铺白生成默认生产 PNG：

```sh
./scripts/compose-mobile-app-icon.sh
```

系统会在应用安装时负责图标圆角裁切；源图保持完整方形，不预先添加圆角或透明边缘。
