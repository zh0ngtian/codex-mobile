#if NATIVE_CONVERSATION_STATE_TESTS
import Foundation

@main
struct NativeConversationStateTests {
    static func expect(_ value: @autoclosure () -> Bool, _ message: String) {
        guard value() else { fputs("FAIL: \(message)\n", stderr); exit(1) }
    }

    static func snapshot(_ context: String = "one", draft: String = "", ack: Int = 0) -> NativeConversationSnapshot {
        NativeConversationSnapshot(contextId: context, draft: draft, acknowledgedSequence: ack)
    }

    static func main() throws {
        let state = NativeConversationState()
        _ = state.apply(snapshot(draft: "服务器草稿"), hasMarkedText: false)
        expect(state.draft == "服务器草稿", "首次快照应恢复 React 草稿")
        let draft = state.action("draft", text: "本地中文草稿")!
        _ = state.apply(snapshot(draft: "过期", ack: draft.sequence - 1), hasMarkedText: false)
        expect(state.draft == "本地中文草稿", "未 ack 的本地编辑不能被快照覆盖")
        _ = state.apply(snapshot(draft: "确认", ack: draft.sequence), hasMarkedText: true)
        expect(state.draft == "本地中文草稿", "中文组词期间不应回写 textView")
        _ = state.apply(snapshot(draft: "确认", ack: draft.sequence), hasMarkedText: false)
        expect(state.draft == "确认", "ack 后可使用 React 权威草稿")
        let submit = state.action("submit", text: "确认")!
        expect(state.draft == "确认", "Native 不自行清空提交草稿")
        expect(state.action("submit", text: "重复") == nil, "提交 ack 前禁止重复发送")
        _ = state.apply(snapshot(draft: "", ack: submit.sequence - 1), hasMarkedText: false)
        expect(state.submissionPending, "过期 ack 不解锁发送")
        _ = state.apply(snapshot(draft: "", ack: submit.sequence), hasMarkedText: false)
        expect(!state.submissionPending && state.draft.isEmpty, "React ack 解锁发送并清空草稿")
        _ = state.apply(snapshot("two", draft: "第二会话"), hasMarkedText: false)
        let next = state.action("draft", text: "继续", cursor: 2)!
        expect(next.sequence > submit.sequence && next.contextId == "two", "跨 context sequence 不归零")
        expect(!state.hide(contextId: "one"), "旧 context hide 不隐藏当前会话")
        expect(state.hide(contextId: "two"), "当前 context hide 应生效")
        expect(NativeConversationScrollPolicy.shouldFollow(contextChanged: true, nearBottom: false), "新 context 默认到底部")
        expect(!NativeConversationScrollPolicy.shouldFollow(contextChanged: false, nearBottom: false), "阅读历史不被新回复打断")
        expect(NativeConversationScrollPolicy.shouldFollow(contextChanged: false, nearBottom: true), "接近底部跟随新回复")
        let decoded = try JSONDecoder().decode(NativeConversationSnapshot.self, from: Data("""
        {"version":1,"contextId":"decode","visible":true,"draft":"中文","rows":[{"id":"r1","role":"assistant","text":"**内容**","rich":true}],"attachments":[{"id":"a1","name":"图片","kind":"image"}],"mentions":[{"id":"s1","label":"Skill","description":"说明"}],"projects":[{"id":"p1","label":"项目"}],"backends":[{"id":"b1","label":"设备"}],"selectedProject":"p1","queued":[{"id":"q1","text":"等待","failed":false}]}
        """.utf8))
        expect(decoded.rows.first?.id == "r1" && decoded.rows.first?.rich == true, "解析稳定 row ID 与 rich 标记")
        expect(decoded.selectedProject == "p1" && decoded.attachments.count == 1, "快照解析原生选择器状态")
        expect(decoded.enabled && decoded.sendEnabled, "缺省快照使用可交互默认值")
        let payload = try JSONSerialization.jsonObject(with: JSONEncoder().encode(next)) as! [String: Any]
        expect(payload["type"] as? String == "draft" && payload["text"] as? String == "继续", "action 保留 React contract")
        expect(payload["cursor"] as? Int == 2, "cursor 应为 UTF16 数值以符合 Web Skill contract")
        let cursorState = NativeConversationState()
        _ = cursorState.apply(snapshot(draft: "$ne"), hasMarkedText: false)
        _ = cursorState.action("draft", text: "$ne", cursor: 3)
        let mention = cursorState.action("mention", id: "skill:neat-freak", cursor: 3)!
        var inserted = snapshot(draft: "$neat-freak ", ack: mention.sequence)
        inserted.draftCursor = 12
        inserted.draftCursorSequence = mention.sequence
        _ = cursorState.apply(inserted, hasMarkedText: false)
        expect(cursorState.consumeSuggestedCursor(hasMarkedText: false) == 12, "mention ack 后返回 React 建议 UTF16 光标")
        expect(cursorState.consumeSuggestedCursor(hasMarkedText: false) == nil, "建议光标仅消费一次")
        _ = cursorState.apply(inserted, hasMarkedText: false)
        expect(cursorState.consumeSuggestedCursor(hasMarkedText: false) == nil, "重复快照不能再次恢复已经消费的光标")
        let localCursor = cursorState.action("draft", text: "$neat-freak ", cursor: 5)!
        inserted.acknowledgedSequence = localCursor.sequence
        _ = cursorState.apply(inserted, hasMarkedText: false)
        expect(cursorState.consumeSuggestedCursor(hasMarkedText: false) == nil, "新的本地光标编辑不能被旧 cursor sequence 复位")
        let nextMention = cursorState.action("mention", id: "skill:next", cursor: 5)!
        inserted.draftCursorSequence = nextMention.sequence
        inserted.acknowledgedSequence = nextMention.sequence
        _ = cursorState.apply(inserted, hasMarkedText: true)
        expect(cursorState.consumeSuggestedCursor(hasMarkedText: true) == nil, "marked 中文组词期间不接受建议光标")
        _ = cursorState.apply(inserted, hasMarkedText: false)
        expect(cursorState.consumeSuggestedCursor(hasMarkedText: false) == 12, "marked 结束后新的已确认建议可消费")
        let cursorJSON = try JSONDecoder().decode(NativeConversationSnapshot.self, from: Data("""
        {"contextId":"cursor","draft":"😀中文","draftCursor":4,"draftCursorSequence":9}
        """.utf8))
        expect(cursorJSON.draftCursor == 4 && cursorJSON.draftCursorSequence == 9, "可选建议光标字段按数值解析")
        expect(NativeConversationStrings(locale: "en-US").text(.done) == "Done", "英文用户应看到英文原生键盘按钮")
        expect(NativeConversationStrings(locale: "zh-CN").text(.done) == "完成", "中文原生文案保持兼容")
        expect(NativeConversationStrings.Key.allCases.allSatisfy {
            let text = NativeConversationStrings(locale: "en").text($0)
            return !text.isEmpty && text.range(of: "[\\p{Han}]", options: .regularExpression) == nil
        }, "英文菜单、角色、状态和帮助不得残留中文静态文案")
        var policy = snapshot()
        expect(policy.allowsConversationActions && policy.allowsEditingMessages, "可编辑已载入会话允许会话操作及编辑重发")
        policy.isNewChat = true
        expect(!policy.allowsConversationActions, "尚未创建的会话不能置顶或归档")
        policy.isNewChat = false
        policy.busy = true
        expect(!policy.allowsEditingMessages, "正在回复时不能编辑重发历史消息")
        policy.busy = false
        policy.enabled = false
        expect(!policy.allowsEditingMessages && !policy.allowsConversationActions, "转为只读后关闭消息与会话写操作")
        let localized = try JSONDecoder().decode(NativeConversationSnapshot.self, from: Data("""
        {"contextId":"localized","locale":"en-US","isNewChat":true}
        """.utf8))
        expect(localized.locale == "en-US" && localized.isNewChat, "解析可选 locale 和新会话标记")
        expect(localized.sendLabel == "Send" && localized.settingsLabel == "Model & permissions", "英文快照缺省按钮文案仍需本地化")
        expect(decoded.locale == "zh-CN" && !decoded.isNewChat, "旧协议默认中文与已存在会话")
        print("PASS: NativeConversationState draft/ack/IME/submit/context/scroll/schema/cursor/locale/policy")
    }
}
#endif
