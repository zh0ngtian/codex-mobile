import { useCallback, useRef, useState } from "react";
import type { RpcMessage } from "../../app-server/client";
import { HttpOperationPendingError } from "../../backends/http-transport";
import { approvalKey, supportedApprovalMethods } from "./approval-model";
import { t } from "../../i18n";

type Entry = { request: RpcMessage; answers: Record<string, string>; error: string; submission?: symbol; releasePending?: () => void };
type Responder = { respond: (id: number | string, result: unknown) => void | Promise<void> };
type RememberPending = (id: string, confirmed: (response: RpcMessage) => void) => void | (() => void);
export type ApprovalSubmissionResult = { ok: true } | { ok: false; error: string; pending?: boolean };

/** 请求状态与草稿一起存放，任何异步结果只能完成它所属的那次提交。 */
export function useApprovalRequests() {
  const entriesRef = useRef<Entry[]>([]);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const update = useCallback((next: Entry[]) => {
    const previous = entriesRef.current;
    entriesRef.current = next;
    setEntries(next);
    for (const entry of previous) {
      if (entry.submission && entry.releasePending && !next.some((current) => current.submission === entry.submission)) entry.releasePending();
    }
  }, []);
  const sync = useCallback((requests: RpcMessage[]) => {
    const previous = new Map(entriesRef.current.map((entry) => [approvalKey(entry.request), entry]));
    const unique = new Map<string, RpcMessage>();
    for (const request of requests) {
      if (request.id != null && supportedApprovalMethods.has(request.method ?? "")) unique.set(approvalKey(request), request);
    }
    update([...unique].map(([key, request]) => ({ ...(previous.get(key) ?? { answers: {}, error: "" }), request })));
  }, [update]);
  const receive = useCallback((request: RpcMessage) => {
    if (request.id == null || !supportedApprovalMethods.has(request.method ?? "")) return false;
    if (!entriesRef.current.some((entry) => approvalKey(entry.request) === approvalKey(request))) {
      update([...entriesRef.current, { request, answers: {}, error: "" }]);
    }
    return true;
  }, [update]);
  const reset = useCallback(() => { update([]); setDismissed(null); }, [update]);
  const onNotification = useCallback((message: RpcMessage) => {
    const params = (message.params ?? {}) as Record<string, any>;
    if (message.method === "mobile/requests") { sync(params.requests ?? []); return true; }
    if (message.method === "serverRequest/resolved") {
      update(entriesRef.current.filter((entry) => entry.request.id !== params.requestId ||
        (entry.request.params as Record<string, any>)?.threadId !== params.threadId));
      return true;
    }
    return false;
  }, [sync, update]);
  const answer = useCallback((id: string, value: string) => {
    const first = entriesRef.current[0];
    if (!first || first.submission) return;
    update(entriesRef.current.map((entry, index) => index ? entry : { ...entry, answers: { ...entry.answers, [id]: value }, error: "" }));
  }, [update]);
  const submit = useCallback(async (result: unknown, client: Responder, remember: RememberPending, displayed?: RpcMessage): Promise<ApprovalSubmissionResult> => {
    const first = entriesRef.current[0];
    const unavailable = (): ApprovalSubmissionResult => ({ ok: false, error: t("审批请求已变化或正在提交") });
    if (!first || first.submission || (displayed && approvalKey(first.request) !== approvalKey(displayed))) return unavailable();
    const token = Symbol("approval-submission");
    let completed: ApprovalSubmissionResult | undefined;
    update(entriesRef.current.map((entry, index) => index ? entry : { ...entry, submission: token, releasePending: undefined, error: "" }));
    const finish = (response: RpcMessage) => {
      const current = entriesRef.current;
      if (!current.some((entry) => entry.submission === token)) return;
      completed = response.error ? { ok: false, error: response.error.message } : { ok: true };
      update(response.error ? current.map((entry) => entry.submission === token ? { ...entry, submission: undefined, releasePending: undefined, error: response.error!.message } : entry)
        : current.filter((entry) => entry.submission !== token));
    };
    try {
      await client.respond(first.request.id!, result);
      finish({ result: {} });
      return completed ?? unavailable();
    } catch (reason) {
      if (reason instanceof HttpOperationPendingError) {
        if (!entriesRef.current.some((entry) => entry.submission === token)) return unavailable();
        const releasePending = remember(reason.requestId, finish);
        if (releasePending) {
          if (entriesRef.current.some((entry) => entry.submission === token)) {
            update(entriesRef.current.map((entry) => entry.submission === token ? { ...entry, releasePending } : entry));
          } else releasePending();
        }
        return completed ?? { ok: false, error: reason.message, pending: true };
      } else {
        const error = reason instanceof Error ? reason.message : String(reason);
        finish({ error: { code: -1, message: error } });
        return { ok: false, error };
      }
    }
  }, [update]);
  const dismiss = useCallback(() => {
    const first = entriesRef.current[0];
    if (first?.request.method === "item/tool/requestUserInput" && !first.submission) setDismissed(approvalKey(first.request));
  }, []);
  const reopen = useCallback(() => setDismissed(null), []);
  const current = entries[0];
  return { requests: entries.map((entry) => entry.request), approval: current && approvalKey(current.request) !== dismissed ? current.request : null,
    userAnswers: current?.answers ?? {}, submitting: !!current?.submission, error: current?.error ?? "",
    current: () => { const entry = entriesRef.current[0]; return entry ? { request: entry.request, answers: entry.answers, submitting: !!entry.submission } : null; },
    receive, reset, onNotification, answer, submit, dismiss, reopen };
}
