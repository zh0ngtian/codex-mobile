import SwiftUI

struct ProjectFolderIcon: View {
    @ScaledMetric(relativeTo: .body) private var size = 20.0
    let isExpanded: Bool

    var body: some View {
        Image(isExpanded ? "ProjectFolderOpen" : "ProjectFolderClosed")
            .renderingMode(.template)
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}
