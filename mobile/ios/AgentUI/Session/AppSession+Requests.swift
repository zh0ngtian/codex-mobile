import Foundation

extension AppSession {
    func questionPanelSubmitting(_ panel: NativePanel?) -> Bool {
        guard let panel else { return false }
        let items = flatten(panel.items)
        return items.contains { $0.id == "approval-pending" } || (items.first { $0.command?.name == "approval.submit" }?.disabled == true && items.first { $0.command?.name == "approval.dismiss" }?.disabled == true)
    }
    func reconcileConfirmedQuestions(_ panel: NativePanel?) {
        guard let backend = nativeSnapshot.backendId else { return }
        let current = panel.map { scopedID("request", backend, $0.id) }
        for id in confirmedQuestionReplies.keys.filter({ confirmedQuestionReplies[$0] == backend && $0 != current }) {
            clearQuestionMemory(id); confirmedQuestionReplies.removeValue(forKey: id)
            questions.removeAll { $0.id == id }
            if activeQuestionID == id { activeQuestionID = nil }
        }
    }
    func projectRequests(_ panel: NativePanel?) {
        reconcileConfirmedQuestions(panel)
        guard let panel else {
            approvals = []; questions = []; activeApprovalID = nil; activeQuestionID = nil
            if nativeSnapshot.approvalCount == 0, nativeSnapshot.connection == "online", let backend = nativeSnapshot.backendId {
                for id in questionBackends.keys.filter({ questionBackends[$0] == backend }) { clearQuestionMemory(id) }
                confirmedQuestionReplies = confirmedQuestionReplies.filter { $0.value != backend }
            }
            return
        }
        let items = flatten(panel.items)
        let rawThread = items.first { $0.id == "approval-thread-id" }?.text ?? nativeSnapshot.threadId
        guard let backend = nativeSnapshot.backendId, let rawThread else { return }
        let thread = scopedID("thread", backend, rawThread)
        let id = scopedID("request", backend, panel.id)
        if items.contains(where: { $0.command?.name == "approval.submit" }) {
            let prior = questions.first { $0.id == id } ?? questionMemory[id]
            let fields = panel.items.filter { $0.kind == "section" }.map { section in
                let children = section.children ?? []
                let prompt = children.first { $0.id.hasSuffix(":prompt") }
                let choice = children.first { $0.kind == "singleChoice" }
                let answer = children.first { ["secureField", "multilineField"].contains($0.kind) }
                let options = (choice?.options ?? []).filter { $0.value.hasPrefix("option:") }.map { option in QuestionOption(id: scopedID("question-option", panel.id, section.id, option.value), title: option.title, detail: option.subtitle ?? "") }
                return AgentQuestion(id: scopedID("question", panel.id, section.id), title: section.title ?? "", detail: prompt?.text ?? "", options: options, allowsCustom: answer != nil, secret: answer?.kind == "secureField")
            }
            var request = QuestionRequest(id: id, conversationID: thread, questions: fields)
            request.answers = (prior?.answers ?? [:]).filter { key, _ in fields.contains { $0.id == key } }; request.submitting = questionPanelSubmitting(panel) || answerSubmissionsInFlight.contains(id) || confirmedQuestionReplies[id] != nil; request.error = items.first { $0.id == "approval-error" }?.text ?? prior?.error
            questions = [request]; approvals = []; questionPanels[id] = panel
            questionMemory[id] = request; questionBackends[id] = backend
            let explicitlyReopened = reopenRequestIntent
            if explicitlyReopened { postponedQuestionIDs.remove(id); reopenRequestIntent = false }
            if activeQuestionID == nil, selectedConversationID == thread || explicitlyReopened, !postponedQuestionIDs.contains(id) { activeQuestionID = id }
            activeApprovalID = nil
            if let index = index(thread) { conversations[index].phase = .waitingAnswer }
        } else {
            var commands: [UUID: NativeCommand] = [:]
            var choices: [ApprovalChoice] = []
            for item in items where item.command?.name == "approval.decide" {
                guard let command = item.command else { continue }
                let raw = item.value?.data(using: .utf8).flatMap { try? JSONSerialization.jsonObject(with: $0, options: [.fragmentsAllowed]) }
                let decision: ApprovalDecision?
                if let string = raw as? String {
                    decision = ["accept": .allowOnce, "acceptForSession": .allowSession, "decline": .deny, "cancel": .cancelTurn][string]
                } else if let object = raw as? [String: Any] {
                    if object["acceptWithExecpolicyAmendment"] != nil { decision = .rememberPrefix }
                    else if let amendment = object["applyNetworkPolicyAmendment"] as? [String: Any], let policy = amendment["network_policy_amendment"] as? [String: Any] { decision = policy["action"] as? String == "deny" ? .blockHost : .rememberHost }
                    else { decision = nil }
                } else { decision = nil }
                let choiceID = scopedID("approval-choice", backend, panel.id, item.id, item.value ?? "", command.id)
                choices.append(ApprovalChoice(id: choiceID, title: item.title ?? item.text ?? panel.title, decision: decision, rawValue: item.value, disabled: item.disabled == true))
                commands[choiceID] = command
            }
            let prior = approvals.first { $0.id == id }
            let paths = items.filter { $0.id == "approval:grantRoot" || ["permissions:read", "permissions:write"].contains($0.id) || $0.id.hasPrefix("permissions:entry:") }.compactMap(\.text).reduce(into: [String]()) { paths, value in
                if !paths.contains(value) { paths.append(value) }
            }
            var request = ApprovalRequest(id: id, conversationID: thread, reason: items.first { $0.id == "approval:reason" }?.text ?? panel.title, command: items.first { $0.id == "approval:command" }?.text, directory: items.first { $0.id == "approval:cwd" }?.text, host: items.first { $0.id == "network" }?.text, paths: paths, decisions: ApprovalDecision.allCases.filter { semantic in choices.contains { $0.decision == semantic } }, choices: choices)
            request.submitting = prior?.submitting ?? false; request.error = items.first { $0.id == "approval-error" }?.text ?? prior?.error
            approvals = [request]; questions = []; requestCommands[id] = commands
            if selectedConversationID == thread { activeApprovalID = id }; activeQuestionID = nil
            if let index = index(thread) { conversations[index].phase = .waitingApproval }
        }
    }
    func submitApproval(_ id: UUID, decision: ApprovalDecision) async {
        let matching = approval(id)?.choices.filter { $0.decision == decision } ?? []
        guard matching.count == 1, let choice = matching.first else { toast = "存在多个审批目标，请选择具体操作。"; return }
        await submitApproval(id, choiceID: choice.id)
    }
    func submitApproval(_ id: UUID, choiceID: UUID) async {
        guard let index = approvals.firstIndex(where: { $0.id == id }), !approvals[index].submitting, approvals[index].choices.contains(where: { $0.id == choiceID && !$0.disabled }), let command = requestCommands[id]?[choiceID] else { return }
        approvals[index].submitting = true; approvals[index].error = nil
        let ok = await request(command.name, command.params)
        if let index = approvals.firstIndex(where: { $0.id == id }) { approvals[index].submitting = false; if !ok { approvals[index].error = toast } }
    }
    func setAnswer(requestID: UUID, questionID: UUID, answer: QuestionAnswer) {
        guard let index = questions.firstIndex(where: { $0.id == requestID }), !questions[index].submitting else { return }
        questions[index].answers[questionID] = answer
        questionMemory[requestID] = questions[index]
    }
    func postponeQuestion() {
        guard let id = activeQuestionID, let pending = question(id), !pending.submitting, !questionPanelSubmitting(questionPanels[id]) else { return }
        questionMemory[id] = pending; postponedQuestionIDs.insert(id)
        activeQuestionID = nil
        if let panel = questionPanels[id], let command = flatten(panel.items).first(where: { $0.command?.name == "approval.dismiss" })?.command { perform(command) }
    }
    func clearQuestionMemory(_ id: UUID) {
        questionMemory.removeValue(forKey: id); questionBackends.removeValue(forKey: id)
        questionPanels.removeValue(forKey: id); postponedQuestionIDs.remove(id); answerSubmissionsInFlight.remove(id)
    }
    func submitAnswers(_ id: UUID) async {
        guard let index = questions.firstIndex(where: { $0.id == id }), questions[index].isValid, !questions[index].submitting, let panel = questionPanels[id] else { return }
        let pending = questions[index]
        answerSubmissionsInFlight.insert(id)
        questions[index].submitting = true; questions[index].error = nil
        questionMemory[id] = questions[index]
        let sections = panel.items.filter { $0.kind == "section" }
        for (position, question) in pending.questions.enumerated() {
            guard sections.indices.contains(position), let answer = pending.answers[question.id] else { return }
            let section = sections[position]
            let children = section.children ?? []
            let custom = question.options.isEmpty || answer.custom
            let field = children.first { custom ? ["secureField", "multilineField"].contains($0.kind) : $0.kind == "singleChoice" }
            guard let field, let command = field.command else { return }
            let value: String
            if custom { value = answer.text }
            else { guard let optionIndex = question.options.firstIndex(where: { $0.id == answer.optionID }) else { return }; value = "option:\(optionIndex)" }
            var params = command.params; params["value"] = .string(value)
            guard await request(command.name, params) else { finishAnswerRequest(id, error: toast); return }
        }
        guard let command = flatten(panel.items).first(where: { $0.command?.name == "approval.submit" })?.command else { finishAnswerRequest(id, error: "请求已变化，答案已保留"); return }
        let ok = await request(command.name, command.params)
        if ok {
            answerSubmissionsInFlight.remove(id)
            if let backend = questionBackends[id] { confirmedQuestionReplies[id] = backend }
            // 即使业务 Promise 已完成，旧权威面板仍在时也保留答案，等请求投影消失后清理。
            let current = nativeSnapshot.approvalPanel ?? (nativeSnapshot.panel?.id.hasPrefix("approval:") == true ? nativeSnapshot.panel : nil)
            reconcileConfirmedQuestions(current)
        } else { finishAnswerRequest(id, error: toast) }
    }
    private func finishAnswerRequest(_ id: UUID, error: String?) {
        answerSubmissionsInFlight.remove(id)
        let serverSubmitting = questionPanelSubmitting(questionPanels[id])
        if let index = questions.firstIndex(where: { $0.id == id }) { questions[index].submitting = serverSubmitting; questions[index].error = error }
        if var memory = questionMemory[id] { memory.submitting = serverSubmitting; memory.error = error; questionMemory[id] = memory }
    }

}
