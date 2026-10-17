import SwiftUI

struct NewTaskTargets: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    var body: some View {
        HStack(spacing: 12) {
            Menu {
                ForEach(session.devices.filter(\.enabled)) { device in
                    Button { session.changeEditorDevice(device.id) } label: {
                        Label(device.name, systemImage: session.composer.deviceID == device.id ? "checkmark" : "laptopcomputer")
                    }
                }
            } label: {
                Label(session.currentDevice?.name ?? preferences.text("选择机器", "Choose computer"), systemImage: "laptopcomputer")
                    .font(.subheadline).lineLimit(1).frame(maxWidth: .infinity, minHeight: 44)
            }
            .tint(AgentTheme.ink)
            .accessibilityIdentifier("new.computer")
            Menu {
                Button(preferences.text("无项目", "No project")) { chooseProject(nil) }
                ForEach(session.currentDevice?.projects ?? [], id: \.self) { project in
                    Button { chooseProject(project) } label: {
                        Label(project, systemImage: session.composer.project == project ? "checkmark" : "folder")
                    }
                }
            } label: {
                Label(session.composer.project ?? preferences.text("选择项目", "Choose project"), systemImage: "folder")
                    .font(.subheadline).lineLimit(1).frame(maxWidth: .infinity, minHeight: 44)
            }
            .tint(AgentTheme.ink)
            .accessibilityIdentifier("new.project")
        }
        .foregroundStyle(AgentTheme.ink)
        .padding(.horizontal, 10)
        .background(AgentTheme.code, in: .rect(cornerRadius: 18))
    }
    private func chooseProject(_ project: String?) { session.composer.project = project; session.configurationDidChange() }
}
