import Foundation

@main struct AgentNavigationStateSmoke {
    static func main() {
        precondition(SidebarNavigationState(loading: true, error: nil, empty: true) == .loading, "搜索未完成时不能显示没有结果")
        precondition(SidebarNavigationState(loading: false, error: "连接中断", empty: true) == .failed("连接中断"), "真实错误不能显示为空列表")
        precondition(SidebarNavigationState(loading: true, error: "旧错误", empty: false) == .loading, "重试期间应显示当前加载状态")
        precondition(SidebarNavigationState(loading: false, error: nil, empty: true) == .empty)
        precondition(SidebarNavigationState(loading: false, error: nil, empty: false) == .populated)
        print("Agent navigation state smoke passed")
    }
}
