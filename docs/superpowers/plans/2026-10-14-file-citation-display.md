# 桌面会话文件引用显示修复计划

> **For agentic workers:** 使用 superpowers:subagent-driven-development 按下列步骤执行，先复现失败再修复，再分别审查范围与质量。

**Goal:** 会话中的桌面文件引用及明确的附件列表显示为可点击的文件名，并进入现有远程文件打开和下载功能。

**Architecture:** 在现有 MarkdownMessage 的 remark 阶段转换对应文本节点为标准 Markdown 链接节点，复用 RemoteFileLink。只处理合法的已支持本机绝对路径；代码块、行内代码、已有链接、畸形指令不转换。原始会话、复制、编辑与协议保持不变。

**Tech Stack:** TypeScript、React、react-markdown、remark、Vitest。

## 证据与范围

- 会话 `01a13968-33f9-7d40-bc87-6e883b7ca869` 的最终回答含独立成行的 `:codex-file-citation{path="..." purpose="source" artifact_kind="workbook"}`。
- 用户附件区为 `# Files mentioned by the user:`、`## 文件名: /Users/...`，正文区由 `## My request:` 开始。
- 当前 MarkdownMessage 只有 GFM，以上两种输入均不会产生文件链接。
- 不增加 Office 文档转换器；文件按现有能力打开与下载。不更改网关，不触发网关部署。
- 初始测试 `conversation.test.tsx` 通过；`image-preview.test.tsx` 的生成视频旧用例失败，其余通过。旧失败须明确记录，不能声明全通过。

## 任务 1：复现、转换与回归

**Files:**
- Create: `src/ui/remark-file-references.ts`
- Modify: `src/ui/conversation.tsx`（MarkdownMessage remarkPlugins）
- Create: `tests/ui/file-references.test.tsx`

- [x] 添加端到端组件测试，覆盖该会话四种实际文件名（中文、空格、括号、doc/docx/xls），断言显示文件名而非指令、href 经正确编码、点击调用 `fs/readFile` 原始路径、二进制文件提供现有下载入口。

```tsx
const path = '/Users/zhongtian/Downloads/附件12 项目合同及保密协议(2)(2).doc';
render(<MarkdownMessage
  text={`:codex-file-citation{path="${path}" purpose="source"}`}
  renderLink={(href, children) => <RemoteFileLink href={href} client={client} backend={backend}>{children}</RemoteFileLink>}
/>);
fireEvent.click(screen.getByRole('link', { name: path.split('/').at(-1)! }));
await waitFor(() => expect(client.request).toHaveBeenCalledWith('fs/readFile', { path }));
```

- [x] 使用相同测试文件覆盖附件列表：只有明确的 Files mentioned 区域里的 `## 名称: 绝对路径` 才生成文件链接，`## My request:` 及后续普通标题不转换；不改消息原文与复制内容。
- [x] 覆盖行内引用、双冒号形式（只兼容相同文件引用指令）、属性次序、未知属性；拒绝缺 path/非法路径/重复 path/未闭合属性；代码块、行内代码、普通路径标题、已有 Markdown 链接保持原样。
- [x] 运行 `npm test -- tests/ui/file-references.test.tsx`，保存红灯证据。失败必须是文件链接缺失而非测试环境错误。
- [x] 实现 remark 插件，遍历普通文本节点：以严格属性解析识别 `:codex-file-citation{...}`，经调用方的 parseRemoteFileHref 校验后创建 `{type:"link", url:encodeURI(path), children:[{type:"text", value:文件名}]}`。不递归进入 code/inlineCode/link/image/html。附件列表通过根节点的标题层级与明确区域识别，不进行全局路径自动链接。
- [x] 在 MarkdownMessage 中配置 `[remarkGfm, [remarkFileReferences, { parseFileHref: parseRemoteFileHref }]]`，插件独立模块避免循环依赖。
- [x] 运行新测试和 `npm test -- tests/ui/conversation.test.tsx tests/ui/attachments.test.ts`，然后 `npm run typecheck`，保存绿灯证据。
- [x] 自审并完成中文 Conventional Commit，提交正文包含“新增功能”和“主要修改”。

## 任务 2：审查、发布及核对

- [ ] 独立范围审查核对以上要求；通过后独立质量审查代码、回归与边界。
- [ ] 更新 README 当前文件引用能力与本计划实际验证结果。
- [ ] 执行发布要求的 adapter-regression、coordinator-recovery、build-contract、typecheck，记录真实日志到仓库外 validation。
- [ ] 推送确定 SHA 后以任务 `codex-mobile-file-citations-20261014` ready；持续 heartbeat，等待客户端批次成功。
- [ ] 按成功 receipt 核对 GitHub 双端、固定 APK/已签名 IPA、HTTPS OTA、软件源 unsigned 对应版本和中文更新日志。
- [ ] 交付提供修复摘要、验证边界、固定 OTA/APK/IPA 与双端版本、大小、散列、IPA 签名状态。

## 本地验收记录

新增 39 项文件引用回归，联合会话及附件测试共 136 项通过；typecheck 通过。WebKit 与 Chromium 在 375px 窄屏、默认和 1.3 倍字号下共 4 项通过，截图已检查。发布前置检查为 153 项适配器回归、30 项协调器恢复和 82 项构建契约，均通过。证据位于发布主机 `ReleaseCoordinator/validations/file-citations-20261014/`。未创建真实测试会话，无归档事项；未进行真机覆盖安装或 Office 内容预览验收。

独立审查发现的 HTML 引号属性及附件区标题层级问题已先补失败回归再修复；引用解析不使用 lookbehind，避免引入旧 WebKit 不支持的语法。

HTML 注释及跨段附件标题范围补充 6 项失败回归后修复，附件识别与引用识别共用 HTML 范围扫描；注释、CDATA、处理指令及声明作为完整 token 跳过，不增加依赖。
