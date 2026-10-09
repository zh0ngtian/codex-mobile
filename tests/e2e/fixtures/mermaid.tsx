import { createRoot } from "react-dom/client";
import { MarkdownMessage } from "../../../src/ui/conversation";
import "../../../src/styles.css";

const root = createRoot(document.getElementById("root")!);
export function showMarkdown(text: string) {
  root.render(<main style={{ width: "100%", padding: 16 }}><MarkdownMessage text={text} /></main>);
}
