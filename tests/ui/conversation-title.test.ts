import { describe, expect, it } from "vitest";
import {
  CONVERSATION_TITLE_REQUEST,
  appendConversationTitleRequest,
  extractGeneratedTitle,
  stripConversationTitleRequest,
} from "../../src/app-server/conversation-title";

describe("首轮会话标题协议", () => {
  it("把标题请求原样追加到首条用户消息后", () => {
    expect(appendConversationTitleRequest("修复登录回跳问题")).toBe(
      `修复登录回跳问题\n\n${CONVERSATION_TITLE_REQUEST}`,
    );
    expect(appendConversationTitleRequest("")).toBe(
      CONVERSATION_TITLE_REQUEST,
    );
    expect(CONVERSATION_TITLE_REQUEST).toContain(
      "<!-- conversation-title: 标题 -->",
    );
  });

  it("从完整隐藏标记提取标题并清理可见回复", () => {
    expect(
      extractGeneratedTitle(
        "我先检查登录回跳相关代码。\n\n<!-- conversation-title: 修复登录回跳问题 -->\n",
      ),
    ).toEqual({
      text: "我先检查登录回跳相关代码。",
      title: "修复登录回跳问题",
    });
  });

  it("未收到完整隐藏标记时不提前提取", () => {
    const text = "我先检查。\n\n<!-- conversation-title: 修复登录";
    expect(extractGeneratedTitle(text)).toEqual({ text, title: null });
  });

  it("拒绝占位值、换行标题和超过 40 个 Unicode 字符的标题", () => {
    const fortyEmoji = "🙂".repeat(40);
    const fortyOneEmoji = "🙂".repeat(41);

    expect(
      extractGeneratedTitle(`回复\n<!-- conversation-title: ${fortyEmoji} -->`),
    ).toEqual({ text: "回复", title: fortyEmoji });
    expect(
      extractGeneratedTitle(
        [
          "回复",
          "<!-- conversation-title: 标题 -->",
          "<!-- conversation-title: 第一行\n第二行 -->",
          `<!-- conversation-title: ${fortyOneEmoji} -->`,
        ].join("\n"),
      ),
    ).toEqual({ text: "回复", title: null });
  });

  it("只移除由客户端追加在消息末尾的内部标题请求", () => {
    const visible = "检查附件并给出结论";
    expect(
      stripConversationTitleRequest(
        `${visible}\n\n${CONVERSATION_TITLE_REQUEST}`,
      ),
    ).toBe(visible);
    expect(
      stripConversationTitleRequest(
        `<conversation_title_request>用户自己输入的内容</conversation_title_request>\n${visible}`,
      ),
    ).toBe(
      `<conversation_title_request>用户自己输入的内容</conversation_title_request>\n${visible}`,
    );
  });
});
