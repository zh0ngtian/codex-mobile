import Foundation

/// 保留每个真实审批动作的身份与完整目标；同一语义可同时对应多个主机或命令前缀。
struct ApprovalChoice: Identifiable, Codable, Equatable, Sendable {
    var id: UUID
    var title: String
    var decision: ApprovalDecision?
    var rawValue: String?
    var disabled = false
}
