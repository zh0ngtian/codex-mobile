import SwiftUI

struct SettingsRow: View {
    let title: String
    let symbol: String
    var value: String? = nil
    var body: some View {
        LabeledContent { if let value { Text(value).foregroundStyle(.secondary) } } label: { Label(title, systemImage: symbol) }
    }
}
