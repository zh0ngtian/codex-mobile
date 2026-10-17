import SwiftUI

struct TransportSettingsScreen: View {
    @Environment(AppPreferences.self) private var preferences
    @Environment(AppSession.self) private var session

    var body: some View {
        @Bindable var preferences = preferences
        Form {
            Section {
                Picker(preferences.text("传输方式", "Transport"), selection: $preferences.transport) {
                    Text("HTTP").tag("HTTP")
                    Text("Stream").tag("Stream")
                }
                .pickerStyle(.inline)
                .labelsHidden()
            } footer: {
                Text(preferences.text("HTTP 使用请求与响应同步，Stream 持续接收网关更新。切换后会重新连接设备，已有输入会保留。", "HTTP synchronizes requests and responses. Stream continuously receives gateway updates. Switching reconnects devices and preserves your input."))
            }
            if let error = preferences.settingsError {
                Section { Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.red) }
            }
        }
        .navigationTitle(preferences.text("传输方式", "Transport"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { SettingsCloseButton() }
    }

}
