import Foundation

enum ConversationIDClipboard {
    @discardableResult static func copy(_ rawID: String?, write: (String) -> Void) -> Bool {
        guard let rawID, !rawID.isEmpty else { return false }
        write(rawID)
        return true
    }
}
