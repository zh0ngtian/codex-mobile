import SwiftUI

struct WebOutputPreview: View {
    @Environment(AppPreferences.self) private var preferences
    let address: String

    var body: some View {
        ContentUnavailableView {
            Label(preferences.text("网页链接", "Web link"), systemImage: "globe")
        } description: {
            Text(address).textSelection(.enabled)
        } actions: {
            if let url = URL(string: address), ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
                Link(preferences.text("在浏览器中打开", "Open in browser"), destination: url)
                    .buttonStyle(.borderedProminent)
            } else {
                Text(preferences.text("链接地址无效", "Invalid link address")).foregroundStyle(.secondary)
            }
        }
    }
}
