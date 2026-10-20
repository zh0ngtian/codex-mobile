enum NativeTextRhythm {
    static let standardGap: Double = 12
    static let statusToBodyGap: Double = 20
    static let headingToBlockGap: Double = 26
    static let consecutiveListGap: Double = 4
    static let paragraphGap: Double = 24
    static let codeToBlockGap: Double = 22

    static func spacingBefore(_ kind: NativeMarkdownBlockKind, after previous: NativeMarkdownBlockKind?) -> Double {
        guard let previous else { return 0 }
        switch previous {
        case .heading: return headingToBlockGap
        case .list where kind == .list: return consecutiveListGap
        case .list where kind == .text: return paragraphGap
        case .text where kind == .text: return paragraphGap
        case .code: return codeToBlockGap
        default: return standardGap
        }
    }
}
