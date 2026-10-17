import SwiftUI

struct RootView: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    @State private var modal: AppModal?
    @State private var lastPresentedModal: AppModal?
    @State private var waitingForDismissal = false
    @State private var addDeviceRequested = false
    @State private var offeredFirstDevice = false
    @State private var renameText = ""

    var body: some View {
        NavigationStack {
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    VStack(spacing: 0) {
                        if !session.sidebarVisible {
                            if let device = bannerDevice {
                                otherDeviceBanner(device)
                            }
                        }
                        mainContent
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .accessibilityElement(children: .contain)
                    .allowsHitTesting(!sidebarIsVisible)
                    .accessibilityHidden(sidebarIsVisible)
                    if sidebarIsVisible {
                        Color.black.opacity(0.18)
                            .ignoresSafeArea()
                            .contentShape(.rect)
                            .onTapGesture { session.sidebarVisible = false }
                            .accessibilityLabel(preferences.text("收起会话侧栏", "Close conversation sidebar"))
                            .accessibilityAddTraits(.isButton)
                        SidebarScreen()
                            .accessibilityElement(children: .contain)
                            .frame(width: geometry.size.width * 4 / 5, height: geometry.size.height)
                            .background(AgentTheme.page.ignoresSafeArea(edges: .vertical))
                            .overlay(alignment: .trailing) { Rectangle().fill(AgentTheme.line).frame(width: 0.5) }
                            .transition(.move(edge: .leading))
                            .zIndex(1)
                    }
                }
                .contentShape(.rect)
                .simultaneousGesture(sidebarGesture)
                .animation(.easeInOut(duration: 0.22), value: sidebarIsVisible)
            }
            .background(AgentTheme.page)
            .toolbarVisibility(.hidden, for: .navigationBar)
        }
        .foregroundStyle(AgentTheme.ink)
        .sheet(item: modalBinding, onDismiss: modalDidDismiss) { destination in
            modalContent(destination)
                .presentationDetents([.large])
                .interactiveDismissDisabled(destination.requiresExplicitDismissal || (session.nativePanel?.dismissible == false && destination.id.hasPrefix("native-panel-")))
        }
        .alert(preferences.text("重命名会话", "Rename conversation"), isPresented: renamePresented, presenting: session.renameTargetID) { id in
            TextField(preferences.text("会话名称", "Conversation name"), text: $renameText)
            Button(preferences.text("取消", "Cancel"), role: .cancel) { session.renameTargetID = nil }
            Button(preferences.text("保存", "Save")) { saveRename(id) }
                .disabled(!canSaveRename(id))
        }
        .confirmationDialog(preferences.text("归档并丢弃排队消息？", "Archive and discard queued messages?"), isPresented: archivePresented, titleVisibility: .visible, presenting: session.archiveTargetID) { id in
            Button(preferences.text("归档并丢弃队列", "Archive and discard queue"), role: .destructive) { confirmArchive(id) }
            Button(preferences.text("取消", "Cancel"), role: .cancel) { session.archiveTargetID = nil }
        } message: { _ in
            Text(preferences.text("归档后会话将从列表移除。排队记录会被清除，已发生的操作不会被撤销。", "This conversation will leave the list and its queue will be cleared. Operations that already occurred remain in effect."))
        }
        .overlay(alignment: .top) {
            if let toast = session.toast {
                Text(preferences.runtimeText(toast))
                    .font(.footnote.weight(.medium))
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
        .task(id: session.toast) { await clearToastLater() }
        .task {
            offerFirstDeviceIfNeeded()
            synchronizePresentation()
        }
        .onChange(of: canOfferFirstDevice) { offerFirstDeviceIfNeeded() }
        .onChange(of: presentationRequests) { synchronizePresentation() }
        .onChange(of: session.inputModalPresented) { synchronizePresentation() }
        .onChange(of: session.renameTargetID) { renameTargetChanged() }
        .onChange(of: session.archiveTargetID) { synchronizePresentation() }
    }

    @ViewBuilder private var mainContent: some View {
        if !session.nativeSnapshot.ready {
            ProgressView(preferences.text("正在连接…", "Connecting…"))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if session.devices.isEmpty {
            VStack(spacing: 16) {
                NoDevicesView { addDeviceRequested = true }
                if session.draftReadError || session.persistenceError != nil {
                    VStack(spacing: 10) {
                        Label(preferences.runtimeText(session.persistenceError ?? "本地记录读取失败，请在草稿箱重试。"), systemImage: "exclamationmark.triangle")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        Text(preferences.text("已保存内容仍保留。", "Saved data is still preserved."))
                            .font(.footnote)
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
        } else if let id = session.selectedConversationID {
            ConversationScreen(conversationID: id)
                .id(id)
        } else {
            NewConversationScreen()
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
        !session.devices.isEmpty && !session.inputFocused && !session.inputModalPresented &&
        session.historyEdit == nil && modal == nil && !waitingForDismissal &&
        session.renameTargetID == nil && session.archiveTargetID == nil
    }
    private var sidebarGesture: some Gesture {
        DragGesture(minimumDistance: 24, coordinateSpace: .local)
            .onEnded { value in
                guard canUseSidebarGesture,
                      abs(value.translation.width) > max(45, abs(value.translation.height) * 1.3) else { return }
                if sidebarIsVisible && value.translation.width < 0 {
                    session.sidebarVisible = false
                } else if !sidebarIsVisible && value.startLocation.x <= 24 && value.translation.width > 0 {
                    session.sidebarVisible = true
                }
            }
    }

    private func otherDeviceBanner(_ device: BackendDevice) -> some View {
        Button {
            session.selectListDevice(device.id)
            session.sidebarVisible = true
        } label: {
            HStack(spacing: 9) {
                Image(systemName: "hand.raised.fill")
                Text(preferences.text("\(device.name) 有 \(session.pendingCount(for: device.id)) 项待处理请求", "\(device.name) has \(session.pendingCount(for: device.id)) pending requests"))
                    .font(.caption.weight(.medium))
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
        id == "devices" || id == "drafts" || id.hasPrefix("settings:") || id.hasPrefix("approval:") || id.hasPrefix("history-edit:") ||
        (id.hasPrefix("attachment:") && session.previewItem != nil)
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
        if let modal {
            if !sourceIsActive(modal) {
                waitingForDismissal = true
                self.modal = nil
            }
            return
        }
        guard !waitingForDismissal, !session.inputModalPresented,
              session.renameTargetID == nil, session.archiveTargetID == nil,
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
                if session.nativePanel?.id == id, !(id.hasPrefix("attachment:") && session.previewItem != nil) { session.closeNativePanel() }
            }
        }
        lastPresentedModal = nil
        waitingForDismissal = false
        synchronizePresentation()
    }

    private var renamePresented: Binding<Bool> {
        Binding(get: { session.renameTargetID != nil }, set: { if !$0 { session.renameTargetID = nil } })
    }
    private var archivePresented: Binding<Bool> {
        Binding(get: { session.archiveTargetID != nil }, set: { if !$0 { session.archiveTargetID = nil } })
    }
    private func canSaveRename(_ id: UUID) -> Bool {
        guard let conversation = session.conversation(id), conversation.canModify else { return false }
        let title = renameText.trimmingCharacters(in: .whitespacesAndNewlines)
        return !title.isEmpty && title != conversation.title && session.menuBusyID == nil
    }
    private func renameTargetChanged() {
        if let id = session.renameTargetID { renameText = session.conversation(id)?.title ?? "" }
        synchronizePresentation()
    }
    private func offerFirstDeviceIfNeeded() {
        guard !offeredFirstDevice, canOfferFirstDevice else { return }
        offeredFirstDevice = true
        addDeviceRequested = true
    }
    private func saveRename(_ id: UUID) {
        guard canSaveRename(id) else { return }
        session.rename(id, title: renameText)
        session.renameTargetID = nil
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
