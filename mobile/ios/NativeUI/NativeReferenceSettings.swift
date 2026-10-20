import Foundation

/// 离线 UI 验收专用资料，绝不进入正式业务快照。
enum NativeReferenceSettings {
    static func panel(locale: String, fontScale: Double) -> NativePanel {
        let chinese = locale.lowercased().hasPrefix("zh")
        let language = NativePanelItem(id: "language", kind: "singleChoice", title: chinese ? "语言" : "Language", value: chinese ? "zh-CN" : "en", options: [
            NativeOption(id: "system", title: chinese ? "跟随系统" : "System", value: "system"),
            NativeOption(id: "zh-CN", title: "中文", value: "zh-CN"), NativeOption(id: "en", title: "English", value: "en")
        ], command: NativeCommand(name: "settings.language"))
        let size = [0.875: "small", 1: "standard", 1.125: "large", 1.25: "extra-large"][fontScale] ?? "small"
        let font = NativePanelItem(id: "font", kind: "singleChoice", title: chinese ? "字体大小" : "Font Size", value: size, options: [
            NativeOption(id: "small", title: chinese ? "小" : "Small", value: "small"), NativeOption(id: "standard", title: chinese ? "标准" : "Standard", value: "standard"),
            NativeOption(id: "large", title: chinese ? "大" : "Large", value: "large"), NativeOption(id: "extra-large", title: chinese ? "特大" : "Extra Large", value: "extra-large")
        ], command: NativeCommand(name: "settings.font"))
        return NativePanel(id: "settings:root", title: chinese ? "设置" : "Settings", items: [language, font,
            NativePanelItem(id: "transport", kind: "singleChoice", value: "http", options: [NativeOption(id: "http", title: "HTTP", value: "http"), NativeOption(id: "stream", title: "SSE", value: "stream")], command: NativeCommand(name: "settings.transport")),
            NativePanelItem(id: "push", kind: "singleChoice", value: "system", options: [NativeOption(id: "system", title: chinese ? "系统推送" : "System Notifications", value: "system")], command: NativeCommand(name: "settings.push.mode"))
        ])
    }
    static func devices(locale: String) -> NativePanel {
        let chinese = locale.lowercased().hasPrefix("zh")
        let devices = [("visual-device", "DEMO5VYDY4", true), ("visual-backup", "MacBook Pro", false)]
        let cards = devices.enumerated().map { index, device in
            let (id, name, online) = device
            func action(_ suffix: String, _ title: String, _ command: String, extra: [String: NativeJSONValue] = [:], disabled: Bool = false) -> NativePanelItem {
                NativePanelItem(id: "\(id):\(suffix)", kind: "action", title: title, command: NativeCommand(name: command, params: ["id": .string(id)].merging(extra) { _, next in next }), disabled: disabled)
            }
            return NativePanelItem(id: id, kind: "section", title: name, text: "https://demo.invalid · \(online ? "online" : "paused") · 0 排队中 · 0 待审批", children: [
                NativePanelItem(id: "\(id):connection", kind: "text", text: online ? (chinese ? "已连接" : "Connected") : (chinese ? "已暂停" : "Paused"), value: online ? "online" : "paused"),
                action("edit", chinese ? "编辑" : "Edit", "device.edit"),
                action("toggle", online ? (chinese ? "暂停" : "Pause") : (chinese ? "启用" : "Enable"), "device.toggle"),
                action("remove", chinese ? "删除" : "Delete", "device.remove"),
                action("up", chinese ? "上移" : "Move Up", "device.move", extra: ["direction": .number(-1)], disabled: index == 0),
                action("down", chinese ? "下移" : "Move Down", "device.move", extra: ["direction": .number(1)], disabled: index == devices.count - 1)
            ])
        }
        return NativePanel(id: "devices", title: chinese ? "设备" : "Devices", items: cards + [NativePanelItem(id: "add", kind: "action", title: chinese ? "添加设备" : "Add Device", command: NativeCommand(name: "device.add"))])
    }
    static func deviceForm(locale: String) -> NativePanel {
        let chinese = locale.lowercased().hasPrefix("zh")
        return NativePanel(id: "devices", title: chinese ? "添加设备" : "Add Device", items: [
            NativePanelItem(id: "name", kind: "textField", title: chinese ? "设备名称" : "Device Name", value: "", command: NativeCommand(name: "device.change", params: ["field": .string("name"), "draftId": .string("visual-new")])),
            NativePanelItem(id: "gatewayUrl", kind: "secureField", title: chinese ? "网关地址" : "Gateway URL", value: "", command: NativeCommand(name: "device.change", params: ["field": .string("gatewayUrl"), "draftId": .string("visual-new")])),
            NativePanelItem(id: "scan", kind: "action", title: chinese ? "扫描网关二维码" : "Scan Gateway QR Code", command: NativeCommand(name: "device.scan")),
            NativePanelItem(id: "save", kind: "action", title: chinese ? "测试并保存" : "Test and Save", command: NativeCommand(name: "device.save")),
            NativePanelItem(id: "cancel", kind: "action", title: chinese ? "取消" : "Cancel", command: NativeCommand(name: "device.cancel"))
        ])
    }
    static func notifications(locale: String, bark: Bool = false) -> NativePanel {
        let chinese = locale.lowercased().hasPrefix("zh")
        var items = [NativePanelItem(id: "push", kind: "singleChoice", title: chinese ? "推送方式" : "Push Method", value: bark ? "bark" : "system", options: [NativeOption(id: "system", title: chinese ? "系统推送" : "System Notifications", value: "system"), NativeOption(id: "bark", title: chinese ? "Bark 推送" : "Bark Notifications", value: "bark")], command: NativeCommand(name: "settings.push.mode"))]
        if bark { items.append(NativePanelItem(id: "bark-url", kind: "secureField", title: chinese ? "Bark 推送链接" : "Bark URL", value: "", command: NativeCommand(name: "settings.push.url"))) }
        items.append(NativePanelItem(id: "push-hint", kind: "text", text: chinese ? (bark ? "任务完成或需要回答时由设备网关发送 Bark 通知，App 退出后也可接收。" : "系统推送会有延迟，并且可能会漏推送。") : "Notification delivery depends on the selected method."))
        items.append(NativePanelItem(id: "push-save", kind: "action", title: chinese ? "保存推送设置" : "Save Notification Settings", command: NativeCommand(name: "settings.push.save")))
        return NativePanel(id: "settings:notifications", title: chinese ? "通知" : "Notifications", items: items)
    }

}
