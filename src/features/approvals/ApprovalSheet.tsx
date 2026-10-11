import { useId, useState } from "react";
import type { RpcMessage } from "../../app-server/client";
import { ActionSheet } from "../../ui/ActionSheet";
import { t } from "../../i18n";
import { approvalDecisions, questionResponse, type ApprovalDecision, type InputQuestion } from "./approval-model";
import "./approvals.css";

type AnyRecord = Record<string, any>;
function decisionLabel(decision: ApprovalDecision): string {
  if (typeof decision === "string") return t({ accept: "允许", acceptForSession: "本会话允许", decline: "拒绝", cancel: "取消本轮" }[decision]);
  if ("acceptWithExecpolicyAmendment" in decision) return `${t("允许并记住命令前缀")}：${decision.acceptWithExecpolicyAmendment.execpolicy_amendment.join(" ")}`;
  const rule = decision.applyNetworkPolicyAmendment.network_policy_amendment;
  return `${t(rule.action === "allow" ? "允许并记住主机" : "阻止并记住主机")}：${rule.host}`;
}
function Permissions({ permissions }: { permissions?: AnyRecord | null }) {
  if (!permissions) return null;
  return <dl className="approval-details">
    {permissions.network?.enabled != null && <><dt>{t("网络访问")}</dt><dd>{t(permissions.network.enabled ? "允许联网" : "禁用联网")}</dd></>}
    {(["read", "write"] as const).map((access) => permissions.fileSystem?.[access]?.length ? <div key={access}><dt>{t(access === "read" ? "读取路径" : "写入路径")}</dt>{permissions.fileSystem[access].map((path: string) => <dd key={path}>{path}</dd>)}</div> : null)}
    {permissions.fileSystem?.entries?.map((entry: AnyRecord, index: number) => <div key={index}><dt>{entry.access}</dt><dd>{entry.path.path ?? entry.path.pattern ?? JSON.stringify(entry.path.value)}</dd></div>)}
  </dl>;
}
function Question({ question, answer, disabled, onChange }: { question: InputQuestion; answer: string; disabled: boolean; onChange: (value: string) => void }) {
  const id = useId();
  const [other, setOther] = useState(false);
  const options = question.options ?? [];
  const custom = other || (!!answer && !options.some((option) => option.label === answer));
  return <fieldset className="question-field" disabled={disabled}>
    <legend>{question.header}</legend>
    <p id={`${id}-prompt`}>{question.question}</p>
    {!!options.length && <div className="question-options">
      {options.map((option, index) => <label className="question-option" key={option.label}>
        <input type="radio" name={id} checked={!custom && answer === option.label} aria-describedby={`${id}-option-${index}`} onChange={() => { setOther(false); onChange(option.label); }} />
        <span><strong>{option.label}</strong><small id={`${id}-option-${index}`}>{option.description}</small></span>
      </label>)}
      {question.isOther && <label className="question-option"><input type="radio" name={id} checked={custom} onChange={() => { setOther(true); onChange(""); }} /><span>{t("其他（自行填写）")}</span></label>}
    </div>}
    {(!options.length || (question.isOther && custom)) && <input
      aria-label={options.length ? `${t("自定义回答")}：${question.header}` : question.question}
      aria-describedby={`${id}-prompt`} autoComplete="off" type={question.isSecret ? "password" : "text"}
      value={answer} onChange={(event) => onChange(event.target.value)} />}
  </fieldset>;
}
export function ApprovalSheet({ approval, submitting = false, error = "", userAnswers, onAnswerChange, onSubmitAnswers, onDecision }: {
  approval: RpcMessage | null; submitting?: boolean; error?: string; userAnswers: Record<string, string>;
  onAnswerChange: (questionId: string, value: string) => void; onSubmitAnswers: () => void; onDecision: (decision: ApprovalDecision) => void;
}) {
  if (!approval) return null;
  const params = (approval.params ?? {}) as AnyRecord;
  const requestsInput = approval.method === "item/tool/requestUserInput";
  const title = t(requestsInput ? "Codex 需要你的回答" : approval.method?.includes("fileChange") ? "允许修改文件？" : approval.method?.includes("permissions") ? "授予附加权限？" : "允许运行此操作？");
  return <ActionSheet title={<div><small>{t("需要你的确认")}</small><h2>{title}</h2></div>} ariaLabel={title} className="approval-sheet" backdropClassName="approval-backdrop" closeOnBackdrop={false}
    footer={requestsInput ? <button className="approve" disabled={submitting || !questionResponse(approval, userAnswers)} onClick={onSubmitAnswers}>{t("提交回答")}</button>
      : approvalDecisions(approval).map((decision, index) => <button key={index} className={decision === "accept" ? "approve" : ""} disabled={submitting} onClick={() => onDecision(decision)}>{decisionLabel(decision)}</button>)}>
    {error && <p role="alert" className="approval-error">{error}</p>}
    {submitting && <p role="status">{t("正在提交，请等待确认…")}</p>}
    {requestsInput ? <>
      <p className="approval-hint">{t("请回答所有问题后提交。")}</p>
      {(params.questions ?? []).map((question: InputQuestion) => <Question key={`${typeof approval.id}:${approval.id}:${question.id}`} question={question} answer={userAnswers[question.id] ?? ""} disabled={submitting} onChange={(value) => onAnswerChange(question.id, value)} />)}
    </> : <>
      {params.reason && <p>{params.reason}</p>}
      <dl className="approval-details">
        {params.command && <><dt>{t("命令")}</dt><dd><pre>{params.command}</pre></dd></>}
        {params.cwd && <><dt>{t("工作目录")}</dt><dd>{params.cwd}</dd></>}
        {params.grantRoot && <><dt>{t("请求写入目录")}</dt><dd>{params.grantRoot}</dd></>}
        {params.networkApprovalContext && <><dt>{t("网络目标")}</dt><dd>{params.networkApprovalContext.protocol}://{params.networkApprovalContext.host}</dd></>}
      </dl>
      <Permissions permissions={params.permissions ?? params.additionalPermissions} />
      {params.threadId && <p className="approval-hint">{t("会话")}：{params.threadId}</p>}
    </>}
  </ActionSheet>;
}
