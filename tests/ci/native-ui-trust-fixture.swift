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
        let output: [String: String] = [
            "trustedURL": trusted.absoluteString,
            "normalizedURL": normalized.absoluteString,
            "bootstrap": NativeUITrust.bootstrap(trustedURL: trusted, enabled: true)!,
            "dispatch": NativeUITrust.dispatch(command, trustedURL: trusted)!,
            "preference": NativeUITrust.completePreference(id: "switch-test", enabled: true, active: false, error: nil, trustedURL: trusted)!
        ]
        print(String(data: try JSONSerialization.data(withJSONObject: output), encoding: .utf8)!)
    }
}
