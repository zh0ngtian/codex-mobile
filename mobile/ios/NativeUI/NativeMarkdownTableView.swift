import SwiftUI

struct NativeMarkdownTableView: View {
    let rows: [[String]]
    let scale: Double
    var store: NativeUIStore? = nil
    var cellScopes: [[NativeMarkdownHTMLScope]] = []
    @ScaledMetric(relativeTo: .body) private var bodySize = 14.5
    var body: some View {
        ScrollView(.horizontal) {
            Grid(alignment: .topLeading, horizontalSpacing: 0, verticalSpacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.offset) { rowIndex, cells in
                    GridRow {
                        ForEach(Array(cells.enumerated()), id: \.offset) { columnIndex, text in
                            NativeInlineContentView(text: text, store: store, scope: cellScope(row: rowIndex, column: columnIndex))
                                .font(.system(size: bodySize * scale, weight: rowIndex == 0 ? .bold : .medium))
                                .lineLimit(nil)
                                .padding(10)
                                .frame(width: 260, alignment: .topLeading)
                                .fixedSize(horizontal: false, vertical: true)
                                .overlay(alignment: .bottom) { Rectangle().fill(.secondary.opacity(0.25)).frame(height: 0.5) }
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
