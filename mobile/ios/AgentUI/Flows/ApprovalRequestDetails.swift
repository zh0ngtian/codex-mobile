import SwiftUI

struct ApprovalRequestDetails: View {
    @Environment(AppPreferences.self) private var preferences
    let request: ApprovalRequest

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(preferences.text("需要你的批准", "Your approval is needed"), systemImage: "hand.raised.fill")
                .font(.title2.bold())
                .padding(.bottom, 2)
            Text(request.reason)
                .font(.body)
                .textSelection(.enabled)
                .padding(.bottom, 6)
            if let command = request.command {
                FlowDetailRow(title: preferences.text("命令", "Command"), value: command, monospaced: true)
            }
            if let directory = request.directory {
                FlowDetailRow(title: preferences.text("工作目录", "Working directory"), value: directory, monospaced: true)
            }
            if let host = request.host {
                FlowDetailRow(title: preferences.text("网络目标", "Network destination"), value: host, monospaced: true)
            }
            if !request.paths.isEmpty {
                FlowDetailRow(title: preferences.text("请求访问的路径", "Requested paths"), value: request.paths.joined(separator: "\n"), monospaced: true)
            }
            if let error = request.error {
                FlowErrorBanner(message: error)
            }
        }
    }
}
