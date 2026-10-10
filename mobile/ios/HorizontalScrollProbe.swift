import UIKit
import WebKit

// 仅由模拟器 UI 测试工程加载；使用打包后的真实 CSS，不访问网关或创建会话。
final class HorizontalScrollProbeWebView: CodexMobileWebView {
    private let probe = UILabel()
    private var timer: Timer?
    private var maximumNativeX: CGFloat = 0

    override func didMoveToWindow() {
        super.didMoveToWindow()
        guard window != nil, timer == nil else { return }
        probe.frame = CGRect(x: 0, y: 80, width: 1, height: 1)
        probe.isAccessibilityElement = true
        probe.accessibilityIdentifier = "codex.horizontal-scroll-state"
        probe.accessibilityLabel = "{}"
        window?.addSubview(probe)
        let timer = Timer(timeInterval: 0.02, repeats: true) { [weak self] _ in
            guard let self else { return }
            self.maximumNativeX = max(self.maximumNativeX, abs(self.scrollView.contentOffset.x))
            self.evaluateJavaScript("""
            (() => { const s = document.querySelector('.conversation-scroll');
              return s ? {x:window.__maxX || 0, y:s.scrollTop,
                overflow:s.scrollWidth - s.clientWidth} : null; })()
            """) { [weak self] result, _ in
                guard let self, var value = result as? [String: Any] else { return }
                value["nativeX"] = self.maximumNativeX
                guard let data = try? JSONSerialization.data(withJSONObject: value),
                      let label = String(data: data, encoding: .utf8) else { return }
                self.probe.accessibilityLabel = label
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    override func loadFileURL(_ url: URL, allowingReadAccessTo readAccessURL: URL) -> WKNavigation? {
        let directory = url.deletingLastPathComponent()
        let files = (FileManager.default.enumerator(at: directory, includingPropertiesForKeys: nil)?.allObjects as? [URL]) ?? []
        let css = files.filter { $0.pathExtension == "css" }.compactMap { try? String(contentsOf: $0, encoding: .utf8) }.joined(separator: "\n")
        let html = """
        <!doctype html><html style="--app-font-scale:1.25"><head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>\(css)</style></head><body><div id="root">
        <main class="conversation" style="width:280px">
          <header class="conversation-header">历史编辑横向滚动验收</header>
          <div class="conversation-scroll"><div class="timeline">
            <div class="user-message"><div class="user-bubble user-bubble-editing">
              <div class="history-message-editor"><textarea aria-label="编辑历史消息内容">历史原文</textarea>
                <small>编辑后会重试此消息</small><div class="history-message-editor-actions">
                  <button>取消编辑</button><button class="primary">保存并重试</button>
                </div></div></div></div>
            <div style="height:2000px">纵向滚动内容</div>
          </div></div>
        </main></div><script>
          const s = document.querySelector('.conversation-scroll');
          function sample() { window.__maxX = Math.max(window.__maxX || 0, Math.abs(s.scrollLeft), Math.abs(scrollX)); requestAnimationFrame(sample); }
          sample();
        </script></body></html>
        """
        return super.loadHTMLString(html, baseURL: directory)
    }

    deinit { timer?.invalidate() }
}
