import Foundation

@main
struct NativeStoreSmoke {
    @MainActor static func main() throws {
        let defaults = UserDefaults(suiteName: "CodexMobile.NativeUI.Tests")!
        defaults.removePersistentDomain(forName: "CodexMobile.NativeUI.Tests")
        let normal = NativeUIStore(arguments: [], defaults: defaults)
        precondition(!normal.nativeEnabled, "首次应默认旧界面")
        defaults.set(true, forKey: NativeUIStore.preferenceKey)
        precondition(!normal.nativeEnabled, "当前启动不能热切换")
        precondition(NativeUIStore(arguments: [], defaults: defaults).nativeEnabled)
        let reference = NativeUIStore(arguments: ["--native-ui-reference-conversation"], defaults: defaults)
        precondition(reference.snapshot.messages.count == 2)
        precondition(NativeMarkdownBlock.parse(reference.snapshot.messages[1].text).contains { $0.kind == "code" && $0.text == "print(\"Hello\")" })
        let encoded = try JSONEncoder().encode(reference.snapshot)
        let decoded = try JSONDecoder().decode(NativeSnapshot.self, from: encoded)
        precondition(decoded.version == 1 && decoded.messages.count == 2)
        reference.command("thread.new")
        precondition(reference.snapshot.messages.isEmpty)
        reference.draft = "离线草稿"
        reference.command("message.send")
        precondition(reference.snapshot.messages.first?.text == "离线草稿")
        reference.receive(decoded)
        precondition(reference.snapshot.messages.count == 1, "参考模式不能接收真实快照")
        var invalid = decoded
        invalid.version = 2
        normal.receive(invalid)
        precondition(!normal.snapshot.ready, "不能接收其他协议版本")
        let params: [String: NativeJSONValue] = ["text": .string("中文\n内容"), "nested": .object(["ok": .bool(true)]), "items": .array([.null, .number(2)])]
        let command = NativeCommand(name: "test", params: params)
        let commandRoundtrip = try JSONDecoder().decode(NativeCommand.self, from: JSONEncoder().encode(command))
        precondition(commandRoundtrip.params == params)
        defaults.removePersistentDomain(forName: "CodexMobile.NativeUI.Tests")
        print("Native store/schema/Markdown smoke passed")
    }
}
