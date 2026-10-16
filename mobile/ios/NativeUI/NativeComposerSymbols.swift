import Foundation

/// 仅投影权威速度值；不会复制或预先更改业务状态。
enum NativeComposerSymbols {
    static func speedSymbol(_ value: String?) -> String {
        value == "fast" ? "bolt.fill" : "bolt.slash"
    }
}
