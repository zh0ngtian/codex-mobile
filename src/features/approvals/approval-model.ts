import type { RpcMessage } from "../../app-server/client";
import type { CommandExecutionApprovalDecision } from "../../../protocol/app-server-v2/generated-local/codex-cli-0.144.1/typescript/v2/CommandExecutionApprovalDecision";
import type { ToolRequestUserInputQuestion } from "../../../protocol/app-server-v2/generated-local/codex-cli-0.144.1/typescript/v2/ToolRequestUserInputQuestion";

export type ApprovalDecision = CommandExecutionApprovalDecision;
export type InputQuestion = ToolRequestUserInputQuestion;
export const supportedApprovalMethods = new Set([
  "item/commandExecution/requestApproval", "item/fileChange/requestApproval",
  "item/permissions/requestApproval", "item/tool/requestUserInput",
]);
export function approvalKey(request: RpcMessage) {
  return `${typeof request.id}:${request.id}`;
}
export function approvalDecisions(request: RpcMessage): ApprovalDecision[] {
  const params = (request.params ?? {}) as Record<string, any>;
  if (request.method === "item/tool/requestUserInput") return [];
  if (request.method === "item/permissions/requestApproval") return ["decline", "accept", "acceptForSession"];
  if (request.method === "item/commandExecution/requestApproval") {
    if (Array.isArray(params.availableDecisions)) return params.availableDecisions;
    return ["accept", "acceptForSession",
      ...(params.proposedExecpolicyAmendment ? [{ acceptWithExecpolicyAmendment: { execpolicy_amendment: params.proposedExecpolicyAmendment } }] : []),
      ...(params.proposedNetworkPolicyAmendments ?? []).map((amendment: any) => ({ applyNetworkPolicyAmendment: { network_policy_amendment: amendment } })),
      "decline", "cancel"];
  }
  return ["accept", "acceptForSession", "decline", "cancel"];
}
export function approvalResponse(request: RpcMessage, decision: ApprovalDecision) {
  if (!approvalDecisions(request).some((value) => JSON.stringify(value) === JSON.stringify(decision))) return null;
  if (request.method !== "item/permissions/requestApproval") return { decision };
  const requested = (request.params as Record<string, any>)?.permissions ?? {};
  return { permissions: decision === "decline" ? {} : {
    ...(requested.fileSystem != null ? { fileSystem: requested.fileSystem } : {}),
    ...(requested.network != null ? { network: requested.network } : {}),
  }, scope: decision === "acceptForSession" ? "session" : "turn" };
}
export function questionResponse(request: RpcMessage, answers: Record<string, string>) {
  const questions = ((request.params as Record<string, any>)?.questions ?? []) as InputQuestion[];
  if (!questions.length || questions.some((q) => !answers[q.id]?.trim() ||
    (q.options?.length && !q.isOther && !q.options.some((o) => o.label === answers[q.id])))) return null;
  return { answers: Object.fromEntries(questions.map((q) => [q.id, { answers: [answers[q.id]] }])) };
}
