import SwiftUI

/// 主页面和当前 sheet 使用同一个错误队列，等待系统 alert 完成关闭后再呈现下一条。
struct SessionErrorAlert: ViewModifier {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    @Binding var presentationActive: Bool
    let enabled: Bool
    @State private var presentedNotice: AppErrorNotice?
    @State private var closingID: String?

    func body(content: Content) -> some View {
        content
            .alert(preferences.text("错误", "Error"), isPresented: alertPresented, presenting: presentedNotice) { _ in
                Button(preferences.text("知道了", "OK"), role: .cancel) { dismissNotice() }
            } message: { notice in
                Text(preferences.runtimeText(notice.message))
            }
            .background {
                ConfirmationDismissalObserver(closingID: closingID, panelID: presentedNotice?.id.uuidString) { id in
                    guard closingID == id else { return }
                    closingID = nil
                }
                .frame(width: 0, height: 0).accessibilityHidden(true)
            }
            .task { presentNext() }
            .onChange(of: session.errorNotices) { presentNext() }
            .onChange(of: enabled) { presentNext() }
            .onChange(of: closingID) {
                guard closingID == nil else { return }
                presentNext()
                if presentedNotice == nil { presentationActive = false }
            }
            .onDisappear {
                if presentedNotice != nil || closingID != nil { presentationActive = false }
            }
    }

    private var alertPresented: Binding<Bool> {
        Binding(get: { presentedNotice != nil }, set: { if !$0 { dismissNotice() } })
    }

    private func presentNext() {
        guard enabled, presentedNotice == nil, closingID == nil, let notice = session.errorNotices.first else { return }
        session.inputFocused = false
        presentationActive = true
        presentedNotice = notice
    }

    private func dismissNotice() {
        guard let notice = presentedNotice else { return }
        closingID = notice.id.uuidString
        presentedNotice = nil
        session.dismissError(notice.id)
    }
}
