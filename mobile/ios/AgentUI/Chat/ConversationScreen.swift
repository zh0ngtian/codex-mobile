import SwiftUI

struct ConversationScreen: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let conversationID: UUID
    @State private var liveExpanded = true
    @State private var atBottom = true
    @State private var followsLatest = true
    @State private var scrollAccess = NativeConversationScrollAccess()
    @State private var loadingHistory = false
    @State private var historyPull = HistoryPullState()
    @State private var historyOffset: Double = 0
    @State private var historyAnchor: UUID?
    @State private var historyAnchorID: String?
    @State private var historyWasPrepended = false
    @State private var scrollIsIdle = true
    @State private var scrollPhase = ScrollPhase.idle
    @State private var returnToken: UUID?
    #if DEBUG
    @State private var diagnosticHistoryRequests = 0
    @State private var diagnosticReturnOffsets: [Double] = []
    @State private var diagnosticReturning = false
    @State private var diagnosticReturnStarted = 0.0
    @State private var diagnosticReturnElapsed = 0.0
    @State private var diagnosticReturnEvents: [String] = []
    @State private var diagnosticReturnStarts = 0
    #endif
    var body: some View {
        if let conversation = session.conversation(conversationID) {
            ScrollViewReader { proxy in
                ScrollView {
                    // 已加载的一页消息必须有真实高度；长 UITextView 的惰性估算会留下空白可视区。
                    VStack(alignment: .leading, spacing: 22) {
                        ConversationStatusBanners(conversation: conversation)
                        if conversation.detailError {
                            ContentUnavailableView {
                                Label(preferences.text("会话加载失败", "Conversation could not load"), systemImage: "exclamationmark.bubble")
                            } actions: {
                                Button(preferences.text("重试", "Retry")) { Task { await session.refreshConversation(conversationID) } }
                            }
                        } else {
                            if loadingHistory || conversation.historyLoading {
                                ProgressView()
                                    .controlSize(.small)
                                    .tint(AgentTheme.ink.opacity(0.6))
                                    .frame(maxWidth: .infinity, minHeight: 24)
                                    .accessibilityLabel(preferences.text("正在加载历史消息", "Loading earlier messages"))
                            } else if conversation.historyError {
                                Text(preferences.text("加载失败，再次下拉重试", "Could not load. Pull down again to retry"))
                                    .font(.body).foregroundStyle(.secondary)
                                    .frame(maxWidth: .infinity)
                            }
                            ForEach(conversation.messages) { message in
                                MessageView(message: message, conversationID: conversationID).id(message.id)
                            }
                            if !conversation.liveCommentary.isEmpty {
                                CommentaryHistoryView(entries: conversation.liveCommentary, expanded: $liveExpanded, completed: false)
                            }
                            if conversation.phase == .running { ThinkingIndicator() }
                            QueuedMessagesView(conversationID: conversationID)
                            Color.clear.frame(height: 1).padding(.bottom, 14).id("bottom")
                        }
                    }
                    .padding(.horizontal, 16).padding(.top, 8)
                    .background {
                        NativeConversationScrollResolver(access: scrollAccess) {
                            withTransaction(Transaction(animation: nil)) { proxy.scrollTo("bottom", anchor: .bottom) }
                        }
                        #if DEBUG
                        if NativeConversationLoadProfile.enabled {
                            NativeLoadRenderProbe(threadID: session.nativeSnapshot.threadId, ready: session.nativeSnapshot.loading == "ready")
                        }
                        #endif
                    }
                }
                .scrollBounceBehavior(.always)
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("conversation.timeline")
                .background(alignment: .topLeading) {
                    #if DEBUG
                    if ProcessInfo.processInfo.arguments.contains("--agent-scroll-diagnostics") {
                        VStack {
                            Text(String(Int(historyOffset))).accessibilityIdentifier("scroll.diagnostic-offset")
                            Text(String(diagnosticHistoryRequests)).accessibilityIdentifier("scroll.diagnostic-history")
                            Text(diagnosticReturnOffsets.map { String(Int($0)) }.joined(separator: ",")).accessibilityIdentifier("scroll.diagnostic-return")
                            Text(String(Int(diagnosticReturnElapsed))).accessibilityIdentifier("scroll.diagnostic-return-ms")
                            Text(diagnosticReturnEvents.joined(separator: ";")).accessibilityIdentifier("scroll.diagnostic-events")
                            Text(String(diagnosticReturnStarts)).accessibilityIdentifier("scroll.diagnostic-starts")
                        }.font(.system(size: 1)).opacity(0.01)
                    }
                    #endif
                }
                .scrollDismissesKeyboard(.interactively)
                .scrollIndicators(.hidden)
                .onScrollPhaseChange { _, phase, context in
                    let offset = Double(context.geometry.contentOffset.y + context.geometry.contentInsets.top)
                    scrollIsIdle = phase == .idle
                    scrollPhase = phase
                    #if DEBUG
                    if returnToken != nil, ProcessInfo.processInfo.arguments.contains("--agent-scroll-diagnostics") { diagnosticReturnEvents.append("phase:\(phase):\(Int(offset))") }
                    #endif
                    switch phase {
                    case .tracking, .interacting:
                        returnToken = nil
                        followsLatest = false
                        scrollAccess.stopFollowing()
                        historyPull.dragBegan(at: offset)
                    case .decelerating:
                        historyPull.dragEnded(at: offset, willDecelerate: true)
                    case .idle:
                        historyPull.dragEnded(at: offset, willDecelerate: false)
                        historyPull.settled(at: offset)
                        restoreHistoryAnchor(proxy)
                        if atBottom { followsLatest = true }
                        resumeBottomFollowingIfReached()
                    case .animating:
                        historyPull.programmaticScrollBegan()
                    @unknown default: break
                    }
                }
                .onScrollGeometryChange(for: Double.self) { geometry in
                    Double(geometry.contentOffset.y + geometry.contentInsets.top)
                } action: { _, offset in
                    historyOffset = offset
                    #if DEBUG
                    if diagnosticReturning, abs(offset - (diagnosticReturnOffsets.last ?? offset)) > 0.5 {
                        if diagnosticReturnOffsets.count == 1 { diagnosticReturnEvents.append("firstMotion:\(Int((Date.timeIntervalSinceReferenceDate - diagnosticReturnStarted) * 1000))") }
                        diagnosticReturnOffsets.append(offset); diagnosticReturnElapsed = (Date.timeIntervalSinceReferenceDate - diagnosticReturnStarted) * 1000
                    }
                    #endif
                    if historyPull.positionChanged(to: offset,
                        canLoad: conversation.loadedOlderTurns < conversation.olderTurns,
                        isLoading: loadingHistory || conversation.historyLoading) {
                        loadEarlier(proxy)
                    }
                }
                .onScrollGeometryChange(for: Bool.self) { geometry in
                    geometry.visibleRect.maxY >= geometry.contentSize.height - 2
                } action: { _, value in
                    #if DEBUG
                    if returnToken != nil, ProcessInfo.processInfo.arguments.contains("--agent-scroll-diagnostics") { diagnosticReturnEvents.append("bottom:\(value):\(Int(historyOffset))") }
                    #endif
                    atBottom = value
                    #if DEBUG
                    if value { diagnosticReturning = false }
                    #endif
                    resumeBottomFollowingIfReached()
                }
                .task(id: session.historyEdit?.messageID) {
                    guard let edit = session.historyEdit, edit.conversationID == conversationID else { return }
                    followsLatest = false
                    scrollAccess.stopFollowing()
                    historyPull.programmaticScrollBegan()
                    await Task.yield()
                    guard !Task.isCancelled, session.historyEdit?.messageID == edit.messageID else { return }
                    proxy.scrollTo(edit.messageID, anchor: .top)
                }
                .onChange(of: conversation.messages.map(\.id)) { oldIDs, newIDs in
                    if let previous = historyAnchor,
                       let anchor = session.historyScrollMessageID(in: conversationID, previousID: previous, anchorID: historyAnchorID),
                       newIDs.first != anchor {
                        historyAnchor = anchor
                        historyWasPrepended = true
                        restoreHistoryAnchor(proxy)
                        return
                    }
                    guard returnToken == nil, !loadingHistory, newIDs.count > oldIDs.count, newIDs.last != oldIDs.last else { return }
                    // 新内容先改变几何高度，不能拿本帧的 atBottom 反推用户是否离开底部。
                    if followsLatest || conversation.messages.last?.isUser == true {
                        historyPull.programmaticScrollBegan()
                        scrollAccess.scrollToBottom()
                    }
                }
                .onChange(of: conversation.historyLoading) {
                    restoreHistoryAnchor(proxy)
                }
                .onChange(of: conversation.queue.count) {
                    if followsLatest && returnToken == nil {
                        historyPull.programmaticScrollBegan()
                        scrollAccess.scrollToBottom()
                    }
                }
                .onChange(of: conversationID) {
                    resetHistory()
                }
                .onChange(of: session.nativeSnapshot.contextId) {
                    resetHistory()
                }
                .overlay {
                    if session.nativeSnapshot.loading == "loading", conversation.messages.isEmpty, conversation.liveCommentary.isEmpty {
                        ProgressView(preferences.text("正在加载对话…", "Loading conversation…"))
                            .tint(AgentTheme.ink.opacity(0.6))
                            .accessibilityIdentifier("conversation.loading")
                    }
                }
                .overlay(alignment: .bottom) {
                    if !atBottom && !conversation.detailError {
                        ScrollToBottomButton { scrollToLatest(proxy) }
                            .padding(.bottom, 4)
                            .transition(.opacity)
                    }
                }
            }
            .background(AgentTheme.page)
            #if DEBUG
            .background(alignment: .topLeading) {
                if ProcessInfo.processInfo.arguments.contains("--agent-entry-transition-fixture") ||
                   ProcessInfo.processInfo.arguments.contains("--agent-entry-diagnostics") {
                    AgentEntryAnimationProbe().frame(width: 1, height: 1)
                }
            }
            #endif
            .safeAreaInset(edge: .top, spacing: 0) {
                if session.nativeSnapshot.sidechatActive == true {
                    SidechatSharedDirectoryBanner()
                }
            }
            .modifier(ConversationHeader(conversationID: conversationID))
            .modifier(ConversationComposerInset(conversationID: conversationID))

        } else { ContentUnavailableView(preferences.text("会话不可用", "Conversation unavailable"), systemImage: "bubble.left") }
    }
    private func scrollToLatest(_ proxy: ScrollViewProxy) {
        #if DEBUG
        let phaseAtStart = scrollPhase
        #endif
        scrollAccess.interruptScrolling()
        historyPull.programmaticScrollBegan()
        historyAnchor = nil; historyAnchorID = nil; historyWasPrepended = false
        // 统一通过末尾消息锚点定位，保留附件高度变化时的跟随。
        scrollAccess.stopFollowing()
        followsLatest = false
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--agent-scroll-diagnostics") { diagnosticReturnOffsets = [historyOffset]; diagnosticReturnStarted = Date.timeIntervalSinceReferenceDate; diagnosticReturnElapsed = 0; diagnosticReturning = true }
        #endif
        let token = UUID()
        returnToken = token
        #if DEBUG
        if diagnosticReturning { diagnosticReturnStarts += 1; diagnosticReturnEvents = ["phaseAtStart:\(phaseAtStart)", "interrupted:\(Int(historyOffset))", "start:\(Int(historyOffset))"] }
        #endif
        let finish = {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--agent-scroll-diagnostics") { diagnosticReturnEvents.append("finish:\(Int(historyOffset)):\(atBottom):\(Int((Date.timeIntervalSinceReferenceDate - diagnosticReturnStarted) * 1000))") }
            #endif
            guard returnToken == token, session.selectedConversationID == conversationID else { return }
            // 持续输出时系统可能提前完成动画事务；交接以实际到达底部且滚动停止为准。
            resumeBottomFollowingIfReached()
        }
        if reduceMotion {
            proxy.scrollTo("bottom", anchor: .bottom)
            finish()
        } else {
            withAnimation(.easeIn(duration: 0.55), completionCriteria: .logicallyComplete) {
                proxy.scrollTo("bottom", anchor: .bottom)
            } completion: { finish() }
        }
    }
    private func resumeBottomFollowingIfReached() {
        guard atBottom, scrollIsIdle else { return }
        if returnToken != nil {
            returnToken = nil
            followsLatest = true
        }
        guard followsLatest else { return }
        scrollAccess.resumeFollowing()
    }
    private func loadEarlier(_ proxy: ScrollViewProxy) {
        guard !loadingHistory, let conversation = session.conversation(conversationID),
              !conversation.historyLoading, conversation.loadedOlderTurns < conversation.olderTurns else { return }
        #if DEBUG
        diagnosticHistoryRequests += 1
        #endif
        let context = session.nativeSnapshot.contextId
        historyAnchor = conversation.messages.first?.id
        historyAnchorID = historyAnchor.flatMap { session.historyScrollAnchor(for: $0) }
        historyWasPrepended = false
        loadingHistory = true
        Task {
            await session.loadEarlier(conversationID)
            guard !Task.isCancelled, session.selectedConversationID == conversationID,
                  session.nativeSnapshot.contextId == context else { return }
            // 等手势结束且加载提示移除后恢复，避免手指仍在拖动时覆盖 scrollTo。
            if session.conversation(conversationID)?.messages.first?.id == historyAnchor {
                historyAnchor = nil; historyAnchorID = nil
            }
            loadingHistory = false
            historyPull.loadingFinished(at: historyOffset)
            restoreHistoryAnchor(proxy)
        }
    }
    private func restoreHistoryAnchor(_ proxy: ScrollViewProxy) {
        guard scrollIsIdle, !loadingHistory,
              session.conversation(conversationID)?.historyLoading == false,
              historyWasPrepended, let anchor = historyAnchor else { return }
        historyPull.programmaticScrollBegan()
        proxy.scrollTo(anchor, anchor: .top)
        historyAnchor = nil
        historyAnchorID = nil
        historyWasPrepended = false
    }
    private func resetHistory() {
        returnToken = nil
        followsLatest = true
        scrollAccess.stopFollowing()
        historyPull.reset()
        historyAnchor = nil; historyAnchorID = nil
        loadingHistory = false; historyWasPrepended = false; scrollIsIdle = true
    }
}
