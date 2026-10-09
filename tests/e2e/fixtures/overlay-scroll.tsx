import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ActionSheet } from "../../../src/ui/ActionSheet";
import { useSidebarSwipe } from "../../../src/features/threads/sidebar-swipe";
import "../../../src/styles.css";

const rows = Array.from({ length: 60 }, (_, index) => <p key={index}>滚动内容 {index + 1}</p>);
function ScrollLayers() {
  const [sidebar, setSidebar] = useState(true);
  const [manager, setManager] = useState(false);
  const [update, setUpdate] = useState(false);
  const sidebarRef = useSidebarSwipe(sidebar, () => setSidebar(true), () => setSidebar(false));
  return (
    <>
      <div className="backend-workspace">
        <div className="conversation-scroll" style={{ height: "100dvh" }}>{rows}</div>
      </div>
      <div ref={sidebarRef} className={`conversation-sidebar-layer${sidebar ? " open" : ""}`}>
        <aside className="conversation-sidebar">
          <div className="thread-list-page">
            <button onClick={() => setManager(true)}>管理设备</button>{rows}
          </div>
        </aside>
        <button className="conversation-sidebar-scrim" aria-label="关闭侧栏" onClick={() => setSidebar(false)} />
      </div>
      <ActionSheet open={manager} title="管理设备" backdropClassName="backend-manager-backdrop" onClose={() => setManager(false)}>
        <button onClick={() => setUpdate(true)}>检查更新</button>{rows}
      </ActionSheet>
      <ActionSheet open={update} title="应用更新" backdropClassName="app-update-backdrop" onClose={() => setUpdate(false)}>{rows}</ActionSheet>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<ScrollLayers />);
