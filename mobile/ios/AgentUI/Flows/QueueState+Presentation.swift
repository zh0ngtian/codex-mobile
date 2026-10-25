import SwiftUI

extension QueueState {
    @MainActor func title(using preferences: AppPreferences) -> String {
        switch self {
        case .queued: preferences.text("排队中", "Queued")
        case .sending: preferences.text("发送中", "Sending")
        case .failed: preferences.text("发送失败", "Failed")
        case .uncertain: preferences.text("结果待确认", "Awaiting confirmation")
        case .guiding: preferences.text("正在改为引导", "Converting to guidance")
        }
    }

    var symbol: String {
        switch self {
        case .queued: "clock"
        case .sending: "arrow.up.circle"
        case .failed: "exclamationmark.circle"
        case .uncertain: "questionmark.circle"
        case .guiding: "arrow.triangle.turn.up.right.diamond"
        }
    }

    var color: Color {
        switch self {
        case .queued, .sending, .guiding: .primary
        case .failed: .red
        case .uncertain: .orange
        }
    }
}
