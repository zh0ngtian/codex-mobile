import Foundation

extension AppPreferences {
    /// Translates only known app notices. Conversation text, file content, and unknown messages are preserved.
    func runtimeText(_ message: String) -> String {
        guard isEnglish else { return message }
        if let translated = Self.runtimeTranslations[message] { return translated }
        return message
    }

    private static let runtimeTranslations: [String: String] = [
        "请输入设备名称和带 token 的完整 HTTP(S) 网关地址。": "Enter a device name and a full HTTP(S) gateway URL containing a token.",
        "最多保存 8 台设备。": "You can save up to eight devices.",
        "通知对应的设备或会话不可用": "The device or conversation for this notification is unavailable.",
        "本地记录读取失败，请在草稿箱重试。": "Could not read local records. Retry in Drafts.",
        "本地保存失败，请重试。": "Could not save locally. Try again.",
        "上次发送结果待确认": "The previous send result needs confirmation.",
        "发送结果待确认，后续队列已暂停。": "The send result needs confirmation. The remaining queue is paused.",
        "发送失败，内容已保留，可以手动重试。": "Sending failed. Your content has been kept for manual retry.",
        "连接中断，尚未确认发送。": "Connection interrupted. Sending has not been confirmed.",
        "正在等待确认；取消记录不会撤销可能已提交的任务。": "Waiting for confirmation. Removing this record does not undo a task that may already have been submitted.",
        "连接不可用，决定尚未提交，请重试。": "Connection unavailable. Your decision has not been submitted. Try again.",
        "连接中断，决定尚未提交，请重试。": "Connection interrupted. Your decision has not been submitted. Try again.",
        "连接不可用，答案已保留，请重试。": "Connection unavailable. Your answers have been kept. Try again.",
        "提交失败，答案已保留，请重试。": "Submission failed. Your answers have been kept. Try again.",
        "草稿已保存到本机": "Draft saved on this phone.",
        "目标设备已移除，草稿仍保留。": "The target device was removed. Your draft has been kept.",
        "已刷新会话": "Conversation refreshed.",
        "会话列表已刷新": "Conversation list refreshed.",
        "已复制会话": "Conversation copied.",
        "已发送引导": "Guidance sent.",
        "已复制会话 ID": "Conversation ID copied.",
        "已复制": "Copied.",
        "通知设置已保存": "Notification settings saved.",
        "无法保存这条队列消息，请重试。": "This queued message could not be saved. Try again.",
        "暂时无法取消这条消息。": "This message could not be removed right now.",
        "暂时无法移除这条记录。": "This record could not be removed right now."
    ]
}
