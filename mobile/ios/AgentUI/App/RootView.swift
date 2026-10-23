import SwiftUI

struct RootView: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    @State private var modal: AppModal?
    @State private var lastPresentedModal: AppModal?
    @State private var waitingForDismissal = false
    @State private var addDeviceRequested = false
    @State private var offeredFirstDevice = false
    @State private var answeredConfirmationID: String?
    @State private var confirmationClosingID: String?
    @State private var errorAlertActive = false

    var body: some View {
        archivePresentation
            .modifier(SessionErrorAlert(presentationActive: $errorAlertActive, enabled: canPresentRootError))
            .overlay(alignment: .top) { toastContent }
            .task(id: session.toast) { await clearToastLater() }
            .task {
                offerFirstDeviceIfNeeded()
                synchronizePresentation()
            }
            .onChange(of: canOfferFirstDevice) { offerFirstDeviceIfNeeded() }
            .onChange(of: presentationRequests) { synchronizePresentation() }
            .onChange(of: session.errorNotices) { synchronizePresentation() }
            .onChange(of: errorAlertActive) { synchronizePresentation() }
            .onChange(of: session.inputModalPresented) { synchronizePresentation() }
            .onChange(of: session.renameTargetID) { renameTargetChanged() }
            .onChange(of: session.archiveTargetID) { synchronizePresentation() }
            .onChange(of: session.nativePanel?.id) {
                answeredConfirmationID = nil
                synchronizePresentation()
            }
    }

    private var drawerContent: some View {
        GeometryReader { geometry in
            drawerContent(safeAreaInsets: geometry.safeAreaInsets)
        }
    }

    private func drawerContent(safeAreaInsets: EdgeInsets) -> some View {
        AgentDrawer(isOpen: Binding(get: { sidebarIsVisible }, set: { session.sidebarVisible = $0 }),
                    gesturesEnabled: canUseSidebarGesture) {
            NavigationStack {
                VStack(spacing: 0) {
                    if !session.sidebarVisible, let device = bannerDevice { otherDeviceBanner(device) }
                    mainContent
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(AgentTheme.page)
                .toolbarVisibility(session.nativeSnapshot.ready && !session.devices.isEmpty ? .visible : .hidden, for: .navigationBar)
            }
        } sidebar: {
            SidebarScreen()
                .padding(.top, safeAreaInsets.top)
                .padding(.bottom, safeAreaInsets.bottom)
        }
        .foregroundStyle(AgentTheme.ink)
        .background {
            ConfirmationDismissalObserver(closingID: confirmationClosingID, panelID: session.nativePanel?.id) { id in
                guard confirmationClosingID == id else { return }
                confirmationClosingID = nil
                synchronizePresentation()
            }
            .frame(width: 0, height: 0).accessibilityHidden(true)
        }
    }

    private var sheetPresentation: some View {
        drawerContent
            .sheet(item: modalBinding, onDismiss: modalDidDismiss) { destination in
                sizedModalContent(destination)
                    .modifier(SessionErrorAlert(presentationActive: $errorAlertActive, enabled: !session.inputModalPresented))
                    .interactiveDismissDisabled(destination.requiresExplicitDismissal || (session.nativePanel?.dismissible == false && destination.id.hasPrefix("native-panel-")))
            }
    }

    private var confirmationPresentation: some View {
        sheetPresentation
            .alert(confirmationPanel?.title ?? preferences.text("确认操作", "Confirm"), isPresented: confirmationPresented, presenting: confirmationPanel) { panel in
                ForEach(panel.items.filter { $0.id == "confirmation-yes" || $0.id == "confirmation-no" }) { item in
                    Button(item.title ?? "", role: item.id == "confirmation-no" ? .cancel : .destructive) {
                        confirmationClosingID = panel.id
                        answeredConfirmationID = panel.id
                        session.perform(item.command)
                    }
                    .disabled(item.disabled == true)
                }
            } message: { panel in
                Text(panel.items.first(where: { $0.id == "confirmation-yes" })?.text ?? "")
            }
    }

    private var renamePresentation: some View {
        confirmationPresentation
            .background {
                ThreadRenameAlert(targetID: session.renameTargetID,
                    initialName: session.renameTargetID.flatMap(session.conversation)?.title ?? "",
                    title: preferences.text("重命名会话", "Rename conversation"),
                    fieldLabel: preferences.text("会话名称", "Conversation name"),
                    summaryLabel: preferences.text("模型总结", "Model summary"),
                    cancelLabel: preferences.text("取消", "Cancel"), saveLabel: preferences.text("保存", "Save"),
                    summarize: { await session.summarizeTitle($0) }, save: { id, title in
                        session.rename(id, title: title); session.renameTargetID = nil
                    }, cancel: { session.renameTargetID = nil })
                    .frame(width: 0, height: 0)
            }
    }

    private var archivePresentation: some View {
        renamePresentation
            .alert(preferences.text("归档并丢弃排队消息？", "Archive and discard queued messages?"), isPresented: archivePresented, presenting: session.archiveTargetID) { id in
                Button(preferences.text("归档并丢弃队列", "Archive and discard queue"), role: .destructive) { confirmArchive(id) }
                Button(preferences.text("取消", "Cancel"), role: .cancel) { session.archiveTargetID = nil }
            } message: { _ in
                Text(preferences.text("归档后会话将从列表移除。排队记录会被清除，已发生的操作不会被撤销。", "This conversation will leave the list and its queue will be cleared. Operations that already occurred remain in effect."))
            }
    }

    @ViewBuilder private var toastContent: some View {
        if let toast = session.toast {
            Text(preferences.runtimeText(toast))
                .font(.body)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(.regularMaterial, in: .capsule)
                .shadow(color: .black.opacity(0.06), radius: 10, y: 4)
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .allowsHitTesting(false)
                .accessibilityAddTraits(.updatesFrequently)
        }
    }

    @ViewBuilder private var mainContent: some View {
        if !session.nativeSnapshot.ready {
            ProgressView(preferences.text("正在连接…", "Connecting…"))
                .tint(AgentTheme.ink.opacity(0.6))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if session.devices.isEmpty {
            VStack(spacing: 16) {
                NoDevicesView { addDeviceRequested = true }
                if session.draftReadError || session.persistenceError != nil {
                    VStack(spacing: 10) {
                        Label(preferences.runtimeText(session.persistenceError ?? "本地记录读取失败，请在草稿箱重试。"), systemImage: "exclamationmark.triangle")
                            .font(.body)
                            .foregroundStyle(.secondary)
                        Text(preferences.text("已保存内容仍保留。", "Saved data is still preserved."))
                            .font(.body)
                            .foregroundStyle(.secondary)
                        Button(preferences.text("重新读取本地记录", "Retry reading local records"), systemImage: "arrow.clockwise") {
                            session.reloadDrafts()
                        }
                        .buttonStyle(.bordered)
                        .accessibilityIdentifier("root.retryPersistence")
                    }
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
                    .padding(.bottom, 24)
                }
            }
        } else {
            ConversationSurface()
        }
    }

    private var sidebarIsVisible: Bool { session.sidebarVisible && !session.devices.isEmpty }
    private var canOfferFirstDevice: Bool {
        session.nativeSnapshot.ready && session.devices.isEmpty && !session.draftReadError && session.persistenceError == nil
    }
    private var bannerDevice: BackendDevice? {
        session.selectedDeviceID == nil ? nil : session.pendingOtherDevices.first
    }
    private var canUseSidebarGesture: Bool {
        !session.devices.isEmpty && !session.inputModalPresented && !errorAlertActive &&
        session.historyEdit == nil && modal == nil && !waitingForDismissal &&
        session.renameTargetID == nil && session.archiveTargetID == nil && confirmationPanel == nil && confirmationClosingID == nil
    }
    private func otherDeviceBanner(_ device: BackendDevice) -> some View {
        Button {
            session.selectListDevice(device.id)
            session.sidebarVisible = true
        } label: {
            HStack(spacing: 9) {
                Image(systemName: "hand.raised.fill")
                Text(preferences.text("\(device.name) 有 \(session.pendingCount(for: device.id)) 项待处理请求", "\(device.name) has \(session.pendingCount(for: device.id)) pending requests"))
                    .font(.body)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "chevron.right").font(.caption2.bold())
            }
            .foregroundStyle(.orange)
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
            .background(.orange.opacity(0.07))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("requests.otherDevice")
    }

    @ViewBuilder private func sizedModalContent(_ destination: AppModal) -> some View {
        if case .question = destination {
            modalContent(destination)
        } else {
            modalContent(destination).presentationDetents([.large])
        }
    }

    @ViewBuilder private func modalContent(_ destination: AppModal) -> some View {
        switch destination {
        case .settings: SettingsScreen()
        case .drafts: DraftsScreen()
        case .addDevice:
            NavigationStack {
                DeviceManagerScreen(openAddInitially: true)
                    .toolbar {
                        ToolbarItem(placement: .topBarLeading) {
                            Button(preferences.text("完成", "Done")) { addDeviceRequested = false }
                                .accessibilityLabel(preferences.text("完成设备设置", "Finish device setup"))
                        }
                    }
            }
        case .approval(let id): OperationApprovalSheet(requestID: id)
        case .question(let id): QuestionFormSheet(requestID: id)
        case .preview(let item): OutputPreviewSheet(item: item)
        case .nativePanel(let id):
            if let panel = session.nativePanel, panel.id == id, let store = session.nativeStore {
                NativePanelView(panel: panel, store: store)
                    .tint(panel.id.hasPrefix("file:") ? AgentTheme.ink : preferences.accent.color)
            }
        }
    }

    private var presentationRequests: [AppModal] {
        var requests: [AppModal] = []
        if session.settingsPresented { requests.append(.settings) }
        if addDeviceRequested { requests.append(.addDevice) }
        if session.draftsPresented { requests.append(.drafts) }
        if let id = session.activeApprovalID, let request = session.approval(id), session.canInteract(request.conversationID) { requests.append(.approval(id)) }
        if let id = session.activeQuestionID, let request = session.question(id), session.canInteract(request.conversationID) { requests.append(.question(id)) }
        if let item = session.previewItem { requests.append(.preview(item)) }
        if let panel = session.nativePanel, !isOwnedPanel(panel.id) { requests.append(.nativePanel(panel.id)) }
        return requests
    }

    private func isOwnedPanel(_ id: String) -> Bool {
        confirmationPanel?.id == id || id == "devices" || id == "drafts" || id.hasPrefix("settings:") || id.hasPrefix("approval:") || id.hasPrefix("history-edit:") ||
        session.ownsAttachmentPreviewPanel(id)
    }

    private var modalBinding: Binding<AppModal?> {
        Binding(get: { modal }, set: { value in
            if value == nil, modal != nil { waitingForDismissal = true }
            modal = value
        })
    }

    private func sourceIsActive(_ destination: AppModal) -> Bool {
        switch destination {
        case .settings: return session.settingsPresented
        case .drafts: return session.draftsPresented
        case .addDevice: return addDeviceRequested
        case .approval(let id):
            guard session.activeApprovalID == id, let request = session.approval(id) else { return false }
            return session.canInteract(request.conversationID)
        case .question(let id):
            guard session.activeQuestionID == id, let request = session.question(id) else { return false }
            return session.canInteract(request.conversationID)
        case .preview(let item): return session.previewItem?.id == item.id
        case .nativePanel(let id): return session.nativePanel?.id == id && !isOwnedPanel(id)
        }
    }

    private func synchronizePresentation() {
        guard !errorAlertActive else { return }
        if let modal {
            if !sourceIsActive(modal) {
                waitingForDismissal = true
                self.modal = nil
            }
            return
        }
        guard !waitingForDismissal, !session.inputModalPresented, confirmationPanel == nil, confirmationClosingID == nil,
              session.renameTargetID == nil, session.archiveTargetID == nil, session.errorNotices.isEmpty,
              let requestedModal = presentationRequests.first else { return }
        session.inputFocused = false
        lastPresentedModal = requestedModal
        modal = requestedModal
    }

    private func modalDidDismiss() {
        if let destination = lastPresentedModal {
            switch destination {
            case .settings:
                session.settingsPresented = false
                if let id = session.nativePanel?.id, id == "devices" || id.hasPrefix("settings:") { session.closeNativePanel() }
            case .drafts:
                session.draftsPresented = false
                if session.nativePanel?.id == "drafts" { session.closeNativePanel() }
            case .addDevice:
                addDeviceRequested = false
                if session.nativePanel?.id == "devices" { session.closeNativePanel() }
            case .approval, .question: break
            case .preview(let item):
                if session.previewItem?.id == item.id { session.previewItem = nil }
                if session.nativePanel?.id.hasPrefix("attachment:") == true { session.closeNativePanel() }
            case .nativePanel(let id):
                if session.nativePanel?.id == id, !session.ownsAttachmentPreviewPanel(id) { session.closeNativePanel() }
            }
        }
        lastPresentedModal = nil
        waitingForDismissal = false
        synchronizePresentation()
    }

    private var confirmationPanel: NativePanel? {
        guard let panel = session.nativePanel, panel.id.hasPrefix("confirmation:"),
              ["confirmation-yes", "confirmation-no"].allSatisfy({ id in
                  panel.items.contains { $0.id == id && $0.command?.name == "confirmation.answer" }
              }) else { return nil }
        return panel
    }
    private var confirmationPresented: Binding<Bool> {
        Binding(get: {
            guard let panel = confirmationPanel else { return false }
            return !errorAlertActive && confirmationClosingID == nil && answeredConfirmationID != panel.id && modal == nil && !waitingForDismissal && session.renameTargetID == nil
        }, set: { _ in
            // 系统alert仅由显式按钮结算；不把自动关闭回写成第二个取消请求。
        })
    }
    private var archivePresented: Binding<Bool> {
        Binding(get: { session.archiveTargetID != nil && !errorAlertActive }, set: { if !$0 && !errorAlertActive { session.archiveTargetID = nil } })
    }
    private var canPresentRootError: Bool {
        modal == nil && !waitingForDismissal && !session.inputModalPresented &&
        confirmationPanel == nil && confirmationClosingID == nil && session.renameTargetID == nil && session.archiveTargetID == nil
    }
    private func renameTargetChanged() { synchronizePresentation() }
    private func offerFirstDeviceIfNeeded() {
        guard !offeredFirstDevice, canOfferFirstDevice else { return }
        offeredFirstDevice = true
        addDeviceRequested = true
    }
    private func confirmArchive(_ id: UUID) {
        session.archive(id, discardQueue: true)
        session.archiveTargetID = nil
    }
    private func clearToastLater() async {
        guard let current = session.toast else { return }
        do { try await Task.sleep(for: .seconds(2.6)) } catch { return }
        if session.toast == current { session.toast = nil }
    }
}

#Preview {
    RootView().environment(AppSession()).environment(AppPreferences())
}
