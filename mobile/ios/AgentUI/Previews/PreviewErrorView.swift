import SwiftUI

struct PreviewErrorView: View {
    @Environment(AppPreferences.self) private var preferences
    let message: String
    let canRetry: Bool
    let retry: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label(preferences.text("读取失败", "Could not read file"), systemImage: "exclamationmark.triangle")
        } description: {
            Text(message)
        } actions: {
            if canRetry {
                Button(preferences.text("重试", "Retry"), systemImage: "arrow.clockwise", action: retry)
                    .buttonStyle(.borderedProminent)
            }
        }
    }
}
