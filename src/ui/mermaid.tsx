import { useEffect, useState } from "react";
import { t } from "../i18n";
import { CopyButton } from "./copy";
import "./mermaid.css";

let enginePromise: Promise<typeof import("mermaid")["default"]> | undefined;
let nextDiagramId = 0;

function loadEngine() {
  enginePromise ??= import("mermaid").then(({ default: engine }) => {
    engine.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: "neutral",
      htmlLabels: false,
      fontFamily: "system-ui, sans-serif",
    });
    return engine;
  }).catch((error) => {
    enginePromise = undefined;
    throw error;
  });
  return enginePromise;
}

/** Web与原生展示共用strict引擎，容器只负责Mermaid布局，不承载业务DOM。 */
export async function renderMermaidSvg(source: string): Promise<string> {
  const engine = await loadEngine();
  const container = document.createElement('div');
  container.style.cssText = 'position:absolute;left:-10000px;top:0;pointer-events:none';
  container.setAttribute('aria-hidden', 'true');
  document.body.append(container);
  try { return (await engine.render(`codex-mermaid-${++nextDiagramId}`, source, container)).svg; }
  finally { container.remove(); }
}

export function MermaidBlock({ source }: { source: string }) {
  const [result, setResult] = useState<{ source: string; svg: string | null } | null>(null);
  const [showSource, setShowSource] = useState(false);
  const current = result?.source === source ? result : null;

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const svg = await renderMermaidSvg(source);
        if (!cancelled) setResult({ source, svg });
      } catch {
        if (!cancelled) setResult({ source, svg: null });
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [source]);

  return (
    <div className="markdown-code-block mermaid-block">
      <div className="mermaid-toolbar">
        <span>Mermaid</span>
        {current?.svg && (
          <button type="button" onClick={() => setShowSource((visible) => !visible)}>
            {t(showSource ? "预览" : "查看源码")}
          </button>
        )}
        <CopyButton text={source} label={t("复制代码块")} />
      </div>
      {current && !current.svg && (
        <p className="mermaid-error">{t("图表暂时无法渲染，显示源码")}</p>
      )}
      {current?.svg && !showSource ? (
        <div
          className="mermaid-diagram"
          role="img"
          aria-label={t("Mermaid 图表")}
          dangerouslySetInnerHTML={{ __html: current.svg }}
        />
      ) : (
        <pre><code className="language-mermaid">{source}</code></pre>
      )}
    </div>
  );
}
