import SwiftUI

struct NativeMarkdownTableView: View {
    let rows: [[String]]
    let scale: Double
    var store: NativeUIStore? = nil
    var cellScopes: [[NativeMarkdownHTMLScope]] = []
    @Environment(\.displayScale) private var displayScale
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.legibilityWeight) private var legibilityWeight
    private var columnCount: Int { rows.map(\.count).max() ?? 0 }
    private var columnWidths: [CGFloat] {
        (0..<columnCount).map { column in
            rows.enumerated().reduce(CGFloat(1)) { width, row in
                guard row.element.indices.contains(column) else { return width }
                let parts = NativeMarkdownInlinePart.parse(row.element[column], scope: cellScope(row: row.offset, column: column))
                let naturalWidth = parts.reduce(CGFloat(1)) { result, part in
                    guard part.destination == nil else { return 260 }
                    let source = NativeSelectableMarkdown.inline(part.text, scope: part.scope,
                        font: .preferredFont(forTextStyle: .subheadline), strong: row.offset == 0)
                    let text = NativeSystemTypography.resolved(source, size: dynamicTypeSize, bold: legibilityWeight == .bold)
                    let bounds = text.boundingRect(with: CGSize(width: 100_000, height: 100_000),
                        options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil)
                    return max(result, min(260, ceil(bounds.width)))
                }
                return max(width, naturalWidth)
            }
        }
    }
    var body: some View {
        let widths = columnWidths
        ScrollView(.horizontal) {
            Grid(alignment: .topLeading, horizontalSpacing: 0, verticalSpacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.offset) { rowIndex, cells in
                    GridRow {
                        ForEach(Array(cells.enumerated()), id: \.offset) { columnIndex, text in
                            NativeInlineContentView(text: text, store: store, compact: true,
                                scope: cellScope(row: rowIndex, column: columnIndex), textStyle: .subheadline, strong: rowIndex == 0)
                                // 固定每列的最终宽度后再测换行高度，避免 Grid 的探测宽度造成单元格越过行边界。
                                .frame(width: widths[columnIndex], alignment: .topLeading)
                                .fixedSize(horizontal: false, vertical: true)
                                .padding(.vertical, 12)
                                .padding(.trailing, 20)
                        }
                    }
                    Rectangle().fill(Color(uiColor: .separator))
                        .frame(height: 1 / displayScale)
                        .gridCellColumns(max(1, columnCount))
                        .gridCellUnsizedAxes(.horizontal)
                }
            }
        }
        .accessibilityIdentifier("markdown.table")
        .textSelection(.enabled)
    }
    private func cellScope(row: Int, column: Int) -> NativeMarkdownHTMLScope {
        guard cellScopes.indices.contains(row), cellScopes[row].indices.contains(column) else { return .init() }
        return cellScopes[row][column]
    }
}
