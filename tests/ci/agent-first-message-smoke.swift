import Foundation

extension AgentSessionSmoke {
    @MainActor static func verifyFirstMessageHttpResolution() async {
        for outcome in ["completed", "failed", "created-only"] {
            let store = NativeUIStore(arguments: [])
            let session = AppSession(store: store)
            var send: NativeCommand?
            store.sendCommand = { if $0.name == "message.send" { send = $0 } }
            var snapshot = NativeSnapshot()
            snapshot.ready = true; snapshot.contextId = "http-first"; snapshot.backendId = "machine"
            snapshot.canSend = true; snapshot.draft = "原始正文"
            snapshot.backends = [NativeBackend(id: "machine", title: "机器", connected: true)]
            func publish() { store.receive(snapshot); session.receive(snapshot) }
            publish(); _ = session.submitCurrent()
            let id = session.firstMessageSubmission!.id
            for _ in 0..<30 { if send != nil { break }; await Task.yield() }
            let command = send!
            snapshot.draft = ""; snapshot.busy = true; snapshot.pending = true
            snapshot.commandResults = [NativeCommandResult(id: command.id, name: command.name, ok: false, contextId: snapshot.contextId, error: "消息未发送，请查看会话错误")]
            publish(); for _ in 0..<5 { await Task.yield() }
            precondition(session.firstMessageSubmission?.state == .unconfirmed && session.errorNotices.isEmpty && store.commandError == nil)
            session.firstMessageAnimationFinished(id)
            snapshot.pending = false; snapshot.busy = false; snapshot.threadId = "created"
            if outcome == "completed" {
                snapshot.messages = [NativeMessage(id: "accepted-user", role: "user", text: "原始正文"), NativeMessage(id: "completed-reply", role: "assistant", text: "已完成", phase: "final_answer")]
            } else {
                snapshot.draft = "原始正文"
                if outcome == "failed" { snapshot.error = "真实发送失败" }
            }
            // HTTP 后续确认不再产生第二条 message.send ACK，允许保留原拒绝回执。
            publish()
            if outcome == "completed" {
                precondition(session.firstMessageSubmission == nil, "HTTP迟到确认与快速完成同帧到达时也必须收敛，不依赖busy仍为true")
            } else {
                precondition(session.firstMessageSubmission?.state == .failed && session.composer.text == "原始正文", "仅创建thread不能冒充首条已发送，失败必须保留输入")
            }
        }
    }

    @MainActor static func verifyFirstMessageSubmission() async {
        for attachmentsOnly in [false, true] {
            let store = NativeUIStore(arguments: [])
            let session = AppSession(store: store)
            var commands: [NativeCommand] = []
            store.sendCommand = { commands.append($0) }
            var snapshot = NativeSnapshot()
            snapshot.ready = true; snapshot.connection = "online"; snapshot.contextId = "first-context"; snapshot.backendId = "first-backend"
            snapshot.cwd = "/work/project"; snapshot.canSend = true
            snapshot.backends = [NativeBackend(id: "first-backend", title: "开发机器", connected: true)]
            snapshot.draft = attachmentsOnly ? "" : "请检查附件"
            snapshot.attachments = [NativeAttachment(id: "image", name: "photo.png", imageURL: "data:image/png;base64,AA==", type: "image/png"), NativeAttachment(id: "file", name: "需求文档.pdf", type: "application/pdf", size: 123)]
            func publish() { store.receive(snapshot); session.receive(snapshot) }
            publish()
            _ = session.submitCurrent()
            let first = session.firstMessageSubmission!
            precondition(first.state == .waiting && first.message.attachments.count == 2 && first.message.text == snapshot.draft)
            precondition(first.projectName == "project" && first.deviceName == "开发机器")
            precondition(session.selectedConversationID == nil && session.conversations.isEmpty, "待发送不能虚构远程会话或加入侧栏")
            precondition(!session.canSubmit && !session.composerCanEdit && session.composer.attachments.count == 2, "待发送期间保留完整草稿并防重复")
            precondition(session.submitCurrent() == .ignored)
            for _ in 0..<30 { if commands.last?.name == "message.send" { break }; await Task.yield() }
            let send = commands.last!
            precondition(first.id == session.firstMessageSubmission?.id && session.firstMessageSubmission?.commandID == send.id)
            snapshot.threadId = "created-thread"; snapshot.busy = true; snapshot.draft = ""; snapshot.attachments = []
            snapshot.messages = [NativeMessage(id: "wire-user", role: "user", text: first.message.text, blocks: [NativePanelItem(id: "file", kind: "file", title: "需求文档.pdf", value: "https://example.invalid/file")])]
            publish()
            precondition(session.firstMessageSubmission?.state == .waiting, "thread/start和本地气泡不能冒充turn/start受理")
            snapshot.commandResults = [NativeCommandResult(id: send.id, name: "message.send", ok: true, contextId: snapshot.contextId)]
            publish()
            for _ in 0..<5 { await Task.yield() }
            precondition(session.firstMessageSubmission?.state == .accepted, "真实ACK到达后原位确认，快速ACK不能截断动效")
            session.firstMessageAnimationFinished(first.id)
            precondition(session.firstMessageSubmission == nil && session.selectedConversation?.messages.count == 1, "动效完成后只呈现业务消息，不留下临时副本")

            snapshot.threadId = nil; snapshot.busy = false; snapshot.messages = []; snapshot.commandResults = nil
            snapshot.draft = "失败后保留正文"; snapshot.attachments = [NativeAttachment(id: "file-2", name: "保留.pdf", type: "application/pdf")]
            publish(); _ = session.submitCurrent()
            let failedID = session.firstMessageSubmission!.id
            for _ in 0..<30 { if commands.last?.id == session.firstMessageSubmission?.commandID { break }; await Task.yield() }
            let failure = commands.last!
            snapshot.commandResults = [NativeCommandResult(id: failure.id, name: "message.send", ok: false, contextId: snapshot.contextId, error: "上传失败")]
            publish(); for _ in 0..<5 { await Task.yield() }
            session.firstMessageAnimationFinished(failedID)
            precondition(session.firstMessageSubmission?.state == .failed && session.firstMessageSubmission?.error == "上传失败")
            precondition(session.composer.text == snapshot.draft && session.composer.attachments.count == 1)
            session.returnToFirstMessageEditor()
            precondition(session.firstMessageSubmission == nil && session.canSubmit && session.composer.project == "/work/project")

            snapshot.commandResults = nil; publish(); _ = session.submitCurrent()
            for _ in 0..<30 { if commands.last?.id == session.firstMessageSubmission?.commandID { break }; await Task.yield() }
            let uncertain = commands.last!
            session.resolve(uncertain.id, ok: false, error: "超时", confirmed: false)
            for _ in 0..<5 { await Task.yield() }
            precondition(session.firstMessageSubmission?.state == .unconfirmed && !session.canSubmit, "超时必须保持待确认且不能重复发送")
            snapshot.threadId = "late-thread"; snapshot.busy = true
            snapshot.messages = [NativeMessage(id: "late-user", role: "user", text: snapshot.draft)]
            snapshot.commandResults = [NativeCommandResult(id: uncertain.id, name: "message.send", ok: true, contextId: snapshot.contextId)]
            publish()
            precondition(session.firstMessageSubmission?.state == .accepted, "超时后迟到的同ID回执仍可确认")
            snapshot.contextId = "another-context"; snapshot.threadId = "another-thread"; publish()
            precondition(session.firstMessageSubmission == nil, "切换上下文后旧动效和迟到回执不能覆盖新会话")
        }
    }
}
