import SwiftUI

struct NativeMarkdownTableView: View {
    let rows: [[String]]
    let scale: Double
    var store: NativeUIStore? = nil
    var cellScopes: [[NativeMarkdownHTMLScope]] = []
    @Environment(\.displayScale) private var displayScale
    private var columnCount: Int { rows.map(\.count).max() ?? 0 }
    var body: some View {
        ScrollView(.horizontal) {
            Grid(alignment: .topLeading, horizontalSpacing: 0, verticalSpacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.offset) { rowIndex, cells in
                    GridRow {
                        ForEach(Array(cells.enumerated()), id: \.offset) { columnIndex, text in
                            NativeInlineContentView(text: text, store: store, compact: true,
                                scope: cellScope(row: rowIndex, column: columnIndex), textStyle: .subheadline, strong: rowIndex == 0)
                                .frame(maxWidth: 260, alignment: .leading)
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
