#if NATIVE_SIDEBAR_STATE_TESTS
import Foundation

@main
struct NativeSidebarStateTests {
    static func expect(_ value: @autoclosure () -> Bool, _ message: String) {
        guard value() else { fputs("FAIL: \(message)\n", stderr); exit(1) }
    }

    static func snapshot(_ context: String = "one", query: String = "", ack: Int = 0) -> NativeSidebarSnapshot {
        NativeSidebarSnapshot(contextId: context, query: query, acknowledgedSequence: ack)
    }

    static func main() throws {
        let state = NativeSidebarState()
        expect(state.apply(snapshot(query: "服务端搜索"), hasMarkedText: false), "首次快照应接受")
        expect(state.query == "服务端搜索", "首次打开恢复 React 搜索")
        let query = state.action("query", text: "本地中文")!
        _ = state.apply(snapshot(query: "旧搜索", ack: query.sequence - 1), hasMarkedText: false)
        expect(state.query == "本地中文", "未 ack 的本地搜索不能被旧快照覆盖")
        _ = state.apply(snapshot(query: "已确认", ack: query.sequence), hasMarkedText: true)
        expect(state.query == "本地中文", "中文组词期间不能回写搜索")
        _ = state.apply(snapshot(query: "已确认", ack: query.sequence), hasMarkedText: false)
        expect(state.query == "已确认", "ack 后接收 React 权威搜索")
        _ = state.action("query", text: "待确认")
        _ = state.apply(snapshot("two", query: "第二上下文"), hasMarkedText: false)
        expect(state.query == "第二上下文", "context 切换清空未确认搜索状态")
        let next = state.action("query", text: "继续")!
        expect(next.contextId == "two" && next.sequence > query.sequence, "跨 context 动作序列继续递增")
        expect(!state.hide(contextId: "one") && state.snapshot?.visible == true, "错误 context 无法隐藏当前边栏")
        expect(state.hide(contextId: "two") && state.query.isEmpty, "隐藏清空本地搜索")
        expect(state.action("refresh") == nil, "隐藏边栏拒绝交互")
        _ = state.apply(snapshot("two", query: "重开权威值"), hasMarkedText: false)
        expect(state.query == "重开权威值", "重新打开同步 React 搜索")
        var duplicate = snapshot("duplicate")
        let row = NativeSidebarRow(id: "backend:thread", threadId: "thread", title: "标题")
        duplicate.sections = [NativeSidebarSection(id: "project", title: "项目", rows: [row, row])]
        expect(!state.apply(duplicate, hasMarkedText: false), "重复 row ID 应拒绝")
        expect(state.snapshot?.contextId == "two", "非法快照不替换当前状态")
        duplicate.sections = [NativeSidebarSection(id: "project", title: "项目", rows: [row]), NativeSidebarSection(id: "project", title: "重复项目")]
        expect(!state.apply(duplicate, hasMarkedText: false), "重复 section ID 应拒绝")
        var unknownVersion = snapshot(); unknownVersion.version = 2
        expect(!state.apply(unknownVersion, hasMarkedText: false), "未知版本不进入列表")
        var policy = snapshot()
        policy.sections = [NativeSidebarSection(id: "project", title: "项目", more: true, rows: [row])]
        _ = state.apply(policy, hasMarkedText: false)
        let open = state.action("open", id: row.id)!
        expect(state.action("open", id: row.id) == nil, "ack 前禁止重复打开")
        policy.acknowledgedSequence = open.sequence
        _ = state.apply(policy, hasMarkedText: false)
        expect(state.action("open", id: "missing") == nil, "无效会话不可操作")
        var offline = row; offline.readOnly = true
        policy.sections[0].rows = [offline]
        _ = state.apply(policy, hasMarkedText: false)
        expect(state.action("duplicate", id: row.id) == nil && state.action("rename", text: "新标题", id: row.id) == nil && state.action("archive", id: row.id) == nil, "离线只读禁用写操作")
        expect(state.action("copy", id: row.id) != nil && state.action("pin", id: row.id) != nil && state.action("refresh-thread", id: row.id) != nil, "只读保留复制、置顶和刷新")
        var failedSearch = snapshot(query: "保留搜索")
        failedSearch.error = "搜索失败"
        expect(failedSearch.hasError, "ready 搜索快照中的错误仍须显示失败")
        expect(failedSearch.emptyState(query: failedSearch.query) == .error, "搜索失败不得误显示没有匹配")
        _ = state.apply(failedSearch, hasMarkedText: false)
        expect(state.action("refresh") != nil && state.query == "保留搜索", "重试保留搜索文本")
        var pending = snapshot("pending")
        pending.sections = [NativeSidebarSection(id: "project", title: "项目", rows: [row])]
        pending.pendingKey = "other:thread"
        pending.pendingAction = "rename"
        expect(!pending.allowsRowActions, "任意全局 pending 禁止全部会话操作")
        _ = state.apply(pending, hasMarkedText: false)
        for type in ["open", "pin", "refresh-thread", "duplicate", "rename", "archive", "copy"] {
            expect(state.action(type, text: "新标题", id: row.id) == nil, "全局 pending 拒绝 \(type)，即使不是同一会话")
        }
        pending.pendingAction = ""
        pending.pendingKey = ""
        _ = state.apply(pending, hasMarkedText: false)
        expect(pending.allowsRowActions && state.action("open", id: row.id) != nil, "pending 完成恢复会话操作")
        expect(NativeSidebarStrings(snapshot: nil).text("approvals") == "个待审批", "审批计数必须有中文 fallback")
        expect(NativeSidebarStrings(snapshot: nil).text("expanded") == "已展开", "项目展开值必须可本地化")
        let decoded = try JSONDecoder().decode(NativeSidebarSnapshot.self, from: Data("""
        {"contextId":"decode","version":1,"visible":true,"locale":"en-US","selectedBackendId":"b","backends":[{"id":"b","label":"Device","detail":"Connected","online":true,"loading":false,"approvalCount":2}],"sections":[{"id":"s","title":"Project","backendId":"b","cwd":"/project","collapsible":true,"expanded":true,"loading":false,"error":false,"more":true,"rows":[{"id":"b:t","threadId":"t","title":"Chat","source":"Local","time":"Today","snippet":"Search result","pinned":true,"unread":true,"running":true,"opening":false,"readOnly":false}]}],"strings":{"search":"Search chats"}}
        """.utf8))
        expect(decoded.sections.first?.rows.first?.snippet == "Search result", "解析搜索摘要与完整行契约")
        expect(decoded.backends.first?.approvalCount == 2 && decoded.selectedBackendId == "b", "解析设备与待审批数")
        expect(NativeSidebarStrings(snapshot: decoded).text("search") == "Search chats", "优先 React 翻译")
        expect(NativeSidebarStrings(snapshot: decoded).text("close") == "Close", "英文缺省文案保持英文")
        let payload = try JSONSerialization.jsonObject(with: JSONEncoder().encode(next)) as! [String: Any]
        expect(payload["type"] as? String == "query" && payload["text"] as? String == "继续" && payload["contextId"] as? String == "two", "原生动作符合桥接契约")
        print("PASS: NativeSidebarState query/ack/IME/context/hide/identity/policy/schema/locale/error/retry/global-pending/project-a11y")
    }
}
#endif
