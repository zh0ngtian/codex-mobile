import Foundation

enum DeviceConnectionState: String, Codable, CaseIterable, Sendable {
    case connected, connecting, paused, failed
}
