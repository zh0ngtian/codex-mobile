import Foundation

/// 仅投影权威速度值；不会复制或预先更改业务状态。
enum NativeComposerSymbols {
    static func isFastEnabled(_ value: String?) -> Bool {
        // 与既有业务归一化一致：空值及默认别名为正常速度，其余为已启用的服务档位。
        guard let value, !value.isEmpty else { return false }
        return value != "default" && value != "normal"
    }

    static func speedSymbol(_ value: String?) -> String {
        isFastEnabled(value) ? "bolt.fill" : "bolt.slash"
    }

    static func permissionSymbol(_ value: String) -> String {
        switch value {
        case "full-access": "exclamationmark.shield"
        case "read-only": "hand.raised"
        default: "checkmark.shield"
        }
    }

    static func modelTitle(model: String, effort: String, smart: String) -> String {
        let model = model.trimmingCharacters(in: .whitespacesAndNewlines)
        let effort = effort.trimmingCharacters(in: .whitespacesAndNewlines)
        return "\(model.isEmpty ? smart : model) · \(effort.isEmpty ? smart : effort)"
    }
}
