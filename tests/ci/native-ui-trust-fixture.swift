import Foundation

@main
struct NativeUITrustFixture {
    static func main() throws {
        let trusted = URL(fileURLWithPath: "/Application Support's $workspace/中文.app/index.html")
        let command = NativeCommand(id: "trust-test", name: "draft.set", params: ["value": .string("中文引号\"和\\反斜线")])
        let normalized = trusted.deletingLastPathComponent().appendingPathComponent("assets/../index.html")
        precondition(NativeUITrust.accepts(trusted, trustedURL: trusted))
        precondition(NativeUITrust.accepts(normalized, trustedURL: trusted))
        for candidate in [
            URL(fileURLWithPath: "/private/tmp/index.html"),
            trusted.deletingLastPathComponent().appendingPathComponent("other.html"),
            URL(string: trusted.absoluteString + "?untrusted=1")!,
            URL(string: trusted.absoluteString + "#untrusted")!,
            URL(string: "https://example.com/index.html")!
        ] { precondition(!NativeUITrust.accepts(candidate, trustedURL: trusted)) }
        // Foundation 只会为真实存在的 /private 路径消除系统别名；假路径无法复现真机问题。
        let directory = URL(fileURLWithPath: "/private/tmp").appendingPathComponent("native-trust-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let app = directory.appendingPathComponent("Application Support's 中文\".app")
        try FileManager.default.createDirectory(at: app, withIntermediateDirectories: true)
        let privateTrusted = app.appendingPathComponent("index.html")
        try Data("<!doctype html>".utf8).write(to: privateTrusted)
        precondition(privateTrusted.absoluteString != privateTrusted.standardizedFileURL.absoluteString)
        precondition(NativeUITrust.accepts(privateTrusted, trustedURL: privateTrusted))
        precondition(NativeUITrust.accepts(privateTrusted.standardizedFileURL, trustedURL: privateTrusted))
        for candidate in [
            directory.appendingPathComponent("index.html"),
            app.appendingPathComponent("other.html"),
            URL(string: privateTrusted.absoluteString + "?untrusted=1")!,
            URL(string: privateTrusted.absoluteString + "#untrusted")!,
            URL(string: "https://example.com/index.html")!
        ] { precondition(!NativeUITrust.accepts(candidate, trustedURL: privateTrusted)) }
        let output: [String: Any] = [
            "private": [
                "trustedURL": privateTrusted.absoluteString,
                "standardizedURL": privateTrusted.standardizedFileURL.absoluteString,
                "bootstrap": NativeUITrust.bootstrap(trustedURL: privateTrusted, enabled: true)!,
                "composerBootstrap": NativeUITrust.bootstrap(trustedURL: privateTrusted, enabled: false, composerEnabled: true)!,
                "editorState": NativeUITrust.webTextEditorState(contextId: "中文\"\\上下文", focused: true, start: 2, end: 4, trustedURL: privateTrusted)!,
                "composerLayout": NativeUITrust.composerLayout(contextId: "中文\"\\上下文", top: 470.5, webViewHeight: 844, trustedURL: privateTrusted)!,
                "dispatch": NativeUITrust.dispatch(command, trustedURL: privateTrusted)!,
                "preference": NativeUITrust.completePreference(id: "switch-test", enabled: true, active: false, error: nil, trustedURL: privateTrusted)!,
                "lifecycleInactive": NativeUITrust.lifecycle(active: false, trustedURL: privateTrusted)!,
                "lifecycleActive": NativeUITrust.lifecycle(active: true, trustedURL: privateTrusted)!,
                "qr": NativeUITrust.completeQR(id: "qr-0-1", value: "https://gateway.example/?token=中文", error: nil, trustedURL: privateTrusted)!,
                "recovery": NativeUITrust.recoverLegacy(trustedURL: privateTrusted)!
            ],
            "trustedURL": trusted.absoluteString,
            "normalizedURL": normalized.absoluteString,
            "bootstrap": NativeUITrust.bootstrap(trustedURL: trusted, enabled: true)!,
            "dispatch": NativeUITrust.dispatch(command, trustedURL: trusted)!,
            "preference": NativeUITrust.completePreference(id: "switch-test", enabled: true, active: false, error: nil, trustedURL: trusted)!
        ]
        print(String(data: try JSONSerialization.data(withJSONObject: output), encoding: .utf8)!)
    }
}
