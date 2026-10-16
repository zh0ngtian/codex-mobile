enum NativeFieldScope: Hashable {
    case panel(String)
    case message(String)
    case historyEdit(contextID: String, messageID: String, editID: String)
}
