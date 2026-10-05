import {
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { AppServerClient } from "../../../app-server/client";
import {
  MarkdownMessage,
  parseRemoteFileHref,
  type ImageSource,
} from "../../../ui/conversation";
import { ActionSheet } from "../../../ui/ActionSheet";
import { t } from "../../../i18n";
import { ActionSheetDownload } from "../../../ui/ActionSheetDownload";
import { ImagePreviewSheet } from "./ImagePreviewSheet";
import { VideoPreviewSheet } from "./VideoPreviewSheet";
import type { BackendConfig } from "../../../backends/types";
import { remoteFilePreviewUrl } from "../../../backends/file-upload";
import { loadCachedImage, type LoadedImage } from "../image-cache";
import videoPoster from "../../../assets/video-poster.svg";

function imageMime(source: string) {
  const extension = source.split(/[?#]/)[0]?.split(".").at(-1)?.toLowerCase();
  return (
    {
      avif: "image/avif",
      gif: "image/gif",
      jpeg: "image/jpeg",
      jpg: "image/jpeg",
      png: "image/png",
      svg: "image/svg+xml",
      webp: "image/webp",
    }[extension ?? ""] ?? "image/png"
  );
}

function isPreviewableImagePath(source: string) {
  return /\.(?:avif|gif|jpe?g|png|svg|webp)(?:$|[?#])/i.test(source);
}

export function isPreviewableVideoPath(source: string) {
  return /\.(?:m4v|mov|mp4|ogg|ogv|webm)(?:$|[?#])/i.test(source);
}

export function RemoteVideo({
  path,
  backend,
  className = "",
}: {
  path: string;
  backend: BackendConfig;
  className?: string;
}) {
  const name = path.split("/").filter(Boolean).at(-1) || t("视频预览");
  return (
    <video
      className={`message-video ${className}`.trim()}
      src={remoteFilePreviewUrl(backend, path)}
      controls
      playsInline
      preload="metadata"
      poster={videoPoster}
      aria-label={t("播放视频 {name}", { name })}
    >
      {t("浏览器无法播放此视频格式")}
    </video>
  );
}

function isMarkdownPath(source: string) {
  return /\.(?:md|markdown)$/i.test(source);
}

function isHtmlPath(source: string) {
  return /\.(?:html?|xhtml)$/i.test(source);
}

function remoteMarkdownImage(path: string, source: string): ImageSource {
  if (/^(?:data:|https?:)/i.test(source)) {
    return {
      source,
      name: source.split(/[?#]/)[0]?.split("/").at(-1) || t("图片"),
      local: false,
    };
  }
  const directory = path.slice(0, path.lastIndexOf("/") + 1);
  let resolved = source.startsWith("/") ? source : `${directory}${source}`;
  try {
    resolved = decodeURIComponent(
      new URL(resolved, "file:///").pathname,
    );
  } catch {
    // 保留原路径，由 app-server 返回具体读取错误。
  }
  return {
    source: resolved,
    name: resolved.split("/").at(-1) || t("图片"),
    local: true,
  };
}

function formatImageSize(bytes: number | null) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function decodeBase64File(dataBase64: string) {
  const binary = window.atob(dataBase64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const text = new TextDecoder("utf-8").decode(bytes);
  const replacementCount = Array.from(text).filter(
    (character) => character === "\uFFFD",
  ).length;
  return {
    bytes: bytes.byteLength,
    text,
    binary:
      bytes.includes(0) ||
      (text.length > 0 && replacementCount / text.length > 0.02),
  };
}

export function RemoteImage({
  image,
  client,
  backend,
  alt,
}: {
  image: ImageSource;
  client: AppServerClient | null;
  backend?: BackendConfig | null;
  alt?: string;
}) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [visibleTarget, setVisibleTarget] = useState<{
    source: string;
    client: AppServerClient | null;
    backendUrl?: string;
    backendToken?: string;
  } | null>(null);
  const [loaded, setLoaded] = useState<LoadedImage | null>(null);
  const [original, setOriginal] = useState<LoadedImage | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const inline = /^data:/i.test(image.source);
  const displayName = inline ? alt?.trim() || t("图片") : image.name;
  const source = image.source;
  const backendUrl = backend?.baseUrl;
  const backendToken = backend?.token;
  const visible = typeof IntersectionObserver === "undefined" || (
    visibleTarget?.source === source && visibleTarget.client === client &&
    visibleTarget.backendUrl === backendUrl && visibleTarget.backendToken === backendToken
  );

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || !image.local) return;
    let cancelled = false;
    const observer = new IntersectionObserver(entries => {
      if (!cancelled && entries.some(entry => entry.isIntersecting)) {
        setVisibleTarget({ source, client, backendUrl, backendToken });
        observer.disconnect();
      }
    }, { rootMargin: "160px" });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => { cancelled = true; observer.disconnect(); };
  }, [source, image.local, client, backendUrl, backendToken]);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setOriginal(null);
    setFailed(false);
    setOpen(false);
    setPreviewError(false);
    if (!image.local || !client || !visible) return;
    void loadCachedImage(client, source, imageMime(source), backend)
      .then(result => { if (!cancelled) setLoaded(result); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [client, image.local, source, visible, backendUrl, backendToken]);

  useEffect(() => {
    if (!open || !image.local || !loaded?.thumbnail || !client) return;
    let cancelled = false;
    setPreviewError(false);
    void loadCachedImage(client, source, imageMime(source), backend, false)
      .then(result => { if (!cancelled) setOriginal(result); })
      .catch(() => { if (!cancelled) setPreviewError(true); });
    return () => { cancelled = true; };
  }, [open, client, source, loaded, image.local, backendUrl, backendToken]);

  const src = image.local ? loaded?.src : source;
  const size = original?.size ?? loaded?.size;
  const previewPending = image.local && loaded?.thumbnail && !original && !previewError;
  return (
    <span className={`remote-image${failed && image.hideIfMissing ? " remote-image-missing" : ""}`} ref={containerRef}>
      {failed && image.hideIfMissing ? null : failed ? <span className="image-load-error">{t("无法读取 {name}", { name: image.name })}</span>
        : !src ? <span className="image-placeholder" aria-label={t("正在加载 {name}", { name: image.name })} />
        : <button type="button" className="message-image-button"
          aria-label={t("查看图片 {name}", { name: displayName })}
          onClick={event => { event.stopPropagation(); setOpen(true); }}>
          <img src={src} alt={alt || image.name} loading="lazy" decoding="async" />
        </button>}
      {open && src && <ImagePreviewSheet
        src={original?.src ?? src}
        name={displayName}
        alt={alt || displayName}
        details={previewPending ? t("正在加载原图…") : previewError ? t("原图加载失败，请关闭后重试")
          : inline ? "" : `${source}${size != null ? ` · ${formatImageSize(size)}` : ""}`}
        onClose={() => setOpen(false)}
      />}
    </span>
  );
}

function RemoteTextFileSheet({
  href,
  path,
  line,
  client,
  onClose,
}: {
  href: string;
  path: string;
  line: number | null;
  client: AppServerClient | null;
  onClose: () => void;
}) {
  const [state, setState] = useState<{
    status: "loading" | "ready" | "error";
    text: string;
    dataBase64: string;
    bytes: number | null;
    binary: boolean;
    error: string;
  }>({
    status: "loading",
    text: "",
    dataBase64: "",
    bytes: null,
    binary: false,
    error: "",
  });
  const targetLineRef = useRef<HTMLDivElement | null>(null);
  const name = path.split("/").filter(Boolean).at(-1) || t("远程文件");
  const markdown = isMarkdownPath(path);
  const html = isHtmlPath(path);
  const [viewMode, setViewMode] = useState<"preview" | "source">(
    markdown || html ? "preview" : "source",
  );

  useEffect(() => {
    let cancelled = false;
    setViewMode(
      isMarkdownPath(path) || isHtmlPath(path) ? "preview" : "source",
    );
    setState({
      status: "loading",
      text: "",
      dataBase64: "",
      bytes: null,
      binary: false,
      error: "",
    });
    if (!client) {
      setState((current) => ({
        ...current,
        status: "error",
        error: t("尚未连接 app-server"),
      }));
      return () => {
        cancelled = true;
      };
    }
    void client
      .request<{ dataBase64: string }>("fs/readFile", { path })
      .then((result) => {
        if (cancelled) return;
        if (isPreviewableImagePath(path)) {
          setState({
            status: "ready",
            text: "",
            dataBase64: result.dataBase64,
            bytes: Math.floor((result.dataBase64.length * 3) / 4),
            binary: true,
            error: "",
          });
          return;
        }
        const decoded = decodeBase64File(result.dataBase64);
        setState({
          status: "ready",
          text: decoded.text,
          dataBase64: result.dataBase64,
          bytes: decoded.bytes,
          binary: decoded.binary,
          error: "",
        });
      })
      .catch((reason) => {
        if (cancelled) return;
        setState((current) => ({
          ...current,
          status: "error",
          error: reason instanceof Error ? reason.message : String(reason),
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [client, path]);

  useEffect(() => {
    if (
      state.status !== "ready" ||
      line == null ||
      viewMode !== "source"
    ) return;
    targetLineRef.current?.scrollIntoView?.({ block: "center" });
  }, [line, state.status, viewMode]);

  const lines = state.text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (
    state.status === "ready" &&
    state.dataBase64 &&
    isPreviewableImagePath(path)
  ) {
    return (
      <ImagePreviewSheet
        src={`data:${imageMime(path)};base64,${state.dataBase64}`}
        name={name}
        details={`${href}${
          state.bytes != null ? ` · ${formatImageSize(state.bytes)}` : ""
        }`}
        onClose={onClose}
      />
    );
  }

  return (
    <ActionSheet
      title={t("远程文件")}
      ariaLabel={t("远程文件")}
      onClose={onClose}
      closeLabel={t("关闭远程文件")}
      className="remote-text-sheet"
      backdropClassName="remote-file-backdrop"
      headerActions={
        <>
          {state.dataBase64 && (
            <ActionSheetDownload
              href={`data:text/plain;charset=utf-8;base64,${state.dataBase64}`}
              filename={name}
              label={t("下载文件")}
            />
          )}
        </>
      }
      footer={<p className="remote-file-path">{href}</p>}
    >
        <div className="remote-text-file-header">
          <div className="remote-text-file-name">
            <strong>{name}</strong>
            {state.bytes != null ? ` (${formatImageSize(state.bytes)})` : ""}
          </div>
          {(markdown || html) && state.status === "ready" && !state.binary && (
            <div
              className="remote-markdown-mode"
              role="group"
              aria-label={t(
                markdown ? "Markdown 显示模式" : "HTML 显示模式",
              )}
            >
              <button
                type="button"
                aria-label={t(markdown ? "预览 Markdown" : "预览 HTML")}
                aria-pressed={viewMode === "preview"}
                onClick={() => setViewMode("preview")}
              >
                {t("预览")}
              </button>
              <button
                type="button"
                aria-label={t("查看源码")}
                aria-pressed={viewMode === "source"}
                onClick={() => setViewMode("source")}
              >
                {t("源码")}
              </button>
            </div>
          )}
        </div>
        <div className="remote-text-content">
          {state.status === "loading" && (
            <div className="remote-text-status" role="status">
              {t("正在读取文件…")}
            </div>
          )}
          {state.status === "error" && (
            <div className="remote-text-status error" role="alert">
              {t("无法读取文件：{message}", { message: state.error })}
            </div>
          )}
          {state.status === "ready" && state.binary && (
            <div className="remote-text-status">
              {t("这是二进制文件，无法作为文本预览")}
            </div>
          )}
          {state.status === "ready" && !state.binary && !lines.length && (
            <div className="remote-text-status">{t("文件内容为空")}</div>
          )}
          {state.status === "ready" &&
            !state.binary &&
            markdown &&
            viewMode === "preview" &&
            lines.length > 0 && (
              <MarkdownMessage
                text={state.text}
                className="remote-markdown-preview"
                renderImage={(source, alt) => (
                  <RemoteImage
                    image={remoteMarkdownImage(path, source)}
                    client={client}
                    alt={alt}
                  />
                )}
              />
            )}
          {state.status === "ready" &&
            !state.binary &&
            html &&
            viewMode === "preview" &&
            lines.length > 0 && (
              <iframe
                className="remote-html-preview"
                title={t("{name} HTML 预览", { name })}
                srcDoc={state.text}
                sandbox=""
                referrerPolicy="no-referrer"
              />
            )}
          {state.status === "ready" &&
            !state.binary &&
            ((!markdown && !html) || viewMode === "source") &&
            lines.map((content, index) => {
              const lineNumber = index + 1;
              const target = lineNumber === line;
              return (
                <div
                  className={`remote-text-line${target ? " target" : ""}`}
                  key={lineNumber}
                  ref={target ? targetLineRef : undefined}
                >
                  <span>{lineNumber}</span>
                  <code>{content || " "}</code>
                </div>
              );
            })}
        </div>
    </ActionSheet>
  );
}

export function RemoteFileLink({
  href,
  children,
  client,
  backend,
}: {
  href: string;
  children: ReactNode;
  client: AppServerClient | null;
  backend?: BackendConfig | null;
}) {
  const target = parseRemoteFileHref(href);
  const [open, setOpen] = useState(false);
  if (!target) return <a href={href}>{children}</a>;
  return (
    <>
      <a
        href={href}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
      >
        {children}
      </a>
      {open &&
        createPortal(
          isPreviewableVideoPath(target.path) && backend ? (
            <VideoPreviewSheet
              src={remoteFilePreviewUrl(backend, target.path)}
              name={
                target.path.split("/").filter(Boolean).at(-1) || t("视频预览")
              }
              details={target.path}
              onClose={() => setOpen(false)}
            />
          ) : (
            <RemoteTextFileSheet
              href={href}
              path={target.path}
              line={target.line}
              client={client}
              onClose={() => setOpen(false)}
            />
          ),
          document.body,
        )}
    </>
  );
}
