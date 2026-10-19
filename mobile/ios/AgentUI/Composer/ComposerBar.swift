import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

struct ComposerBar: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    let conversationID: UUID?
    @State private var selectedMention = 0
    @State private var mentionsDismissed = false
    @State private var submitFeedback = 0
    @State private var attachmentFlow = ComposerAttachmentFlow()
    @State private var pickerSelection: ComposerAttachmentSelection?
    @State private var selectedPhotos: [PhotosPickerItem] = []
    @State private var photosPresented = false
    @State private var filesPresented = false
    @State private var attachmentWork: ComposerAttachmentWork?
    @State private var locationAuthorization = NativeLocationAuthorization()
    @FocusState private var focused: Bool
    private var hasPendingAttachment: Bool { !attachmentFlow.items.isEmpty || attachmentFlow.isBusy }
    private var attachmentBlocksSubmission: Bool {
        ComposerAttachmentSubmitGate.blocks(pending: hasPendingAttachment, busy: session.isBusy, hasContent: session.composer.hasContent)
    }
    private var mentionQuery: String? {
        guard !mentionsDismissed, let last = session.composer.text.split(whereSeparator: \.isWhitespace).last, last.hasPrefix("@") else { return nil }
        return String(last.dropFirst())
    }
    private var candidates: [NativeOption] {
        mentionQuery == nil ? [] : session.mentionOptions
    }
    var body: some View {
        @Bindable var session = session
        AgentGlassGroup {
            VStack(spacing: 8) {
                if !candidates.isEmpty {
                    MentionCandidates(candidates: candidates, selected: selectedMention, choose: chooseMention)
                }
                VStack(spacing: 10) {
                    if !session.composer.attachments.isEmpty { ComposerAttachmentStrip() }
                    if !attachmentFlow.items.isEmpty || attachmentFlow.error != nil || attachmentFlow.isLocating {
                        ComposerPendingAttachments(flow: attachmentFlow, retry: retryAttachments, clear: cancelAttachments)
                    }
                    HStack(spacing: 0) {
                        TextField(preferences.text("向 Codex 提问", "Ask Codex"), text: $session.composer.text, axis: .vertical)
                            .font(AgentTheme.body)
                            .lineLimit(1...6)
                            .focused($focused)
                            .submitLabel(.send)
                            .onSubmit(submit)
                            .onKeyPress(keys: [.upArrow, .downArrow, .return, .tab, .escape], action: handleKey)
                            .frame(minHeight: 24)
                            .padding(.horizontal, 4)
                            .disabled(!session.composerCanEdit || session.historyEdit != nil || session.selectedConversation?.readOnly == true || !session.composer.attachmentsReady)
                            .accessibilityIdentifier("message-input")
                    }
                    HStack(spacing: 6) {
                        attachmentMenu
                        ComposerPermissionMenu()
                        ComposerModelMenu()
                        ComposerEffortMenu()
                        RunSpeedButton()
                        Spacer(minLength: 0)
                        ComposerSubmitButton(action: submit).disabled(attachmentBlocksSubmission)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.top, 17)
                .padding(.bottom, 12)
                .modifier(AgentGlassSurface(cornerRadius: 28))
                .frame(maxWidth: .infinity)
                #if DEBUG
                .modifier(AgentComposerGeometryFixture())
                #endif
                if session.selectedConversation?.readOnly == true {
                    Text(preferences.text("只读会话", "Read-only conversation")).font(.body).foregroundStyle(.secondary)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity)
        .sensoryFeedback(.impact, trigger: submitFeedback)
        .onChange(of: focused) { session.inputFocused = focused }
        .onChange(of: session.composer.text) { selectedMention = 0; mentionsDismissed = false }
        .onChange(of: mentionQuery) { _, query in session.searchMentions(query ?? "") }
        .onChange(of: session.selectedConversationID) { focused = false }
        .onChange(of: session.nativeSnapshot.contextId) { cancelAttachments() }
        .onChange(of: session.composer.id) { cancelAttachments() }
        .onChange(of: session.sidebarVisible) { if session.sidebarVisible { focused = false } }
        .onDisappear {
            session.inputFocused = false
            if !photosPresented && !filesPresented { cancelAttachments() }
        }
        .background { attachmentPickerHost }
        .onChange(of: photosPresented) { updateModalState() }
        .onChange(of: filesPresented) { updateModalState() }
        .task(id: attachmentWork?.id) { await performAttachmentWork() }
    }
    private var attachmentPickerHost: some View {
        let selection = pickerSelection
        return Color.clear.frame(width: 0, height: 0)
            .fileImporter(isPresented: $filesPresented, allowedContentTypes: [.item], allowsMultipleSelection: true) { filesSelected($0, selection: selection) }
            .photosPicker(isPresented: $photosPresented, selection: photoSelection(for: selection), matching: .images, preferredItemEncoding: .current)
            .id(selection?.id)
    }
    private var attachmentMenu: some View {
        let contextID = session.nativeSnapshot.contextId
        let composerID = session.composer.id
        return ComposerAttachmentMenu(enabled: session.composerCanEdit && session.historyEdit == nil && attachmentFlow.canSelect && !photosPresented && !filesPresented) { action in
            guard session.nativeSnapshot.contextId == contextID, session.composer.id == composerID else { return }
            chooseAttachment(action)
        }
        .id("\(contextID ?? "")|\(composerID)")
    }
    private func chooseAttachment(_ action: NativeComposerAttachmentAction) {
        guard let selection = attachmentFlow.begin(in: session) else { return }
        focused = false
        pickerSelection = selection
        switch action {
        case .photos: selectedPhotos = []; photosPresented = true
        case .files: filesPresented = true
        case .location: attachmentWork = ComposerAttachmentWork(selection: selection, operation: .location)
        }
        updateModalState()
    }
    private func photoSelection(for selection: ComposerAttachmentSelection?) -> Binding<[PhotosPickerItem]> {
        Binding {
            pickerSelection == selection ? selectedPhotos : []
        } set: { photos in
            guard let selection, pickerSelection == selection, attachmentFlow.isCurrent(selection, in: session) else { return }
            selectedPhotos = photos
            guard !photos.isEmpty else { return }
            attachmentWork = ComposerAttachmentWork(selection: selection, operation: .photos(photos))
            pickerSelection = nil
            photosPresented = false
            selectedPhotos = []
            updateModalState()
        }
    }
    private func filesSelected(_ result: Result<[URL], Error>, selection: ComposerAttachmentSelection?) {
        guard let selection, pickerSelection == selection, attachmentFlow.isCurrent(selection, in: session) else { return }
        pickerSelection = nil
        filesPresented = false
        switch result {
        case .success(let urls):
            if urls.isEmpty { attachmentFlow.cancelSelection(selection) }
            else { attachmentWork = ComposerAttachmentWork(selection: selection, operation: .files(urls)) }
        case .failure(let error):
            if (error as NSError).code == CocoaError.userCancelled.rawValue { attachmentFlow.cancelSelection(selection) }
            else { attachmentFlow.pickerFailed(preferences.text("无法打开所选文件。已保留现有输入，请重新选择。", "Could not open the selected files. Your input is preserved; choose again."), selection: selection, in: session) }
        }
        updateModalState()
    }
    private func retryAttachments() {
        guard let selection = attachmentFlow.selection else { return }
        attachmentWork = ComposerAttachmentWork(selection: selection, operation: .retry)
    }
    private func cancelAttachments() {
        attachmentWork = nil; pickerSelection = nil; selectedPhotos = []
        photosPresented = false; filesPresented = false
        locationAuthorization.cancelPendingRequests()
        attachmentFlow.reset()
        updateModalState()
    }
    private func updateModalState() { session.inputModalPresented = photosPresented || filesPresented }
    private func performAttachmentWork() async {
        guard let work = attachmentWork else { return }
        let succeeded: Bool
        switch work.operation {
        case .files(let urls): succeeded = await attachmentFlow.loadFiles(urls, selection: work.selection, in: session, isEnglish: preferences.isEnglish)
        case .photos(let photos): succeeded = await attachmentFlow.loadPhotos(photos, selection: work.selection, in: session, isEnglish: preferences.isEnglish)
        case .retry: succeeded = await attachmentFlow.retry(in: session, isEnglish: preferences.isEnglish)
        case .location:
            succeeded = await attachmentFlow.insertLocation(selection: work.selection, in: session, isEnglish: preferences.isEnglish) { await locationAuthorization.requestAuthorization() }
        }
        guard attachmentWork?.id == work.id, !Task.isCancelled else { return }
        attachmentWork = nil
        if succeeded, session.nativeSnapshot.contextId == work.selection.contextID, session.composer.id == work.selection.composerID,
           session.composerCanEdit, session.historyEdit == nil { focused = true }
    }
    private func chooseMention(_ value: NativeOption) {
        session.insertMention(value)
        selectedMention = 0; focused = true
    }
    private func handleKey(_ press: KeyPress) -> KeyPress.Result {
        guard !candidates.isEmpty else { return .ignored }
        switch press.key {
        case .upArrow: selectedMention = (selectedMention + candidates.count - 1) % candidates.count
        case .downArrow: selectedMention = (selectedMention + 1) % candidates.count
        case .return, .tab: chooseMention(candidates[min(selectedMention, candidates.count - 1)])
        case .escape: mentionsDismissed = true
        default: return .ignored
        }
        return .handled
    }
    private func submit() {
        if session.isBusy && !session.composer.hasContent, let id = session.selectedConversationID {
            submitFeedback += 1
            session.stopResponse(in: id)
            return
        }
        guard !hasPendingAttachment else { return }
        if !candidates.isEmpty { chooseMention(candidates[min(selectedMention, candidates.count - 1)]); return }
        guard session.canSubmit else { return }
        submitFeedback += 1
        _ = session.submitCurrent()
        focused = false
    }
}
