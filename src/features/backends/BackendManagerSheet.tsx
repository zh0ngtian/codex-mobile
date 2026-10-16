import { useNativeSwitch } from '../../native-ui/switch-context';
import { AppIcon } from "../../ui/app-display";
import { ModernSettingsRoot, type SettingsPage } from "./ModernSettingsRoot";
import { useWebInterface } from '../web-ui/preference';
import { useNativeGlobalPanel } from '../../native-ui/adapters';
import { projectDevicePanel } from '../../native-ui/device-panel';
import type { NativeRuntime } from '../../native-ui/runtime';
import {
  type FormEvent,
  useCallback,
  useEffect,
  useState,
  useRef,
  useLayoutEffect,
} from "react";
import {
  formatBackendGatewayUrl,
  moveBackend,
  parseBackendGatewayUrl,
  removeBackend,
  setBackendEnabled,
  upsertBackend,
} from "../../backends/registry";
import {
  probeBackend as defaultProbeBackend,
  type GatewayHostInfo,
} from "../../backends/probe";
import type {
  BackendConfig,
  BackendRegistry,
  BackendRuntimeSummary,
} from "../../backends/types";
import { ActionSheet } from "../../ui/ActionSheet";
import { t, useI18n } from "../../i18n";
import { GatewayQrScannerSheet } from "./GatewayQrScannerSheet";
import type { TransportMode } from "../../backends/transport-preference";
import { PushSettingsForm, usePushSettingsState } from "../../notifications/PushSettings";
import type { NotificationPreference } from "../../notifications/preferences";
import { FontSizeSettingsForm, useFontSizeSettings } from "../settings/FontSizeSettings";

interface BackendDraft {
  id: string;
  name: string;
  gatewayUrl: string;
  enabled: boolean;
  order: number;
}

function newBackendDraft(order: number): BackendDraft {
  return {
    id: `backend-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: "",
    gatewayUrl: "",
    enabled: true,
    order,
  };
}

export function BackendManagerSheet({
  open,
  nativeRuntime,
  nativePage,
  registry,
  summaries,
  onChange,
  onClose,
  appUpdate,
  transportMode = "http",
  onTransportModeChange,
  notificationPreference,
  onNotificationPreferenceSave,
  failedNotificationDevices,
  probe = defaultProbeBackend,
  scanQrCode,
}: {
  nativeRuntime?: NativeRuntime | null;
  nativePage?: string;
  open: boolean;
  registry: BackendRegistry;
  summaries: Record<string, BackendRuntimeSummary>;
  onChange: (registry: BackendRegistry) => void;
  onClose: () => void;
  transportMode?: TransportMode;
  onTransportModeChange?: (mode: TransportMode) => void;
  notificationPreference?: NotificationPreference;
  onNotificationPreferenceSave?: (preference: NotificationPreference) => void;
  failedNotificationDevices?: string[];
  appUpdate?: {
    supported: boolean;
    manualCheckSupported: boolean;
    currentVersion: string;
    checking: boolean;
    status?: string;
    onCheck: () => void;
  };
  probe?: (backend: BackendConfig) => Promise<GatewayHostInfo>;
  scanQrCode?: () => Promise<string>;
}) {
  const nativeSwitch = useNativeSwitch();
  const webInterface = useWebInterface();
  const { preference, setPreference } = useI18n();
  const font = useFontSizeSettings();
  const push = usePushSettingsState(notificationPreference ?? { mode: 'system', barkUrl: '' }, onNotificationPreferenceSave ?? (() => {}));
  const [confirmation, setConfirmation] = useState<{ name: string; id: string; message: string } | null>(null);
  const [draft, setDraft] = useState<BackendDraft | null>(() =>
    open && !registry.backends.length ? newBackendDraft(0) : null,
  );
  const draftRef = useRef(draft);
  const setCurrentDraft = (next: BackendDraft | null) => { draftRef.current = next; setDraft(next); };
  useLayoutEffect(() => { draftRef.current = draft; }, [draft]);
  const testingRef = useRef(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>("root");
  const settingsEntryRef = useRef<SettingsPage | null>(null);
  const usedModernNavigation = useRef(false);
  useEffect(() => {
    if (open && webInterface.modern) usedModernNavigation.current = true;
  }, [open, webInterface.modern]);

  useEffect(() => {
    if (!open) {
      setDraft(null);
      setError("");
      setTesting(false);
      setQrScannerOpen(false);
      setSettingsPage("root");
      settingsEntryRef.current = null;
      usedModernNavigation.current = false;
    } else if (!registry.backends.length) {
      setDraft((current) => current ?? newBackendDraft(0));
    }
  }, [open, registry.backends.length]);

  const applyScannedGateway = useCallback((value: string) => {
    try {
      const gateway = parseBackendGatewayUrl(value);
      if (!gateway.token) throw new Error(t("二维码中缺少访问口令"));
      const current = draftRef.current;
      if (current) setCurrentDraft({ ...current, gatewayUrl: formatBackendGatewayUrl(gateway.baseUrl, gateway.token) });
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? t("二维码无效：{message}", { message: reason.message })
          : t("二维码不是有效的网关链接"),
      );
    } finally {
      setQrScannerOpen(false);
    }
  }, []);

  const openQrScanner = async () => {
    const targetId = draftRef.current?.id;
    const nativeScan = (window as Window & { codexMobileScanGatewayQr?: () => Promise<string> }).codexMobileScanGatewayQr;
    if (!scanQrCode && !nativeScan) {
      if (nativeRuntime) { setError(t('扫码不可用')); return; }
      setQrScannerOpen(true);
      return;
    }
    try {
      const value = await (scanQrCode ?? nativeScan!)();
      if (draftRef.current?.id !== targetId) throw new Error(t('设备表单已变化'));
      applyScannedGateway(value);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("未能识别二维码"),
      );
    }
  };

  const updateRegistry = (action: () => BackendRegistry) => {
    try {
      setError("");
      onChange(action());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const submit = async (event?: Pick<FormEvent, "preventDefault">) => {
    event?.preventDefault();
    const currentDraft = draftRef.current;
    if (!currentDraft || testingRef.current) return;
    testingRef.current = true;
    setTesting(true);
    setError("");
    try {
      const gateway = parseBackendGatewayUrl(currentDraft.gatewayUrl);
      const candidate: BackendConfig = {
        id: currentDraft.id,
        name: currentDraft.name.trim(),
        baseUrl: gateway.baseUrl,
        token: gateway.token,
        enabled: currentDraft.enabled,
        order: currentDraft.order,
      };
      const host = await probe({ ...candidate, transportMode });
      const hostId = host.hostId.trim();
      if (!hostId) throw new Error(t("设备身份响应无效"));
      const next = upsertBackend(registry, {
        ...candidate,
        hostId,
        name: candidate.name || host.displayName,
      });
      onChange(next);
      setCurrentDraft(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      testingRef.current = false;
      setTesting(false);
    }
  };

  const deleteBackend = (backend: BackendConfig, confirmed = false) => {
    const summary = summaries[backend.id];
    if (
      (summary?.busy || summary?.approvalCount || summary?.queuedCount) &&
      !confirmed && !window.confirm(
        summary?.queuedCount
          ? t("{name} 仍有 {count} 条未发送队列，确定删除吗？", {
              name: backend.name,
              count: summary.queuedCount,
            })
          : t("{name} 仍有运行任务或待审批请求，确定删除吗？", {
              name: backend.name,
            }),
      )
    ) {
      return;
    }
    updateRegistry(() => removeBackend(registry, backend.id));
  };

  const toggleBackend = (backend: BackendConfig, confirmed = false) => {
    const queuedCount = summaries[backend.id]?.queuedCount ?? 0;
    if (
      backend.enabled &&
      queuedCount > 0 &&
      !confirmed && !window.confirm(
        t("{name} 仍有 {count} 条未发送队列，暂停会丢弃这些消息。确定暂停吗？", {
          name: backend.name,
          count: queuedCount,
        }),
      )
    ) {
      return;
    }
    updateRegistry(() =>
      setBackendEnabled(registry, backend.id, !backend.enabled),
    );
  };

  const getBackend = (id: unknown) => { const b = registry.backends.find(b => b.id === id); if (!b) throw new Error(t('设备已移除')); return b; };
  const guard = () => { if (testingRef.current) throw new Error(t('正在测试…')); };
  const editBackend = (backend: BackendConfig) => { guard(); setCurrentDraft({ id: backend.id, name: backend.name, gatewayUrl: formatBackendGatewayUrl(backend.baseUrl, backend.token), enabled: backend.enabled, order: backend.order }); setError(''); };
  useNativeGlobalPanel(nativeRuntime, 'devices', projectDevicePanel({ open, page: nativePage, registry, summaries, draft, testing, error, confirmation, transportMode, preference, font, push, hasPush: !!notificationPreference && !!onNotificationPreferenceSave, failedNotificationDevices, appUpdate }), {
    'panel.close': () => { guard(); onClose(); },
    'device.add': () => { guard(); setCurrentDraft(newBackendDraft(registry.backends.length)); setError(''); },
    'device.edit': p => editBackend(getBackend(p.id)),
    'device.change': p => { guard(); if (!draftRef.current || (p.draftId !== undefined && p.draftId !== draftRef.current.id) || !['name', 'gatewayUrl'].includes(String(p.field))) throw new Error(t('设备表单已关闭')); setCurrentDraft({ ...draftRef.current!, [String(p.field)]: String(p.value) }); },
    'device.save': () => submit(),
    'device.cancel': () => { guard(); setConfirmation(null); setCurrentDraft(null); setError(''); },
    'device.scan': () => { guard(); return openQrScanner(); },
    'device.move': p => { guard(); updateRegistry(() => moveBackend(registry, getBackend(p.id).id, Number(p.direction) as -1 | 1)); },
    'device.toggle': p => {
      guard(); const b = getBackend(p.id); const count = summaries[b.id]?.queuedCount ?? 0;
      if (b.enabled && count && p.confirmed !== true) { setConfirmation({ name: 'device.toggle', id: b.id, message: t('{name} 仍有 {count} 条未发送队列，暂停会丢弃这些消息。确定暂停吗？', { name: b.name, count }) }); return; }
      toggleBackend(b, p.confirmed === true); setConfirmation(null);
    },
    'device.remove': p => {
      guard(); const b = getBackend(p.id); const summary = summaries[b.id];
      if ((summary?.busy || summary?.approvalCount || summary?.queuedCount) && p.confirmed !== true) { setConfirmation({ name: 'device.remove', id: b.id, message: summary.queuedCount ? t('{name} 仍有 {count} 条未发送队列，确定删除吗？', { name: b.name, count: summary.queuedCount }) : t('{name} 仍有运行任务或待审批请求，确定删除吗？', { name: b.name }) }); return; }
      deleteBackend(b, p.confirmed === true); setConfirmation(null);
    },
    'settings.language': p => { if (!['system', 'zh-CN', 'en'].includes(String(p.value))) throw new Error(t('选项不可用')); setPreference(p.value as any); },
    'settings.font': p => { if (!['small', 'standard', 'large', 'extra-large'].includes(String(p.value))) throw new Error(t('选项不可用')); font.selectSize(p.value as any); },
    'settings.transport': p => { guard(); if (!['http', 'stream'].includes(String(p.value))) throw new Error(t('选项不可用')); onTransportModeChange?.(p.value as TransportMode); },
    'settings.push.mode': p => { if (!['system', 'bark'].includes(String(p.value))) throw new Error(t('选项不可用')); push.setMode(p.value as any); push.setError(''); push.setSaved(false); },
    'settings.push.url': p => { push.setUrl(String(p.value)); push.setError(''); push.setSaved(false); },
    'settings.push.save': () => push.save(),
    'settings.update.check': () => { if (!appUpdate?.manualCheckSupported || appUpdate.checking) throw new Error(t('检查更新不可用')); appUpdate.onCheck(); },
  });
  if (!open) return null;

  const modern = webInterface.modern;
  const pageTitles: Record<SettingsPage, string> = {
    root: t("设置"), devices: t("设备"), language: t("语言"), font: t("字体大小"),
    transport: t("传输方式"), notifications: t("通知"),
  };
  const webToggle = (
    <section className="backend-language-settings web-interface-settings" aria-label={t("Web 界面")}>
      <label><input type="checkbox" checked={webInterface.enabled}
        onChange={event => webInterface.change(event.target.checked)} />{t("使用新版界面")}</label>
      <small>{t("保存后立即生效，仅影响 Web 界面")}</small>
      {webInterface.error && <small role="alert">{webInterface.error}</small>}
    </section>
  );
  const nativeToggle = nativeSwitch && (
    <section className="backend-language-settings" aria-label={t("界面模式")}>
      <label><input type="checkbox" checked={nativeSwitch.enabled} disabled={nativeSwitch.loading || nativeSwitch.pending}
        onChange={event => { void nativeSwitch.change(event.target.checked).catch(() => {}); }} />{t("使用原生界面")}</label>
      <label><input type="checkbox" checked={nativeSwitch.composerEnabled} disabled={nativeSwitch.loading || nativeSwitch.pending}
        onChange={event => { void nativeSwitch.changeComposer(event.target.checked).catch(() => {}); }} />{t("使用原生输入框")}</label>
      <small>{t("下次完整启动 App 时生效")}</small>
    </section>
  );
  const transportForm = (
    <section className="backend-language-settings backend-transport-settings" aria-label={t("传输方式")}>
      <strong>{t("传输方式")}</strong>
      <div role="group" aria-label={t("传输方式")}>
        {([["http", "HTTP"], ["stream", "流式"]] as const).map(([value, label]) => (
          <button
            type="button"
            key={value}
            className={transportMode === value ? "selected" : ""}
            aria-pressed={transportMode === value}
            disabled={testing}
            onClick={() => onTransportModeChange?.(value)}
          >
            {t(label)}
          </button>
        ))}
      </div>
      <small>{transportMode === "http"
        ? t("定时同步回复，切换后自动重连所有设备")
        : t("实时接收回复，切换后自动重连所有设备")}</small>
    </section>
  );
  const pushForm = notificationPreference && onNotificationPreferenceSave && (
    <PushSettingsForm state={push} failedDevices={failedNotificationDevices} />
  );
  const languageForm = (
    <section className="backend-language-settings" aria-label={t("语言")}>
      <strong>{t("语言")}</strong>
      <div role="group" aria-label={t("语言")}>
        {([
          ["system", "跟随系统"],
          ["zh-CN", "中文"],
          ["en", "英文"],
        ] as const).map(([value, label]) => (
          <button
            type="button"
            key={value}
            className={preference === value ? "selected" : ""}
            aria-pressed={preference === value}
            onClick={() => setPreference(value)}
          >
            {t(label)}
          </button>
        ))}
      </div>
    </section>
  );
  const updateSection = appUpdate && (
    <section
      className="backend-app-update"
      aria-label={t(appUpdate.supported ? "应用更新" : "应用信息")}
    >
      <div>
        <strong>Codex Mobile</strong>
        <small>{t("当前版本 v{version}", { version: appUpdate.currentVersion })}</small>
        {appUpdate.supported && appUpdate.status && <small>{appUpdate.status}</small>}
      </div>
      {appUpdate.manualCheckSupported && (
        <button
          type="button"
          disabled={appUpdate.checking}
          onClick={appUpdate.onCheck}
        >
          {appUpdate.checking ? t("正在检查…") : t("检查更新")}
        </button>
      )}
    </section>
  );
  const deviceContent = draft ? (
    <form className="backend-form" onSubmit={submit}>
      <label>
        <span>{t("设备名称")}</span>
        <input
          aria-label={t("设备名称")}
          value={draft.name}
          placeholder={t("例如 Mac mini")}
          onChange={(event) =>
            setDraft({ ...draft, name: event.target.value })
          }
        />
      </label>
      <div className="backend-form-field">
        <label htmlFor="backend-gateway-url">{t("网关地址")}</label>
        <div className="backend-gateway-input">
          <input
            id="backend-gateway-url"
            aria-label={t("网关地址")}
            inputMode="url"
            value={draft.gatewayUrl}
            placeholder="http://host.local:18766/?token=xxx"
            onChange={(event) =>
              setDraft({ ...draft, gatewayUrl: event.target.value })
            }
          />
          <button
            type="button"
            aria-label={t("扫描网关二维码")}
            onClick={() => void openQrScanner()}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />
              <path d="M8 8h3v3H8zM14 8h2M14 11h2M8 14h2M13 14h3v3h-3z" />
            </svg>
          </button>
        </div>
      </div>
      {error && <p className="backend-form-error" role="alert">{error}</p>}
      <div className="backend-form-actions">
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setDraft(null);
            setError("");
          }}
        >
          {t("取消")}
        </button>
        <button type="submit" disabled={testing}>
          {testing ? t("正在测试…") : t("测试并保存")}
        </button>
      </div>
    </form>
  ) : (
    <>
      <div className="backend-manager-list">
        {registry.backends.map((backend, index) => {
          const summary = summaries[backend.id];
          return (
            <article className="backend-manager-row" key={backend.id}>
              <div>
                <i
                  className={`status-dot ${
                    summary?.connection ?? "offline"
                  }`}
                />
                <strong>{backend.name}</strong>
                <small>{backend.baseUrl}</small>
                <span>
                  {!backend.enabled
                    ? t("已暂停")
                    : summary?.busy
                      ? t("任务进行中")
                      : summary?.approvalCount
                        ? t("{count} 个待审批", {
                            count: summary.approvalCount,
                          })
                        : summary?.connection === "online"
                          ? t("已连接")
                          : t("未连接")}
                </span>
              </div>
              <div className="backend-row-actions">
                <button
                  type="button"
                  aria-label={t("上移 {name}", { name: backend.name })}
                  disabled={index === 0}
                  onClick={() =>
                    updateRegistry(() =>
                      moveBackend(registry, backend.id, -1),
                    )
                  }
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={t("下移 {name}", { name: backend.name })}
                  disabled={index === registry.backends.length - 1}
                  onClick={() =>
                    updateRegistry(() =>
                      moveBackend(registry, backend.id, 1),
                    )
                  }
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={t("编辑 {name}", { name: backend.name })}
                  onClick={() => editBackend(backend)}
                >
                  {t("编辑")}
                </button>
                <button
                  type="button"
                  aria-label={t(
                    backend.enabled ? "暂停 {name}" : "启用 {name}",
                    { name: backend.name },
                  )}
                  onClick={() => toggleBackend(backend)}
                >
                  {backend.enabled ? t("暂停") : t("启用")}
                </button>
                <button
                  type="button"
                  aria-label={t("删除 {name}", { name: backend.name })}
                  onClick={() => deleteBackend(backend)}
                >
                  {t("删除")}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {error && <p className="backend-form-error" role="alert">{error}</p>}
      <button
        type="button"
        className="backend-add-device"
        aria-label={t("添加设备")}
        onClick={() => {
          setDraft(newBackendDraft(registry.backends.length));
          setError("");
        }}
      >
        ＋ {t("添加设备")}
      </button>
    </>
  );
  const goBack = () => {
    if (draft) {
      setCurrentDraft(null);
      setError("");
      setSettingsPage("devices");
    } else {
      setSettingsPage("root");
    }
  };
  return (
    <>
      <ActionSheet
        title={draft ? t("设备连接") : modern ? pageTitles[settingsPage] : t("管理设备")}
        onClose={onClose}
        closeLabel={t("关闭")}
        closeOnBackdrop={false}
        focusResetKey={modern ? `modern:${settingsPage}:${draft?.id ?? ""}` : usedModernNavigation.current ? "legacy" : undefined}
        initialFocusSelector={!modern ? ".web-interface-settings input" : draft || settingsPage !== "root"
          ? ".modern-settings-back"
          : settingsEntryRef.current ? `[data-settings-page="${settingsEntryRef.current}"]` : undefined}
        className={`backend-manager-sheet${modern ? " modern-settings-sheet" : ""}`}
        headerActions={modern && (draft || settingsPage !== "root") ? <button
          type="button" className="modern-settings-back" aria-label={draft ? t("返回设备") : t("返回设置")}
          onClick={goBack}><AppIcon name="back" /></button> : undefined}
        backdropClassName="backend-manager-backdrop"
      >
        {modern ? <div className={`modern-settings-content${!draft && settingsPage === "root" ? " is-root" : ""}`}>
          {draft ? <>{deviceContent}{webToggle}</> : settingsPage === "root" ? <ModernSettingsRoot
            language={t(preference === "system" ? "跟随系统" : preference === "zh-CN" ? "中文" : "英文")}
            fontSize={t(({ small: "小", standard: "标准", large: "大", "extra-large": "特大" } as const)[font.size])}
            deviceCount={registry.backends.length} transport={t(transportMode === "http" ? "HTTP" : "流式")}
            notification={notificationPreference && onNotificationPreferenceSave ? t(push.mode === "system" ? "系统推送" : "Bark 推送") : undefined}
            webToggle={webToggle} nativeToggle={nativeToggle} currentVersion={appUpdate?.currentVersion} onNavigate={page => {
              settingsEntryRef.current = page;
              setSettingsPage(page);
            }}
          /> : <>
            {settingsPage === "devices" && deviceContent}
            {settingsPage === "language" && languageForm}
            {settingsPage === "font" && <FontSizeSettingsForm state={font} />}
            {settingsPage === "transport" && transportForm}
            {settingsPage === "notifications" && pushForm}
          </>}
        </div> : <>
          {webToggle}{nativeToggle}{transportForm}{pushForm}<FontSizeSettingsForm state={font} />
          {deviceContent}
          {!draft && <>{languageForm}{updateSection}</>}
        </>}
      </ActionSheet>
      <GatewayQrScannerSheet
        open={qrScannerOpen}
        onScan={applyScannedGateway}
        onClose={() => setQrScannerOpen(false)}
      />
    </>
  );
}
