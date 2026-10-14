import SwiftUI

struct NativeMarkdownTableView: View {
    let rows: [[String]]
    let scale: Double
    var store: NativeUIStore? = nil
    var cellScopes: [[NativeMarkdownHTMLScope]] = []
    @ScaledMetric(relativeTo: .body) private var bodySize = 14
    var body: some View {
        ScrollView(.horizontal) {
            Grid(alignment: .topLeading, horizontalSpacing: 0, verticalSpacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.offset) { rowIndex, cells in
                    GridRow {
                        ForEach(Array(cells.enumerated()), id: \.offset) { columnIndex, text in
                            NativeInlineContentView(text: text, store: store, scope: cellScope(row: rowIndex, column: columnIndex))
                                .font(.system(size: bodySize * scale, weight: rowIndex == 0 ? .semibold : .regular))
                                .padding(10).frame(minWidth: 80, maxWidth: 260, maxHeight: .infinity, alignment: .topLeading)
                                .background(rowIndex == 0 ? Color.primary.opacity(0.05) : .clear)
                                .overlay { Rectangle().stroke(.secondary.opacity(0.18), lineWidth: 0.5) }
                        }
                    }
                }
            }.padding(1)
        }.textSelection(.enabled)
    }
    private func cellScope(row: Int, column: Int) -> NativeMarkdownHTMLScope {
        guard cellScopes.indices.contains(row), cellScopes[row].indices.contains(column) else { return .init() }
        return cellScopes[row][column]
    }
}
