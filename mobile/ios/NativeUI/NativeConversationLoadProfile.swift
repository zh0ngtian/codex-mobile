#if DEBUG
import Foundation
import Observation
import CryptoKit
import UIKit

/// 显式本地参数才启用；磁盘仅保存阶段、计数和散列，不保存会话正文/地址/凭据。
@MainActor @Observable final class NativeConversationLoadProfile {
    static let shared = NativeConversationLoadProfile()
    nonisolated static let enabled = ProcessInfo.processInfo.arguments.contains("--conversation-load-profile")
    private(set) var status = "idle"
    private let runID = UUID().uuidString
    private var completed: [[String: Any]] = []
    @ObservationIgnored private var trial: Trial?
    private final class Trial {
        let id: String
        let thread: String
        let threadKey: String
        let started = Date().timeIntervalSince1970 * 1000
        var events: [[String: Any]] = []
        var ready = false
        var pending: Set<Int> = []
        var lastUpdate = Date().timeIntervalSince1970 * 1000
        var snapshots = 0
        var lastContext: String?
        init(id: String, thread: String, backend: String) {
            self.id = id; self.thread = thread
            threadKey = SHA256.hash(data: Data((backend + ":" + thread).utf8)).prefix(8).map { String(format: "%02x", $0) }.joined()
        }
    }
    nonisolated static var now: Double { Date().timeIntervalSince1970 * 1000 }
    var activeID: String? { trial?.id }
    var activeThread: String? { trial?.thread }
    var ready: Bool { trial?.ready == true }
    var lastUpdate: Double { trial?.lastUpdate ?? Self.now }
    var waitingForRPC: Bool { trial?.pending.isEmpty == false }

    func begin(_ command: NativeCommand) {
        guard Self.enabled, command.name == "thread.open", case .string(let thread) = command.params["threadId"] else { return }
        let backend: String = { if case .string(let value) = command.params["backendId"] { return value }; return "" }()
        trial = Trial(id: command.id, thread: thread, backend: backend)
        status = "loading:" + command.id
        mark("native-command")
    }
    func receive(_ object: [String: Any]) {
        guard Self.enabled, let value = trial, object["id"] as? String == value.id,
              let phase = object["phase"] as? String,
              ["js-command", "workspace-open", "rpc-start", "rpc-end", "details-ready", "state-updated", "js-ready-snapshot"].contains(phase),
              let wall = object["wallMs"] as? Double, wall.isFinite else { return }
        let raw = object["data"] as? [String: Any] ?? [:]
        var data: [String: Any] = [:]
        for key in ["request", "durationMs", "messages", "textChars", "turns", "ok"] { if let number = raw[key] as? NSNumber { data[key] = number } }
        if let method = raw["method"] as? String, ["thread/resume", "thread/read", "thread/turns/list", "thread/items/list", "mobile/turns/details", "mobile/turns/commentary"].contains(method) { data["method"] = method }
        if let request = (raw["request"] as? NSNumber)?.intValue {
            if phase == "rpc-start" { value.pending.insert(request) }
            if phase == "rpc-end" { value.pending.remove(request); value.lastUpdate = Self.now }
        }
        mark(phase, at: wall, data: data)
    }
    func snapshot(_ snapshot: NativeSnapshot, received: Double, serialized: Double, decoded: Double, store: Double, projected: Double, bytes: Int) {
        guard Self.enabled, let value = trial, snapshot.threadId == value.thread else { return }
        mark("snapshot-state", at: received, data: ["loading": snapshot.loading ?? "", "messages": snapshot.messages.count,
            "contextChanged": value.lastContext != snapshot.contextId, "busy": snapshot.busy,
            "textChars": snapshot.messages.reduce(0) { $0 + $1.text.count }])
        value.lastContext = snapshot.contextId
        guard snapshot.loading == "ready" else { return }
        value.snapshots += 1; value.lastUpdate = Self.now
        guard !value.ready else { return }
        value.ready = true
        mark("native-snapshot", at: received)
        mark("native-serialized", at: serialized, data: ["bytes": bytes])
        mark("native-decoded", at: decoded)
        mark("native-store", at: store)
        mark("native-projected", at: projected, data: ["messages": snapshot.messages.count, "textChars": snapshot.messages.reduce(0) { $0 + $1.text.count }])
    }
    func mark(_ phase: String, at: Double = NativeConversationLoadProfile.now, data: [String: Any] = [:]) {
        guard Self.enabled, let value = trial else { return }
        value.events.append(["phase": phase, "atMs": at, "elapsedMs": at - value.started, "data": data])
    }
    func scroll(_ phase: String, view: UIScrollView?, data extra: [String: Any] = [:]) {
        guard Self.enabled, trial != nil, let view else { return }
        var data = extra
        data["scroll"] = String(ObjectIdentifier(view).hashValue)
        data["offset"] = Double(view.contentOffset.y)
        data["presentedOffset"] = Double(view.layer.presentation()?.bounds.origin.y ?? view.contentOffset.y)
        data["contentHeight"] = Double(view.contentSize.height)
        data["viewportHeight"] = Double(view.bounds.height)
        data["topInset"] = Double(view.adjustedContentInset.top)
        data["bottomInset"] = Double(view.adjustedContentInset.bottom)
        mark(phase, data: data)
    }
    func finish(at wall: Double, timedOut: Bool = false) {
        guard let value = trial else { return }
        mark(timedOut ? "native-timeout" : "native-stable", at: wall, data: ["confirmedAtMs": Self.now, "snapshots": value.snapshots])
        completed.append(["id": value.id, "threadKey": value.threadKey, "mode": ProcessInfo.processInfo.arguments.contains("--profile-cold") ? "process-first" : "repeat", "startedAtMs": value.started, "events": value.events])
        let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("conversation-load-profile-" + runID + ".json")
        if let data = try? JSONSerialization.data(withJSONObject: completed, options: [.sortedKeys]) { try? data.write(to: url, options: .atomic) }
        status = (timedOut ? "error:" : "done:") + value.id
        trial = nil
    }
}
#endif
