import SwiftUI

struct NativeConversationSubtitle: View {
    let project: String?
    let backend: String?
    let scale: Double
    var body: some View {
        HStack(spacing: 4) {
            if let project, !project.isEmpty {
                Text(project).lineLimit(1).truncationMode(.tail)
            }
            if let backend, !backend.isEmpty {
                if let project, !project.isEmpty { Text("·").fixedSize() }
                Text(backend).lineLimit(1).truncationMode(.tail).layoutPriority(1)
            }
        }
        .modifier(NativeScaledFont(size: 12, scale: scale, weight: .semibold, relativeTo: .caption))
        .foregroundStyle(NativePalette.secondary)
    }
}
