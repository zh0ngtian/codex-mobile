import Foundation

enum PreviewTab: String, CaseIterable, Identifiable {
    case preview, source
    var id: String { rawValue }
}
