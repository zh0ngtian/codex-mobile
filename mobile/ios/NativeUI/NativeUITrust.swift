import Foundation

/// 注入、收取与派发使用相同的内置首页边界；不允许其他 file: 文档取得桥。
enum NativeUITrust {
    static func accepts(_ candidate: URL?, trustedURL: URL) -> Bool {
        guard let candidate, candidate.isFileURL, trustedURL.isFileURL,
              candidate.query == nil, candidate.fragment == nil,
              candidate.user == nil, candidate.password == nil else { return false }
        return candidate.standardizedFileURL == trustedURL.standardizedFileURL
    }

    static let script = """
    (() => {
      const trustedURL = __CODEX_TRUSTED_URL__;
      if (window !== window.top || location.protocol !== "file:" || new URL(location.href).href !== new URL(trustedURL).href) return;
      window.__CODEX_IOS_HOST__ = true;
      window.__CODEX_NATIVE_UI__ = __CODEX_NATIVE_ENABLED__;
      window.__CODEX_NATIVE_ACTIVE__ = true;
      window.codexMobileUseLegacyRecovery = function() {
        if (window !== window.top || location.protocol !== "file:" || new URL(location.href).href !== new URL(trustedURL).href) return;
        window.__CODEX_NATIVE_UI_RECOVERED__ = true;
        window.dispatchEvent(new Event("codex-mobile-native-recovery"));
      };
      window.codexMobileSetNativeActive = function(active) {
        if (window !== window.top || location.protocol !== "file:" || new URL(location.href).href !== new URL(trustedURL).href) return;
        window.__CODEX_NATIVE_ACTIVE__ = active === true;
        document.dispatchEvent(new Event("visibilitychange"));
        if (active === true) window.dispatchEvent(new Event("focus"));
      };
      window.codexMobileNativeCommand = function(command) {
        window.dispatchEvent(new CustomEvent("codex-mobile-native-command", {detail: command}));
      };
      window.codexMobilePublishNativeSnapshot = function(snapshot) {
        window.webkit.messageHandlers.nativeUI.postMessage({type: "snapshot", snapshot: snapshot});
      };
      const qrRequests = new Map();
      let qrSequence = 0;
      window.codexMobileScanGatewayQr = () => new Promise((resolve, reject) => {
        const id = 'qr-' + Date.now().toString(36) + '-' + (++qrSequence);
        qrRequests.set(id, {resolve, reject});
        try { window.webkit.messageHandlers.nativeUI.postMessage({type: "scanQR", id}); }
        catch (error) { qrRequests.delete(id); reject(error); }
      });
      window.codexMobileQRComplete = result => {
        const pending = qrRequests.get(result.id);
        if (!pending) return;
        qrRequests.delete(result.id);
        if (result.error) pending.reject(new Error(result.error));
        else if (typeof result.value === 'string') pending.resolve(result.value);
        else pending.reject(new Error('二维码数据无效'));
      };
      window.webkit?.messageHandlers?.nativeUI?.postMessage({type: "ready"});
    })();
    """

    static func bootstrap(trustedURL: URL, enabled: Bool) -> String? {
        guard let encodedURL = json(trustedURL.standardizedFileURL.absoluteString) else { return nil }
        return script.replacingOccurrences(of: "__CODEX_NATIVE_ENABLED__", with: enabled ? "true" : "false")
            .replacingOccurrences(of: "__CODEX_TRUSTED_URL__", with: encodedURL)
    }

    static func dispatch(_ command: NativeCommand, trustedURL: URL) -> String? {
        guard let encodedURL = json(trustedURL.standardizedFileURL.absoluteString),
              let encodedCommand = json(command) else { return nil }
        // 在实际执行 JS 的时刻再次核对 URL，覆盖原生检查后导航发生变化的窗口。
        return """
        (() => {
          const trustedURL = \(encodedURL);
          if (window !== window.top || location.protocol !== "file:" || new URL(location.href).href !== new URL(trustedURL).href) return;
          window.codexMobileNativeCommand(\(encodedCommand));
        })();
        """
    }
    static func lifecycle(active: Bool, trustedURL: URL) -> String? {
        guard let encodedURL = json(trustedURL.standardizedFileURL.absoluteString) else { return nil }
        return """
        (() => {
          if (window !== window.top || location.protocol !== "file:" || new URL(location.href).href !== new URL(\(encodedURL)).href) return;
          window.codexMobileSetNativeActive?.(\(active ? "true" : "false"));
        })();
        """
    }

    static func completeQR(id: String, value: String?, error: String?, trustedURL: URL) -> String? {
        let payload: [String: NativeJSONValue] = ["id": .string(id), "value": value.map(NativeJSONValue.string) ?? .null, "error": error.map(NativeJSONValue.string) ?? .null]
        guard let encodedURL = json(trustedURL.standardizedFileURL.absoluteString), let encoded = json(payload) else { return nil }
        return """
        (() => {
          if (window !== window.top || location.protocol !== "file:" || new URL(location.href).href !== new URL(\(encodedURL)).href) return;
          window.codexMobileQRComplete?.(\(encoded));
        })();
        """
    }

    static func recoverLegacy(trustedURL: URL) -> String? {
        guard let encodedURL = json(trustedURL.standardizedFileURL.absoluteString) else { return nil }
        return """
        (() => {
          if (window !== window.top || location.protocol !== "file:" || new URL(location.href).href !== new URL(\(encodedURL)).href) return;
          window.codexMobileUseLegacyRecovery?.();
        })();
        """
    }

    static func completePreference(id: String, enabled: Bool, active: Bool, error: String?, trustedURL: URL) -> String? {
        let payload: [String: NativeJSONValue] = ["id": .string(id), "enabled": .bool(enabled), "active": .bool(active), "error": error.map(NativeJSONValue.string) ?? .null]
        guard let encodedURL = json(trustedURL.standardizedFileURL.absoluteString), let encoded = json(payload) else { return nil }
        return """
        (() => {
          if (window !== window.top || location.protocol !== "file:" || new URL(location.href).href !== new URL(\(encodedURL)).href) return;
          window.codexMobileNativePreferenceComplete?.(\(encoded));
        })();
        """
    }

    private static func json<T: Encodable>(_ value: T) -> String? {
        guard let data = try? JSONEncoder().encode(value) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
