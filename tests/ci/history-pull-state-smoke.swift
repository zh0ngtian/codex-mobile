import Foundation

@main
struct HistoryPullStateSmoke {
    static func main() {
        func expect(_ value: Bool, _ message: String) { precondition(value, message) }
        var state = HistoryPullState()
        expect(!state.positionChanged(to: 0, canLoad: true, isLoading: false), "首屏布局不能加载历史")
        expect(!state.positionChanged(to: -100, canLoad: true, isLoading: false) && !state.isArmed, "程序滚动不能成为第一次拉动")
        state.dragBegan(at: 200)
        expect(!state.positionChanged(to: 0, canLoad: true, isLoading: false), "第一次到顶不加载")
        expect(!state.positionChanged(to: -90, canLoad: true, isLoading: false), "同一手势继续下拉也不加载")
        state.dragEnded(at: 0, willDecelerate: false)
        state.settled(at: 0)
        expect(state.isArmed, "第一次用户到顶并松手后才准备下一次拉动")
        state.dragBegan(at: 0)
        expect(!state.positionChanged(to: -40, canLoad: true, isLoading: false), "小幅下拉不误触")
        expect(state.positionChanged(to: -60, canLoad: true, isLoading: false), "第二次下拉越过阈值才加载")
        expect(!state.positionChanged(to: -90, canLoad: true, isLoading: false), "同一手势仅加载一次")
        state.loadingFinished(at: 0)
        expect(!state.positionChanged(to: -100, canLoad: true, isLoading: false), "加载完成也不能在旧手势重复请求")
        state.dragEnded(at: 0, willDecelerate: false); state.settled(at: 0)
        state.dragBegan(at: 0)
        expect(state.positionChanged(to: -60, canLoad: true, isLoading: false), "失败或没有新增内容时可再次下拉重试")

        state.reset()
        state.dragBegan(at: 0)
        expect(!state.positionChanged(to: -100, canLoad: true, isLoading: false), "内容初始就在顶端时第一次拉动仍不加载")
        state.dragEnded(at: 0, willDecelerate: false); state.settled(at: 0)
        state.dragBegan(at: 0)
        expect(state.positionChanged(to: -60, canLoad: true, isLoading: false), "初始顶端的下一次拉动加载")

        state.reset(); state.dragBegan(at: 200)
        state.dragEnded(at: 30, willDecelerate: true)
        expect(!state.positionChanged(to: 0, canLoad: true, isLoading: false), "惯性第一次到顶不加载")
        state.settled(at: 0); state.dragBegan(at: 0)
        expect(state.positionChanged(to: -60, canLoad: true, isLoading: false), "惯性到顶后下一次下拉可加载")

        state.reset(); state.dragBegan(at: 0); state.dragEnded(at: 0, willDecelerate: false); state.settled(at: 0)
        state.dragBegan(at: 0)
        expect(!state.positionChanged(to: -100, canLoad: true, isLoading: true), "加载中不发请求")
        expect(!state.positionChanged(to: -110, canLoad: true, isLoading: false), "加载中开始的旧手势不能在解锁后补发")
        state.dragEnded(at: 0, willDecelerate: false); state.settled(at: 0)
        state.dragBegan(at: 0)
        expect(!state.positionChanged(to: -100, canLoad: false, isLoading: false), "没有更多历史不请求")

        state.reset(); state.dragBegan(at: 0); state.dragEnded(at: 0, willDecelerate: false); state.settled(at: 0)
        state.programmaticScrollBegan()
        expect(!state.positionChanged(to: -100, canLoad: true, isLoading: false) && !state.isArmed, "阅读锚点恢复与程序滚动不触发加载")
        state.dragBegan(at: 100)
        expect(!state.positionChanged(to: -100, canLoad: true, isLoading: false), "离开顶端后必须重新完成第一步")
        state.reset()
        expect(!state.isArmed && !state.positionChanged(to: -100, canLoad: true, isLoading: false), "切换会话清理手势状态")
        print("History pull state smoke passed")
    }
}
