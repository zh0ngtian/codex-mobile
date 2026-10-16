import Foundation

/// 独立离线对照资料。仅 reference 启动参数使用；项目/设备名为公开演示值。
enum NativeVisualReference {
    static func snapshot(chinese: Bool = false) -> NativeSnapshot {
        var value = NativeSnapshot()
        value.ready = true
        value.connection = "online"
        value.locale = chinese ? "zh-CN" : "en"
        value.title = "说明 Sidechat 支持方式"
        value.threadId = "visual-conversation"
        value.backendId = "visual-device"
        value.contextId = "visual-context"
        value.projectName = "demo_gpu_monitor"
        value.backendName = "DEMO5VYDY4"
        value.listBackendId = "visual-device"
        value.backends = [NativeBackend(id: "visual-device", title: "DEMO5VYDY4", connected: true)]
        value.model = "GPT-5"
        value.modelValue = "gpt-5"
        value.models = [NativeOption(id: "gpt-5", title: "GPT-5", value: "gpt-5"), NativeOption(id: "gpt-5-mini", title: "GPT-5 Mini", value: "gpt-5-mini"), NativeOption(id: "o3", title: "o3", value: "o3")]
        value.effort = "Medium"
        value.effortValue = "medium"
        value.efforts = [NativeOption(id: "low", title: "Low", value: "low"), NativeOption(id: "medium", title: "Medium", value: "medium"), NativeOption(id: "high", title: "High", value: "high")]
        value.speed = "Standard"
        value.speedValue = ""
        value.speeds = [NativeOption(id: "", title: "Standard", value: ""), NativeOption(id: "priority", title: "Fast", value: "priority")]
        value.permission = chinese ? "只读" : "Read Only"
        value.permissionValue = "read-only"
        value.permissions = [
            NativeOption(id: "read-only", title: chinese ? "只读" : "Read Only", value: "read-only", subtitle: chinese ? "编辑文件或运行命令需要批准" : "Editing files or running commands requires approval"),
            NativeOption(id: "default", title: chinese ? "工作区写入" : "Workspace Write", value: "default", subtitle: chinese ? "在沙盒中运行命令" : "Run commands in the sandbox"),
            NativeOption(id: "full-access", title: chinese ? "完全访问" : "Full Access", value: "full-access", subtitle: chinese ? "完全访问计算机（风险较高）" : "Full access to the computer (higher risk)")
        ]
        value.contextUsage = NativeContextUsage(used: 14000, total: 200000, usedPercent: 7, remainingPercent: 93)
        value.sevenDayRateLimit = NativeRateLimit(remainingPercent: 72, resetsAt: Date.now.timeIntervalSince1970 + 10080 * 60 * 0.43, windowDurationMins: 10080)
        value.messages = [
            NativeMessage(id: "visual-user", role: "user", text: "简单说一下你是怎么支持 sidechat 的"),
            NativeMessage(id: "visual-assistant", role: "assistant", text: """
            项目里的 Sidechat 本质是**从主聊分叉出的临时独立聊天**：
            - **继承上下文**：通过 Codex App Server 的 `thread/fork`，从主聊天最近一轮已结束的对话创建分支，继承模型设置、远程机器、目录和容器。
            - **独立运行**：有自己的消息和执行轮次，可与主聊天并行；界面只显示分叉后新增的消息。
            - **明确边界**：注入专门指令，要求继承历史仅作参考，不自动接着执行主任务；默认只读探索，修改需要用户在 Sidechat 中明确提出，并禁止创建子代理。
            - **临时存储**：聊天内容由 Codex 管理，本地只保存关联信息和消息轮次 ID；关闭或过期后清理，daemon 重启后不保证恢复。

            注意：**对话独立，但文件环境共享**，Sidechat 中获准进行的文件修改仍会影响同一工作目录。

            核心实现在 [codex-sessions.mjs](/tmp/demo/codex-sessions.mjs)。
            """, status: "Worked for 24s", actions: [NativePanelItem(id: "visual-copy", kind: "action", title: "Copy", command: NativeCommand(name: "message.copy", params: ["id": .string("visual-assistant")]))], timestamp: 1791603780)
        ]
        value.groups = [NativeGroup(id: "visual-pinned", title: "Pinned", items: ["获取方舟 token", "说明 Sidechat 支持方式", "总结 Seedance 2.5 on AMD 内容", "总结 AMD Seedance Q3 工作"].enumerated().map { row($0.element, id: "pinned-\($0.offset)") }, category: "pinned")]
        for (index, title) in ["tensor_rt", "render-v2-prod", "WorkIntensity", "tensor-amd-ops", "demo_gpu_monitor"].enumerated() {
            let id = "visual-project-\(index)"
            let expanded = index == 4
            value.groups.append(NativeGroup(id: id, title: title, items: expanded ? [row("克隆 tensor_rt 到开发机", id: "project-child-1"), row("排查 app-server 同步失败", id: "project-child-2")] : [], command: NativeCommand(name: "project.toggle", params: ["backendId": .string("visual-device"), "cwd": .string("/demo/\(title)")]), collapsed: !expanded, category: "project", newCommand: NativeCommand(name: "thread.new", params: ["backendId": .string("visual-device"), "cwd": .string("/demo/\(title)")])))
        }
        value.groups.append(NativeGroup(id: "visual-recent", title: "Recents", items: (0..<8).map { row($0 == 0 ? "更新 grill-me skill" : "最近的开发会话 \($0)", id: "recent-\($0)") }, category: "recent", newCommand: NativeCommand(name: "thread.new")))
        return value
    }
    private static func row(_ title: String, id: String) -> NativeNavigationItem {
        NativeNavigationItem(id: id, title: title, command: NativeCommand(name: "thread.open", params: ["backendId": .string("visual-device"), "threadId": .string(id)]))
    }
}
