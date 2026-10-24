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
            let id = session.messageSubmission!.id
            for _ in 0..<30 { if send != nil { break }; await Task.yield() }
            let command = send!
            snapshot.draft = ""; snapshot.busy = true; snapshot.pending = true
            snapshot.commandResults = [NativeCommandResult(id: command.id, name: command.name, ok: false, contextId: snapshot.contextId, error: "消息未发送，请查看会话错误")]
            publish(); for _ in 0..<5 { await Task.yield() }
            precondition(session.messageSubmission?.state == .unconfirmed && session.errorNotices.isEmpty && store.commandError == nil)
            session.messageSubmissionAnimationFinished(id)
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
                precondition(session.messageSubmission == nil, "HTTP迟到确认与快速完成同帧到达时也必须收敛，不依赖busy仍为true")
            } else {
                precondition(session.messageSubmission?.state == .failed && session.composer.text == "原始正文", "仅创建thread不能冒充首条已发送，失败必须保留输入")
            }
        }
    }

    @MainActor static func verifyMessageSubmission() async {
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
            let first = session.messageSubmission!
            precondition(first.state == .waiting && first.message.attachments.count == 2 && first.message.text == snapshot.draft)
            precondition(first.projectName == "project" && first.deviceName == "开发机器")
            precondition(session.selectedConversationID == nil && session.conversations.isEmpty, "待发送不能虚构远程会话或加入侧栏")
            precondition(!session.canSubmit && !session.composerCanEdit && session.composer.attachments.count == 2, "待发送期间保留完整草稿并防重复")
            precondition(session.submitCurrent() == .ignored)
            for _ in 0..<30 { if commands.last?.name == "message.send" { break }; await Task.yield() }
            let send = commands.last!
            precondition(first.id == session.messageSubmission?.id && session.messageSubmission?.commandID == send.id)
            snapshot.threadId = "created-thread"; snapshot.busy = true; snapshot.draft = ""; snapshot.attachments = []
            snapshot.messages = [NativeMessage(id: "wire-user", role: "user", text: first.message.text, blocks: [NativePanelItem(id: "file", kind: "file", title: "需求文档.pdf", value: "https://example.invalid/file")])]
            publish()
            precondition(session.messageSubmission?.state == .waiting, "thread/start和本地气泡不能冒充turn/start受理")
            snapshot.commandResults = [NativeCommandResult(id: send.id, name: "message.send", ok: true, contextId: snapshot.contextId)]
            publish()
            for _ in 0..<5 { await Task.yield() }
            precondition(session.messageSubmission?.state == .accepted, "真实ACK到达后原位确认，快速ACK不能截断动效")
            session.messageSubmissionAnimationFinished(first.id)
            precondition(session.messageSubmission == nil && session.selectedConversation?.messages.count == 1, "动效完成后只呈现业务消息，不留下临时副本")

            snapshot.threadId = nil; snapshot.busy = false; snapshot.messages = []; snapshot.commandResults = nil
            snapshot.draft = "失败后保留正文"; snapshot.attachments = [NativeAttachment(id: "file-2", name: "保留.pdf", type: "application/pdf")]
            publish(); _ = session.submitCurrent()
            let failedID = session.messageSubmission!.id
            for _ in 0..<30 { if commands.last?.id == session.messageSubmission?.commandID { break }; await Task.yield() }
            let failure = commands.last!
            snapshot.commandResults = [NativeCommandResult(id: failure.id, name: "message.send", ok: false, contextId: snapshot.contextId, error: "上传失败")]
            publish(); for _ in 0..<5 { await Task.yield() }
            session.messageSubmissionAnimationFinished(failedID)
            precondition(session.messageSubmission?.state == .failed && session.messageSubmission?.error == "上传失败")
            precondition(session.composer.text == snapshot.draft && session.composer.attachments.count == 1)
            session.returnToMessageEditor()
            precondition(session.messageSubmission == nil && session.canSubmit && session.composer.project == "/work/project")

            snapshot.commandResults = nil; publish(); _ = session.submitCurrent()
            for _ in 0..<30 { if commands.last?.id == session.messageSubmission?.commandID { break }; await Task.yield() }
            let uncertain = commands.last!
            session.resolve(uncertain.id, ok: false, error: "超时", confirmed: false)
            for _ in 0..<5 { await Task.yield() }
            precondition(session.messageSubmission?.state == .unconfirmed && !session.canSubmit, "超时必须保持待确认且不能重复发送")
            snapshot.threadId = "late-thread"; snapshot.busy = true
            snapshot.messages = [NativeMessage(id: "late-user", role: "user", text: snapshot.draft)]
            snapshot.commandResults = [NativeCommandResult(id: uncertain.id, name: "message.send", ok: true, contextId: snapshot.contextId)]
            publish()
            precondition(session.messageSubmission?.state == .accepted, "超时后迟到的同ID回执仍可确认")
            snapshot.contextId = "another-context"; snapshot.threadId = "another-thread"; publish()
            precondition(session.messageSubmission == nil, "切换上下文后旧动效和迟到回执不能覆盖新会话")
        }
    }
}

extension AgentSessionSmoke {
    @MainActor static func verifyFollowupMessageSubmission() async {
        let store = NativeUIStore(arguments: [])
        let session = AppSession(store: store)
        var commands: [NativeCommand] = []
        store.sendCommand = { commands.append($0) }
        var snapshot = NativeSnapshot()
        snapshot.ready = true; snapshot.connection = "online"; snapshot.contextId = "existing-context"; snapshot.backendId = "machine"
        snapshot.threadId = "existing-thread"; snapshot.canSend = true; snapshot.draft = "继续检查"
        snapshot.backends = [NativeBackend(id: "machine", title: "开发机器", connected: true)]
        snapshot.messages = [NativeMessage(id: "old-user", role: "user", text: "继续检查"), NativeMessage(id: "old-reply", role: "assistant", text: "前一轮已完成", phase: "final_answer")]
        func publish() { store.receive(snapshot); session.receive(snapshot) }
        publish(); let conversation = session.selectedConversationID
        _ = session.submitCurrent()
        precondition(session.messageSubmission != nil, "后续消息也应立即建立独立发送呈现")
        precondition(session.selectedConversationID == conversation && session.selectedConversation?.messages.count == 2, "不能替换会话或把临时消息写入业务历史")
        precondition(!session.canSubmit && !session.composerCanEdit)
        for _ in 0..<30 { if commands.last?.name == "message.send" { break }; await Task.yield() }
        let command = commands.last!; let id = session.messageSubmission!.id
        snapshot.commandResults = [NativeCommandResult(id: command.id, name: command.name, ok: true, contextId: snapshot.contextId)]
        snapshot.draft = ""; publish()
        session.messageSubmissionAnimationFinished(id)
        precondition(session.messageSubmission != nil, "已有同文旧消息不能冒充本次发送回显")
        snapshot.messages.append(NativeMessage(id: "new-user", role: "user", text: "继续检查"))
        publish()
        precondition(session.messageSubmission == nil && session.selectedConversation?.messages.count == 3, "本次真实回显确认后只保留一个新气泡")
    }
}

extension AgentSessionSmoke {
    @MainActor static func verifyFollowupMessageResolutions() async {
        for outcome in ["fast", "attachments-only", "quoted", "failed", "http-completed", "http-old-only", "switched", "queue", "mismatched-echo"] {
            let store = NativeUIStore(arguments: [])
            let session = AppSession(store: store)
            var command: NativeCommand?
            store.sendCommand = { if $0.name == "message.send" { command = $0 } }
            var snapshot = NativeSnapshot()
            snapshot.ready = true; snapshot.connection = "online"; snapshot.contextId = "followup-context"; snapshot.backendId = "machine"; snapshot.threadId = "existing-thread"
            snapshot.backends = [NativeBackend(id: "machine", title: "开发机器", connected: true)]
            snapshot.canSend = true; snapshot.draft = outcome == "attachments-only" ? "" : "继续检查"
            snapshot.attachments = [NativeAttachment(id: "file", name: "交互.pdf", type: "application/pdf")]
            let blocks = [NativePanelItem(id: "file", kind: "file", title: "交互.pdf", value: "https://example.invalid/file")]
            let references = outcome == "quoted" ? [NativeMessageReference(text: "引用片段")] : []
            if outcome == "quoted" {
                snapshot.quotes = [NativeMessageQuote(id: "quote", source: NativeQuoteSource(backendId: "machine", threadId: "existing-thread", turnId: "old-turn", itemId: "old-item", region: "user", revision: "1"), text: "引用片段")]
            }
            let body = snapshot.draft
            snapshot.messages = [NativeMessage(id: "old-user", role: "user", text: body, references: references, blocks: blocks), NativeMessage(id: "old-reply", role: "assistant", text: "旧回答", phase: "final_answer")]
            if outcome == "queue" { snapshot.busy = true }
            func publish() { store.receive(snapshot); session.receive(snapshot) }
            publish(); let selected = session.selectedConversationID
            _ = session.submitCurrent()
            for _ in 0..<30 { if command != nil { break }; await Task.yield() }
            let send = command!
            if outcome == "queue" {
                precondition(session.messageSubmission == nil, "运行中的排队不能被冒充为正常发送气泡")
                snapshot.commandResults = [NativeCommandResult(id: send.id, name: send.name, ok: true, contextId: snapshot.contextId)]; publish()
                continue
            }
            let pending = session.messageSubmission!
            precondition(pending.conversationID == selected && pending.message.attachments.count == 1 && pending.message.references == references.map { NativeMessageReference(text: $0.text, annotation: "用户消息") })
            if outcome == "switched" {
                snapshot.contextId = "another-context"; snapshot.threadId = "another-thread"; publish()
                snapshot.commandResults = [NativeCommandResult(id: send.id, name: send.name, ok: true, contextId: "followup-context")]; publish()
                session.messageSubmissionAnimationFinished(pending.id)
                precondition(session.messageSubmission == nil && session.selectedConversationID != selected, "跨上下文迟到回执和动画完成不能覆盖新会话")
                continue
            }
            if outcome == "failed" {
                snapshot.commandResults = [NativeCommandResult(id: send.id, name: send.name, ok: false, contextId: snapshot.contextId, error: "上传失败")]; publish()
                for _ in 0..<5 { await Task.yield() }
                session.messageSubmissionAnimationFinished(pending.id)
                precondition(session.messageSubmission?.state == .failed)
                session.returnToMessageEditor()
                precondition(session.selectedConversationID == selected && session.composer.text == body && session.composer.attachments.count == 1 && session.canSubmit)
                continue
            }
            snapshot.draft = ""; snapshot.attachments = []; snapshot.quotes = nil
            if outcome.hasPrefix("http") {
                snapshot.pending = true
                snapshot.commandResults = [NativeCommandResult(id: send.id, name: send.name, ok: false, contextId: snapshot.contextId, error: "待确认")]; publish()
                for _ in 0..<5 { await Task.yield() }
                session.messageSubmissionAnimationFinished(pending.id)
                precondition(session.messageSubmission?.state == .unconfirmed && !session.canSubmit && store.commandError == nil && session.errorNotices.isEmpty)
                snapshot.pending = false
                if outcome == "http-completed" {
                    snapshot.messages.append(NativeMessage(id: "new-user", role: "user", text: body, references: references, blocks: blocks))
                    snapshot.messages.append(NativeMessage(id: "new-reply", role: "assistant", text: "立即完成", phase: "final_answer"))
                }
                publish()
                precondition((session.messageSubmission == nil) == (outcome == "http-completed"), "HTTP无第二条ACK时，只能以本次新增回显和权威结束状态收敛，旧同文消息不能受理")
                continue
            }
            snapshot.commandResults = [NativeCommandResult(id: send.id, name: send.name, ok: true, contextId: snapshot.contextId)]
            if outcome == "mismatched-echo" {
                snapshot.messages.append(NativeMessage(id: "other-user", role: "user", text: body, blocks: [NativePanelItem(id: "other", kind: "file", title: "别的附件.pdf", value: "https://example.invalid/other")]))
                publish(); session.messageSubmissionAnimationFinished(pending.id)
                precondition(session.messageSubmission != nil && session.messageSubmission?.echoMessageID == nil, "其他新增用户消息的附件不匹配时不能绑定")
            }
            snapshot.messages.append(NativeMessage(id: "new-user", role: "user", text: body, references: references, blocks: blocks)); publish()
            if outcome != "mismatched-echo" {
                precondition(session.messageSubmission?.state == .accepted && session.messageSubmission?.animationFinished == false, "快速确认必须等待本次动效完成")
            }
            session.messageSubmissionAnimationFinished(pending.id)
            precondition(session.messageSubmission == nil && session.lastSubmittedMessageID != nil && session.selectedConversationID == selected)
        }
    }
}

extension AgentSessionSmoke {
    @MainActor static func verifyFollowupQueueRace() async {
        for delayed in [false, true] {
            let store = NativeUIStore(arguments: [])
            let session = AppSession(store: store)
            var command: NativeCommand?
            store.sendCommand = { if $0.name == "message.send" { command = $0 } }
            var snapshot = NativeSnapshot()
            snapshot.ready = true; snapshot.connection = "online"; snapshot.contextId = "queue-race"; snapshot.backendId = "machine"; snapshot.threadId = "existing-thread"
            snapshot.backends = [NativeBackend(id: "machine", title: "开发机器", connected: true)]
            snapshot.canSend = true; snapshot.draft = "下一条"
            snapshot.messages = [NativeMessage(id: "old", role: "user", text: "旧消息")]
            func publish() { store.receive(snapshot); session.receive(snapshot) }
            publish(); session.lastSubmittedMessageID = session.selectedConversation?.messages.first?.id
            _ = session.submitCurrent()
            precondition(session.lastSubmittedMessageID == nil, "新提交的缩略图不能复用上一条消息的身份")
            let pending = session.messageSubmission!
            for _ in 0..<30 { if command != nil { break }; await Task.yield() }
            let send = command!
            snapshot.busy = true; snapshot.draft = ""
            snapshot.queued = [NativeNavigationItem(id: "actual-queued", title: "下一条", inputText: "下一条", queueState: "queued", attachmentCount: 0)]
            snapshot.pending = delayed
            snapshot.commandResults = [NativeCommandResult(id: send.id, name: send.name, ok: !delayed, contextId: snapshot.contextId)]
            publish(); for _ in 0..<5 { await Task.yield() }
            session.messageSubmissionAnimationFinished(pending.id)
            if delayed { snapshot.pending = false; publish() }
            precondition(session.messageSubmission == nil && session.lastSubmittedMessageID == nil && session.selectedConversation?.queue.count == 1, "提交瞬间运行状态改变而真实入队时，应交接给现有队列，不能锁死临时气泡或伪造已发送消息")
            precondition(session.selectedConversation?.messages.count == 1)
        }
    }
}
