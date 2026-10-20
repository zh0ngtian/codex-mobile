# 应用图标

生产图标 `codex-mobile-app-icon-1024.png` 使用用户选定的 Apple Intelligence `apple.intelligence` SF Symbol Light 字重资源，原件保存在 `apple-intelligence-symbol-1024.png`。原图保持 700px 框内居中和纯白底比例，未经过 AI 重绘；SHA-256：`c3cd3925bd0edc9236a446f730ebaaaffb1dea773627fc4eb90e28c51b39d83c`。源图为 1024×1024 RGB PNG，无 Alpha。

生产图像素须与源图完全一致。使用仓库内 sharp 离线铺白并生成默认生产 PNG：

```sh
./scripts/compose-mobile-app-icon.sh
```

系统会在应用安装时负责图标圆角裁切；源图保持完整方形，不预先添加圆角或透明边缘。素材本身没有阴影不能证明桌面图标最终没有阴影；桌面呈现仍须通过实际安装验收。
