import Foundation

extension AgentSessionSmoke {
    @MainActor static func verifySteeringReplyHistory() {
        let session = AppSession()
        let date = 1_792_300_000.0
        func user(_ id: String, _ text: String) -> NativeMessage {
            NativeMessage(id: id, role: "user", text: text, turnId: "steered-turn")
        }
        func history(_ id: String, _ text: String) -> NativeMessage {
            NativeMessage(id: id, role: "activity", text: "", turnId: "steered-turn",
                commentary: [NativeCommentaryEntry(id: id + "-entry", text: text, timestamp: date)],
                commentaryCanAttachToReply: true)
        }
        func oldReply(_ id: String, _ text: String) -> NativeMessage {
            NativeMessage(id: id, role: "assistant", text: text, status: "20秒",
                actions: [NativePanelItem(id: id + "-copy", kind: "action", command: NativeCommand(name: "message.copy", params: ["id": .string(id)]))],
                timestamp: date, turnId: "steered-turn", phase: "final_answer",
                commentary: [NativeCommentaryEntry(id: id, text: text, timestamp: date, isPreviousReply: true)], commentaryCanAttachToReply: true, scrollAnchorId: id + ":assistant")
        }
        var snapshot = NativeSnapshot()
        snapshot.ready = true; snapshot.backendId = "host"; snapshot.threadId = "thread"; snapshot.contextId = "steering-history"
        snapshot.messages = [user("initial", "最初提问"), user("steer-1", "第一次引导"), user("steer-2", "第二次引导"),
            history("history-1", "第一段过程"), oldReply("old-final-1", "中途旧回答一"),
            history("history-2", "第二段过程"), oldReply("old-final-2", "中途旧回答二"),
            NativeMessage(id: "last-final", role: "assistant", text: "最终回答", status: "20秒", turnId: "steered-turn", phase: "final_answer")]
        session.receive(snapshot)
        let rendered = session.selectedConversation!.messages
        precondition(rendered.map(\.text) == ["最初提问", "第一次引导", "第二次引导", "最终回答"], "引导集中后中途旧回答只能出现在折叠过程")
        precondition(rendered.last!.commentary.map(\.text) == ["第一段过程", "中途旧回答一", "第二段过程", "中途旧回答二"], "过程须完整保留原先说明和旧回答顺序")
        precondition(rendered.last!.commentary.map(\.isPreviousReply) == [nil, true, nil, true], "仅旧回答继承Markdown呈现语义，普通commentary保留原样式")
        let hiddenID = session.scopedID("message", "steering-history", "old-final-1")
        precondition(session.nativeMessage(hiddenID)?.text == "中途旧回答一" && session.nativeMessage(hiddenID)?.actions?.first?.command?.name == "message.copy", "收进过程不能丢失旧消息原始身份与复制命令")
        precondition(session.historyScrollMessageID(in: session.selectedConversation!.id, previousID: hiddenID, anchorID: "old-final-1:assistant") == rendered.last!.id, "被收入过程的旧回答锚点必须恢复到所属最终回答")

        snapshot.busy = true
        snapshot.messages.removeLast()
        snapshot.messages.append(NativeMessage(id: "live", role: "assistant", text: "正在继续执行", turnId: "steered-turn", phase: "commentary", commentaryIsLiveTail: true))
        session.receive(snapshot)
        let running = session.selectedConversation!
        precondition(!running.messages.contains { $0.text == "中途旧回答一" || $0.text == "中途旧回答二" }, "运行中旧回答也不能重新外显")
        precondition(running.messages.flatMap(\.commentary).map(\.text) == ["第一段过程", "中途旧回答一", "第二段过程", "中途旧回答二"], "尚无新final时仍须能展开旧过程")
        precondition(running.liveCommentary.map(\.text) == ["正在继续执行"], "最新commentary继续实时显示")
        precondition(running.messages.allSatisfy { $0.duration.isEmpty }, "运行中不能把旧final耗时当成已完成")
    }
}
