import Foundation

/// 离线 UI 验收专用资料，绝不进入正式业务快照。
enum NativeReferenceSettings {
    static func panel(locale: String, fontScale: Double) -> NativePanel {
        let chinese = locale.lowercased().hasPrefix("zh")
        let language = NativePanelItem(id: "language", kind: "singleChoice", title: chinese ? "语言" : "Language", value: chinese ? "zh-CN" : "en", options: [
            NativeOption(id: "system", title: chinese ? "跟随系统" : "System", value: "system"),
            NativeOption(id: "zh-CN", title: "中文", value: "zh-CN"), NativeOption(id: "en", title: "English", value: "en")
        ], command: NativeCommand(name: "settings.language"))
        let font = NativePanelItem(id: "font", kind: "singleChoice", title: chinese ? "字体大小" : "Font Size", value: fontScale == 1.125 ? "large" : "standard", options: [
            NativeOption(id: "small", title: chinese ? "小" : "Small", value: "small"), NativeOption(id: "standard", title: chinese ? "标准" : "Standard", value: "standard"),
            NativeOption(id: "large", title: chinese ? "大" : "Large", value: "large"), NativeOption(id: "extra-large", title: chinese ? "特大" : "Extra Large", value: "extra-large")
        ], command: NativeCommand(name: "settings.font"))
        return NativePanel(id: "settings:root", title: chinese ? "设置" : "Settings", items: [language, font,
            NativePanelItem(id: "transport", kind: "singleChoice", value: "http", options: [NativeOption(id: "http", title: "HTTP", value: "http")])
        ])
    }
}
