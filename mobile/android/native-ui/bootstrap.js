(() => {
  if (window.top !== window || location.href !== 'file:///android_asset/index.html') return;
  const bridge = window.CodexNativeUI;
  if (!bridge || typeof bridge.postMessage !== 'function') return;
  const token = __NATIVE_TOKEN__;
  const postMessage = value => bridge.postMessage(JSON.stringify({ token, ...value }));
  window.__CODEX_ANDROID_HOST__ = true;
  window.__CODEX_NATIVE_UI__ = __NATIVE_ENABLED__;
  window.__CODEX_NATIVE_ACTIVE__ = true;
  window.webkit = { messageHandlers: { nativeUI: { postMessage } } };
  window.codexMobilePublishNativeSnapshot = snapshot => postMessage({ type: 'snapshot', snapshot });
  window.codexMobileNativeCommand = command => {
    if (location.href !== 'file:///android_asset/index.html') return;
    window.dispatchEvent(new CustomEvent('codex-mobile-native-command', { detail: command }));
  };
  window.codexMobileSetNativeActive = active => {
    window.__CODEX_NATIVE_ACTIVE__ = active === true;
    document.dispatchEvent(new Event('visibilitychange'));
    if (active) window.dispatchEvent(new Event('focus'));
  };
  let picker;
  window.codexMobileAttachmentPickerCancelled = () => picker?.finish([]);
  window.codexMobilePickAttachments = kind => new Promise((resolve, reject) => {
    if (picker) return reject(new Error('附件选择器正在使用中'));
    if (!['photos', 'files'].includes(kind)) return reject(new Error('附件类型无效'));
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = true;
    if (kind === 'photos') input.accept = 'image/*,video/*';
    input.style.display = 'none';
    const finish = files => { clearTimeout(timer); input.remove(); picker = undefined; resolve(files); };
    const timer = setTimeout(() => { input.remove(); picker = undefined; reject(new Error('附件选择超时，请重试')); }, 300000);
    picker = { finish };
    input.addEventListener('change', () => finish(Array.from(input.files ?? [])), { once: true });
    input.addEventListener('cancel', () => finish([]), { once: true });
    document.documentElement.append(input);
    input.click();
  });
  let scanner;
  window.codexMobileScanGatewayQr = () => new Promise((resolve, reject) => {
    if (scanner) return reject(new Error('二维码扫描正在使用中'));
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { scanner = undefined; reject(new Error('扫描超时，请重试')); }, 120000);
    scanner = { id, resolve, reject, timer };
    postMessage({ type: 'scanQR', id });
  });
  window.codexMobileQRComplete = result => {
    if (!scanner || scanner.id !== result.id) return;
    const current = scanner; scanner = undefined; clearTimeout(current.timer);
    if (result.error) current.reject(new Error(result.error)); else current.resolve(result.value);
  };
})();
