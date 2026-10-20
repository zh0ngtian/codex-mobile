import Foundation

enum NativePlainText {
    static func message(_ source: String, role: String) -> String {
        guard role != "user" else { return source }
        return NativeMarkdownBlock.parse(source).map { block in
            if block.kind == .code { return block.text }
            if block.kind == .table {
                return block.rows.enumerated().map { rowIndex, row in
                    row.enumerated().map { columnIndex, text in
                        String(NativeInlineMarkdown.text(text, scope: block.cellScopes[rowIndex][columnIndex]).characters)
                    }.joined(separator: "\t")
                }.joined(separator: "\n")
            }
            return String(NativeInlineMarkdown.text(block.text, scope: block.scope).characters)
        }.joined(separator: "\n\n")
    }
}
