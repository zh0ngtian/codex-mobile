import { useCallback, useRef, useState } from "react";
import type { RpcMessage } from "../../app-server/client";
import { HttpOperationPendingError } from "../../backends/http-transport";
import { approvalKey, supportedApprovalMethods } from "./approval-model";

type Entry = { request: RpcMessage; answers: Record<string, string>; error: string; submission?: symbol; releasePending?: () => void };
type Responder = { respond: (id: number | string, result: unknown) => void | Promise<void> };
type RememberPending = (id: string, confirmed: (response: RpcMessage) => void) => void | (() => void);

/** 请求状态与草稿一起存放，任何异步结果只能完成它所属的那次提交。 */
export function useApprovalRequests() {
  const entriesRef = useRef<Entry[]>([]);
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
  const reset = useCallback(() => update([]), [update]);
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
  const submit = useCallback(async (result: unknown, client: Responder, remember: RememberPending, displayed?: RpcMessage) => {
    const first = entriesRef.current[0];
    if (!first || first.submission || (displayed && approvalKey(first.request) !== approvalKey(displayed))) return;
    const token = Symbol("approval-submission");
    update(entriesRef.current.map((entry, index) => index ? entry : { ...entry, submission: token, releasePending: undefined, error: "" }));
    const finish = (response: RpcMessage) => {
      const current = entriesRef.current;
      if (!current.some((entry) => entry.submission === token)) return;
      update(response.error ? current.map((entry) => entry.submission === token ? { ...entry, submission: undefined, releasePending: undefined, error: response.error!.message } : entry)
        : current.filter((entry) => entry.submission !== token));
    };
    try {
      await client.respond(first.request.id!, result);
      finish({ result: {} });
    } catch (reason) {
      if (reason instanceof HttpOperationPendingError) {
        if (!entriesRef.current.some((entry) => entry.submission === token)) return;
        const releasePending = remember(reason.requestId, finish);
        if (releasePending) {
          if (entriesRef.current.some((entry) => entry.submission === token)) {
            update(entriesRef.current.map((entry) => entry.submission === token ? { ...entry, releasePending } : entry));
          } else releasePending();
        }
      } else {
        finish({ error: { code: -1, message: reason instanceof Error ? reason.message : String(reason) } });
      }
    }
  }, [update]);
  const current = entries[0];
  return { requests: entries.map((entry) => entry.request), approval: current?.request ?? null,
    userAnswers: current?.answers ?? {}, submitting: !!current?.submission, error: current?.error ?? "",
    receive, reset, onNotification, answer, submit };
}
