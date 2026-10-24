#if DEBUG
import UIKit

/// 显式离线动效夹具，慢回执／失败／待确认均不接触真实网关。
@MainActor enum AgentFirstMessageFixture {
    static let argument = "--agent-first-message-fixture"
    static var enabled: Bool { ProcessInfo.processInfo.arguments.contains(argument) }
    static func configure(_ value: inout NativeSnapshot) {
        value.threadId = nil; value.messages = []; value.sidebarOpen = false
        value.backendId = "conversation-ui-device"; value.contextId = "first-message-fixture"
        value.title = "新会话"; value.cwd = "/workspace/codex-mobile"; value.canSend = true; value.busy = false
        value.draft = "帮我检查新会话的发送过渡，保持机器和项目选择。"
        value.backends = [NativeBackend(id: "conversation-ui-device", title: "MacBook Pro", connected: true, projects: ["/workspace/codex-mobile", "/workspace/Design"]), NativeBackend(id: "second-device", title: "Mac mini", connected: true, projects: ["/workspace/Design"])]
        let args = ProcessInfo.processInfo.arguments
        if args.contains("--followup-message-fixture") {
            value.threadId = "existing-motion-thread"; value.title = "继续优化会话动效"
            value.messages = [NativeMessage(id: "existing-user", role: "user", text: "首条消息的动效已经确认。"),
                              NativeMessage(id: "existing-reply", role: "assistant", text: "首条发送已完成。现在检查同一会话后续消息的文字和附件过渡。", phase: "final_answer")]
            value.draft = "把后续消息的动效也补上，保留已有会话内容。"
        }
        if args.contains("--first-message-attachments") || args.contains("--first-message-attachments-only") {
            let image = UIGraphicsImageRenderer(size: CGSize(width: 560, height: 320)).image { renderer in
                UIColor.systemIndigo.setFill(); renderer.fill(CGRect(x: 0, y: 0, width: 560, height: 320))
                UIImage(systemName: "folder.fill")?.withTintColor(.white, renderingMode: .alwaysOriginal).draw(in: CGRect(x: 230, y: 72, width: 100, height: 80))
                ("项目页面预览" as NSString).draw(at: CGPoint(x: 180, y: 190), withAttributes: [.font: UIFont.systemFont(ofSize: 30), .foregroundColor: UIColor.white])
            }.pngData()!
            value.attachments = [NativeAttachment(id: "demo-image", name: "项目预览.png", imageURL: "data:image/png;base64," + image.base64EncodedString(), type: "image/png", size: image.count), NativeAttachment(id: "demo-pdf", name: "交互设计说明.pdf", type: "application/pdf", size: 12480)]
        }
        if args.contains("--first-message-attachments-only") { value.draft = "" }
        if args.contains("--first-message-many-files") {
            value.attachments += (1...7).map { NativeAttachment(id: "file-\($0)", name: "方案附件\($0).pdf", type: "application/pdf", size: 1234) }
        }
    }

    static func dispatch(_ command: NativeCommand, snapshot: NativeSnapshot, publish: @escaping (NativeSnapshot) -> Void) -> Bool {
        guard enabled else { return false }
        var value = snapshot
        func acknowledge(_ ok: Bool = true, error: String? = nil) {
            value.commandResults = [NativeCommandResult(id: command.id, name: command.name, ok: ok, contextId: snapshot.contextId, error: error)]
            publish(value)
        }
        switch command.name {
        case "draft.set":
            if case .string(let text) = command.params["value"] { value.draft = text }
            if case .number(let revision) = command.params["revision"] { value.draftRevision = Int(revision) }
            value.canSend = !value.draft.isEmpty || !value.attachments.isEmpty
            acknowledge()
        case "newchat.project":
            if case .string(let project) = command.params["value"] { value.cwd = project }
            acknowledge()
        case "newchat.backend":
            if case .string(let backend) = command.params["value"] {
                value.backendId = backend; value.contextId = backend + ":new"; value.cwd = "/workspace/Design"
            }
            acknowledge()
        case "thread.new":
            configure(&value); value.contextId = UUID().uuidString; acknowledge()
        case "message.send":
            let text = value.draft; let attachments = value.attachments
            let history = value.messages
            let following = value.threadId != nil
            let identity = following ? UUID().uuidString : "first-message"
            value.draft = ""; value.attachments = []; value.busy = true; value.canSend = false; value.error = nil; value.commandResults = nil
            publish(value)
            Task {
                let args = ProcessInfo.processInfo.arguments
                try? await Task.sleep(for: .milliseconds(args.contains("--message-fast-ack") ? 30 : args.contains("--first-message-slow") ? 3500 : 1700))
                if ProcessInfo.processInfo.arguments.contains("--first-message-failure") {
                    value.busy = false; value.draft = text; value.attachments = attachments; value.canSend = true
                    value.error = "附件上传失败，正文和附件已保留。"; acknowledge(false, error: value.error)
                    return
                }
                if ProcessInfo.processInfo.arguments.contains("--first-message-uncertain") {
                    value.pending = true; acknowledge(false, error: "发送结果待确认")
                    try? await Task.sleep(for: .seconds(3))
                }
                value.threadId = value.threadId ?? "first-message-created"
                if !following { value.title = "发送过渡演示" }
                value.pending = false
                value.messages = history + [NativeMessage(id: identity + "-user", role: "user", text: text,
                    blocks: attachments.map {
                        let isImage = $0.type?.hasPrefix("image/") == true
                        let source = isImage && args.contains("--first-message-unavailable-image")
                            ? "https://example.invalid/first-message-preview.png"
                            : $0.imageURL ?? "data:application/pdf;base64,JVBERg=="
                        return NativePanelItem(id: $0.id, kind: isImage ? "image" : "file", title: $0.name, value: source)
                    }, turnId: "first-message-turn")]
                acknowledge()
                if ProcessInfo.processInfo.arguments.contains("--first-message-no-reply") { return }
                try? await Task.sleep(for: .milliseconds(700))
                value.busy = false
                value.messages.append(NativeMessage(id: identity + "-reply", role: "assistant", text: "已收到任务。机器、项目和附件保持一致，接下来检查发送过渡。", phase: "final_answer"))
                publish(value)
            }
        default: return false
        }
        return true
    }
}
#endif
