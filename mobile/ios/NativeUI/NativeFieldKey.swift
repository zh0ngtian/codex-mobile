struct NativeFieldKey: Hashable {
    var scope: NativeFieldScope
    var itemID: String
    var wireValue: String {
        let parts: [String]
        switch scope {
        case .panel(let id): parts = ["panel", id, itemID]
        case .message(let id): parts = ["message", id, itemID]
        }
        return parts.map { "\($0.utf8.count):\($0)" }.joined()
    }
}
