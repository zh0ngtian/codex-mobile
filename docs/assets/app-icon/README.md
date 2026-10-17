# 应用图标

生产图标 `codex-mobile-app-icon-1024.png` 使用用户选定的 Apple Intelligence `apple.intelligence` SF Symbol，原件保存在 `apple-intelligence-symbol-1024.png`。原件由 AppKit 直接导出，regular 字重、700px 框内居中，未经过 AI 重绘；SHA-256：`173f86a63e412af2d635f15d8ec4d8a3326cdfb8c95bb0af13b9caa08b366857`。源图为 1024×1024 RGB PNG，无 Alpha。

生产图像素须与源图完全一致。使用仓库内 sharp 离线铺白并生成默认生产 PNG：

```sh
./scripts/compose-mobile-app-icon.sh
```

系统会在应用安装时负责图标圆角裁切；源图保持完整方形，不预先添加圆角或透明边缘。素材本身没有阴影不能证明桌面图标最终没有阴影；桌面呈现仍须通过实际安装验收。本次只更新素材和生成入口，不进行构建或安装验收。
