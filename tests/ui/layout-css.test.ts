import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

describe("悬浮状态布局", () => {
  it("页面主容器为旧版 WebView 提供 vh 回退并由 dvh 覆盖", () => {
    const appShellRule =
      styles.match(/\.app-shell\s*\{([^}]*)\}/)?.[1] ?? "";
    const threadListRule =
      styles.match(/\.thread-list-page\s*\{([^}]*)\}/)?.[1] ?? "";
    const conversationRule =
      styles.match(/\.conversation\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(appShellRule).toMatch(/min-height:\s*100vh;.*min-height:\s*100dvh;/);
    expect(threadListRule).toMatch(/height:\s*100vh;.*height:\s*100dvh;/);
    expect(threadListRule).toMatch(
      /min-height:\s*100vh;.*min-height:\s*100dvh;/,
    );
    expect(conversationRule).toMatch(/height:\s*100vh;.*height:\s*100dvh;/);
  });

  it("会话列表头部和机器选项使用同一个 sticky 容器", () => {
    const stickyRule =
      styles.match(/\.thread-list-sticky\s*\{([^}]*)\}/)?.[1] ?? "";
    const headerRule =
      styles.match(/\.list-header\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(stickyRule).toContain("position: sticky");
    expect(stickyRule).toContain("top: 0");
    expect(headerRule).not.toContain("position: fixed");
  });

  it("待审批通知固定在 Header 下方且不再依赖页面底部", () => {
    const rule = styles.match(/\.backend-attention\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(rule).toContain("position: fixed");
    expect(rule).toContain("top:");
    expect(rule).not.toContain("bottom:");
  });

  it("对话详情顶部三个按钮使用紧凑尺寸", () => {
    const headerRule =
      styles.match(/(?:^|\n)\.conversation-header\s*\{([^}]*)\}/)?.[1] ?? "";
    const buttonRule =
      styles.match(
        /(?:^|\n)\.conversation-header \.round-button\s*\{([^}]*)\}/,
      )?.[1] ?? "";
    const iconRule =
      styles.match(
        /(?:^|\n)\.conversation-header \.round-button svg\s*\{([^}]*)\}/,
      )?.[1] ?? "";
    const contextRule =
      styles.match(/(?:^|\n)\.context-usage-button\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(headerRule).toContain("min-height: 60px");
    expect(buttonRule).toContain("width: 44px");
    expect(buttonRule).toContain("height: 44px");
    expect(iconRule).toContain("width: 23px");
    expect(iconRule).toContain("height: 23px");
    expect(contextRule).toContain("width: 44px");
    expect(contextRule).toContain("height: 44px");
  });

  it("对话详情右上角两个按钮共用无分割线胶囊容器", () => {
    const groupRule =
      styles.match(
        /(?:^|\n)\.conversation-header-actions\s*\{([^}]*)\}/,
      )?.[1] ?? "";
    const buttonRule =
      styles.match(
        /(?:^|\n)\.conversation-header-actions > button\s*\{([^}]*)\}/,
      )?.[1] ?? "";

    expect(groupRule).toContain("width: 88px");
    expect(groupRule).toContain("height: 44px");
    expect(groupRule).toContain("border-radius: 22px");
    expect(groupRule).toContain("background: #f7f7f7");
    expect(buttonRule).toContain("background: transparent");
    expect(buttonRule).not.toContain("border-left");
    expect(buttonRule).not.toContain("border-right");
  });

  it("自动化发送标签位于用户气泡上方并右对齐", () => {
    const labelRule =
      styles.match(
        /(?:^|\n)\.automation-message-label\s*\{([^}]*)\}/,
      )?.[1] ?? "";

    expect(labelRule).toContain("display: block");
    expect(labelRule).toContain("margin:");
    expect(labelRule).toContain("auto");
    expect(labelRule).toContain("color: #777");
    expect(labelRule).toContain("font-size: 12px");
  });

  it("复制按钮使用轻量线框图标，代码块入口保持紧凑", () => {
    const iconRule =
      styles.match(
        /(?:^|\n)\.copy-action > button svg\s*\{([^}]*)\}/,
      )?.[1] ?? "";
    const codeButtonRule =
      styles.match(
        /(?:^|\n)\.code-block-copy > button\s*\{([^}]*)\}/,
      )?.[1] ?? "";
    const codeIconRule =
      styles.match(
        /(?:^|\n)\.code-block-copy > button svg\s*\{([^}]*)\}/,
      )?.[1] ?? "";
    const responseRule =
      styles.match(
        /(?:^|\n)\.turn-responses\s*\{([^}]*)\}/,
      )?.[1] ?? "";
    const messageCopyRule =
      styles.match(
        /(?:^|\n)\.turn-message-copy\s*\{([^}]*)\}/,
      )?.[1] ?? "";
    const messageCopyButtonRule =
      styles.match(
        /(?:^|\n)\.turn-message-copy > button\s*\{([^}]*)\}/,
      )?.[1] ?? "";

    expect(iconRule).toContain("fill: none");
    expect(iconRule).toContain("stroke: currentColor");
    expect(responseRule).toContain("position: relative");
    expect(messageCopyRule).toContain("position: absolute");
    expect(messageCopyRule).toContain("top: calc(100% + 2px)");
    expect(messageCopyButtonRule).toContain("width: 24px");
    expect(messageCopyButtonRule).toContain("height: 24px");
    expect(codeButtonRule).toContain("width: 24px");
    expect(codeButtonRule).toContain("height: 24px");
    expect(codeButtonRule).toContain("background: transparent");
    expect(codeIconRule).toContain("width: 14px");
    expect(codeIconRule).toContain("height: 14px");
  });

  it("过程消息折叠时为横线下方的最终回复保留展开态同等间距", () => {
    const collapsedSpacingRule =
      styles.match(
        /(?:^|\n)\.previous-messages-toggle\[aria-expanded="false"\] \+ \.assistant-message\s*\{([^}]*)\}/,
      )?.[1] ?? "";

    expect(collapsedSpacingRule).toContain("margin-top: 17px");
  });

  it("待处理的追加消息悬浮在输入区上方并保持单行省略", () => {
    const stackRule =
      styles.match(
        /(?:^|\n)\.composer-follow-up-stack\s*\{([^}]*)\}/,
      )?.[1] ?? "";
    const rule =
      styles.match(
        /(?:^|\n)\.pending-steer-message\s*\{([^}]*)\}/,
      )?.[1] ?? "";

    expect(stackRule).toContain("position: absolute");
    expect(stackRule).toContain("bottom: calc(100% + 3px)");
    expect(rule).toContain("overflow: hidden");
    expect(rule).toContain("text-overflow: ellipsis");
    expect(rule).toContain("white-space: nowrap");
  });

  it("短用户消息气泡按内容收缩，不占满最大宽度", () => {
    const rule =
      styles.match(/(?:^|\n)\.user-bubble\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(rule).toContain("width: fit-content");
    expect(rule).toContain("max-width: 82%");
  });

  it("流式字符提示使用清晰的旋转圆环 Loading", () => {
    const ringRule =
      styles.match(
        /(?:^|\n)\.stream-character-spinner\s*\{([^}]*)\}/,
      )?.[1] ?? "";

    expect(ringRule).toContain("background: conic-gradient(");
    expect(ringRule).toContain("#929292");
    expect(ringRule).toContain("#cecece");
    expect(ringRule).toContain("mask:");
    expect(ringRule).toContain("animation: stream-receiving");
    expect(styles).not.toContain(".stream-character-spinner::after");
    expect(styles).toContain("@keyframes stream-receiving");
    expect(styles).toContain(
      "@media (prefers-reduced-motion: reduce) { .stream-character-spinner { animation: none; } }",
    );
  });

  it("任务运行时的停止按钮显示旋转光带并尊重减少动态效果设置", () => {
    expect(styles).toContain(".send-button-running::before");
    expect(styles).toContain("animation: composer-running-spin");
    expect(styles).toContain(
      "@media (prefers-reduced-motion: reduce) { .send-button-running::before { animation: none; } }",
    );
  });

  it("App 下载进度条使用中性灰而不是绿色", () => {
    const progressRule =
      styles.match(
        /(?:^|\n)\.app-update-progress i\s*\{([^}]*)\}/,
      )?.[1] ?? "";

    expect(progressRule).toContain(
      "background: linear-gradient(90deg, #d6d6d6, #bdbdbd)",
    );
    expect(progressRule).not.toContain("#d4f2da");
  });

  it("图片预览由应用接管双指缩放和拖动手势", () => {
    const stageRule =
      styles.match(/(?:^|\n)\.image-preview-stage\s*\{([^}]*)\}/)?.[1] ??
      "";
    const imageRule =
      styles.match(
        /(?:^|\n)\.image-preview-stage img\s*\{([^}]*)\}/,
      )?.[1] ?? "";

    expect(stageRule).toContain("touch-action: none");
    expect(stageRule).toContain("overflow: hidden");
    expect(imageRule).toContain("will-change: transform");
    const bodyRule =
      styles.match(
        /(?:^|\n)\.image-preview-sheet \.action-sheet-body\s*\{([^}]*)\}/,
      )?.[1] ?? "";
    expect(bodyRule).toContain("overflow-y: auto");
  });

  it("视频预览保持原始宽高比且不会裁掉原生控制栏", () => {
    const stageRule =
      styles.match(/(?:^|\n)\.video-preview-stage\s*\{([^}]*)\}/)?.[1] ??
      "";
    const videoRule =
      styles.match(
        /(?:^|\n)\.video-preview-stage video\s*\{([^}]*)\}/,
      )?.[1] ?? "";
    expect(stageRule).toContain("overflow: visible");
    expect(stageRule).not.toContain("padding-bottom:");
    expect(videoRule).toContain("width: auto");
    expect(videoRule).toContain("height: auto");
    expect(videoRule).toContain("max-width: 100%");
    expect(videoRule).toContain("max-height: min(60dvh, 640px)");
    expect(videoRule).not.toContain("border-radius:");
    expect(styles).not.toContain("video-preview-media-ready");
  });

  it("ActionSheet 统一裁剪圆角且只让中间内容滚动", () => {
    const sheetRule =
      styles.match(/(?:^|\n)\.action-sheet\s*\{([^}]*)\}/)?.[1] ?? "";
    const headerRule =
      styles.match(
        /(?:^|\n)\.action-sheet-header\s*\{([^}]*)\}/,
      )?.[1] ?? "";
    const bodyRule =
      styles.match(/(?:^|\n)\.action-sheet-body\s*\{([^}]*)\}/)?.[1] ?? "";
    const footerRule =
      styles.match(
        /(?:^|\n)\.action-sheet-footer\s*\{([^}]*)\}/,
      )?.[1] ?? "";

    expect(sheetRule).toContain("overflow: hidden");
    expect(sheetRule).toContain("isolation: isolate");
    expect(sheetRule).toContain("border-radius: 30px 30px 0 0");
    expect(sheetRule).toContain("clip-path: inset(0 round 30px 30px 0 0)");
    expect(sheetRule).toContain("display: flex");
    expect(headerRule).toContain("flex: 0 0 auto");
    expect(bodyRule).toContain("min-height: 0");
    expect(bodyRule).toContain("overflow-y: auto");
    expect(footerRule).toContain("flex: 0 0 auto");
  });

  it("普通手机浏览器保留边缘间距且原生输入栏保留独立缝隙", () => {
    const rootRule =
      styles.match(/(?:^|\n):root\s*\{([^}]*)\}/)?.[1] ?? "";
    const nativeRule =
      styles.match(/(?:^|\n)html\.native-webview\s*\{([^}]*)\}/)?.[1] ?? "";
    const threadListRule =
      styles.match(/(?:^|\n)\.thread-list-page\s*\{([^}]*)\}/)?.[1] ?? "";
    const listActionsRule =
      styles.match(/(?:^|\n)\.list-actions\s*\{([^}]*)\}/)?.[1] ?? "";
    const searchBoxRule =
      styles.match(/(?:^|\n)\.search-box\s*\{([^}]*)\}/)?.[1] ?? "";
    const searchInputRule =
      styles.match(/(?:^|\n)\.search-box input\s*\{([^}]*)\}/)?.[1] ?? "";
    const timelineRule =
      styles.match(/(?:^|\n)\.timeline\s*\{([^}]*)\}/)?.[1] ?? "";
    const composerRule =
      styles.match(/(?:^|\n)\.composer-wrap\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(rootRule).toContain("--browser-edge-top: 8px");
    expect(rootRule).toContain("--browser-edge-bottom: 8px");
    expect(rootRule).toContain(
      "--input-bar-bottom-offset: max(var(--browser-edge-bottom), 8px)",
    );
    expect(nativeRule).toContain("--browser-edge-top: 0px");
    expect(nativeRule).toContain("--browser-edge-bottom: 0px");
    expect(styles).not.toContain(
      "@media (min-width: 721px) { :root { --browser-edge-top: 0px; --browser-edge-bottom: 0px; } }",
    );
    expect(threadListRule).toContain(
      "padding: 0 16px calc(58px + var(--input-bar-bottom-offset))",
    );
    expect(listActionsRule).toContain(
      "inset: auto 0 var(--input-bar-bottom-offset)",
    );
    expect(listActionsRule).toContain("padding: 8px 16px 0");
    expect(searchBoxRule).toContain("background: #f4f4f4");
    expect(searchInputRule).toContain("background: #f4f4f4");
    expect(timelineRule).toContain(
      "padding: 22px 0 calc(105px + var(--input-bar-bottom-offset))",
    );
    expect(composerRule).toContain("bottom: var(--input-bar-bottom-offset)");
    expect(composerRule).toContain("margin: 0");
    expect(composerRule).toContain("padding: 8px 10px 0");
  });

  it("侧边栏面板与遮罩使用同一套展开动效", () => {
    const layerRule =
      styles.match(
        /(?:^|\n)\.conversation-sidebar-layer\s*\{([^}]*)\}/,
      )?.[1] ?? "";
    const sidebarRule =
      styles.match(
        /(?:^|\n)\.conversation-sidebar\s*\{([^}]*)\}/,
      )?.[1] ?? "";
    const scrimRule =
      styles.match(
        /(?:^|\n)\.conversation-sidebar-scrim\s*\{([^}]*)\}/,
      )?.[1] ?? "";
    const draggingRule =
      styles.match(
        /(?:^|\n)\.conversation-sidebar-layer\.dragging\s*\{([^}]*)\}/,
      )?.[1] ?? "";
    const draggingSidebarRule =
      styles.match(
        /(?:^|\n)\.conversation-sidebar-layer\.dragging \.conversation-sidebar\s*\{([^}]*)\}/,
      )?.[1] ?? "";
    const closingSidebarRule =
      styles.match(
        /(?:^|\n)\.conversation-sidebar-layer\.open\.dragging \.conversation-sidebar\s*\{([^}]*)\}/,
      )?.[1] ?? "";
    const draggingScrimRule =
      styles.match(
        /(?:^|\n)\.conversation-sidebar-layer\.dragging \.conversation-sidebar-scrim\s*\{([^}]*)\}/,
      )?.[1] ?? "";

    expect(layerRule).toContain("--sidebar-motion-duration: .24s");
    expect(layerRule).toContain(
      "--sidebar-motion-easing: cubic-bezier(.22,.7,.2,1)",
    );
    expect(sidebarRule).toContain(
      "transition: transform var(--sidebar-motion-duration) var(--sidebar-motion-easing)",
    );
    expect(sidebarRule).toContain("z-index: 1");
    expect(scrimRule).toContain("inset: 0");
    expect(scrimRule).toContain(
      "transition: opacity var(--sidebar-motion-duration) var(--sidebar-motion-easing)",
    );
    expect(draggingRule).toContain("visibility: visible");
    expect(draggingSidebarRule).toContain("var(--sidebar-drag-x)");
    expect(draggingSidebarRule).toContain("transition: none");
    expect(closingSidebarRule).toContain("translateX(var(--sidebar-drag-x))");
    expect(closingSidebarRule).toContain("transition: none");
    expect(draggingScrimRule).toContain("var(--sidebar-drag-progress)");
    expect(draggingScrimRule).toContain("transition: none");
  });

});
