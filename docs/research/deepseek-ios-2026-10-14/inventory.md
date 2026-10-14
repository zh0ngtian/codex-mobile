# 截图与 UI 层级目录

38 张原始截图记录中，23 张无个人内容的截图随文档保留。每项都有脱敏 AX 树；本机项的原图在本机私有证据包中。状态名已按实际结果纠正，不能根据原始文件名判断成功。

| 状态 | 页面 / 状态 | 验证范围 | 截图 | UI 层级 | 说明 |
| --- | --- | --- | --- | --- | --- |
| S01 | 新对话 / 初始空态 | 已验证 | [PNG](screenshots/01-home.png) | [AX](trees/01-home.txt) | 蓝鲸标志、欢迎语；深度思考未选中、智能搜索选中。 |
| S02 | 历史抽屉 / 未选中会话 | 已验证 | 本机证据包 | [AX](trees/02-sidebar.txt) | 历史标题、头像与昵称只保存在本机截图。 |
| S03 | 设置 / 浅色 | 已验证 | [PNG](screenshots/03-settings.png) | [AX](trees/03-settings.txt) | 模态容器，账户、应用、语音、关于四组以及帮助与反馈。 |
| S04 | 外观菜单 | 已验证 | [PNG](screenshots/04-appearance.png) | [AX](trees/04-appearance.txt) | 系统、深色、浅色；系统有选中标志。 |
| S05 | 设置 / 深色 | 已验证 | [PNG](screenshots/05-settings-dark.png) | [AX](trees/05-settings-dark.txt) | 实际切换为深色；之后已恢复系统。 |
| S06 | 字体大小 / 跟随系统 | 入口已验证 | [PNG](screenshots/06-font.png) | [AX](trees/06-font.txt) | 预览、跟随系统开关、标准刻度滑块；未拖动滑块。 |
| S07 | 系统设置 / DeepSeek 语言入口 | 截图/OCR已验证 | [PNG](screenshots/07-language.png) | [AX](trees/07-language.txt) | 截图为 iOS 设置页，AX 返回旧 DeepSeek 设置树，树不适用于此截图。 |
| S08 | 个性化 | 入口已验证 | [PNG](screenshots/08-personalization.png) | [AX](trees/08-personalization.txt) | 思考内容自动折叠开启；未修改开关。 |
| S09 | 朗读音色 / 贝壳 | 入口已验证 | [PNG](screenshots/09-voice-settings.png) | [AX](trees/09-voice-settings.txt) | 半屏 Sheet、动态蓝色形状、四个分页点、确认；未切换或确认音色。 |
| S10 | 朗读音色 / close 操作无变化 | 无变化已记录 | 本机证据包 | [AX](trees/10-voice-close-noop.txt) | 原始文件名误称 data；实际仍是音色面板。下拉手势退出成功。 |
| S11 | 数据管理 | 入口已验证 | [PNG](screenshots/11-data.png) | [AX](trees/11-data.txt) | 体验优化开关、共享链接、删除所有历史对话；未执行这些操作。 |
| S12 | 账号管理 | 入口已验证 | 本机证据包 | [AX](trees/12-account.txt) | 邮箱、手机、绑定状态、未成年人模式、登出与注销；联系信息已从公开树替换。 |
| S13 | 历史搜索 / 聚焦但查询为空 | 已验证 | 本机证据包 | [AX](trees/13-search-focused-empty.txt) | 首次 type 未落入字段；截图有第三方键盘和剪贴板候选；不是搜索无结果。 |
| S14 | 历史搜索 / 无相关结果 | 已验证 | [PNG](screenshots/14-search-no-result.png) | [AX](trees/14-search-no-result.txt) | UI-20261014 查询已显示；返回收起键盘后的暂无相关结果。 |
| S15 | 历史搜索 / 无结果重复截图 | 重复证据 | 本机证据包 | [AX](trees/15-search-empty-duplicate.txt) | 与 S14 为相同状态；不另算页面。 |
| S16 | 附件面板 | 已验证 | [PNG](screenshots/16-attachment.png) | [AX](trees/16-attachment.txt) | 输入卡片上移约150pt，下方拍照、相册、文件三卡；加号变关闭。 |
| S17 | 文件来源菜单 | 已验证 | [PNG](screenshots/17-file-source-menu.png) | [AX](trees/17-file-source-menu.txt) | 实际是本地文件 / 微信文件菜单；不是系统文件选择器。 |
| S18 | 系统文件选择器 / 最近项目 | 已验证 | 本机证据包 | [AX](trees/18-local-files.txt) | 系统搜索、图标菜单、最近/共享/浏览；只观察后取消，未选择或上传。 |
| S19 | 语音输入 / 按住说话 | 已验证 | [PNG](screenshots/19-voice.png) | [AX](trees/19-voice.txt) | 切换为按住说话；未启动录音，转写与权限未验证。 |
| S20 | 输入聚焦 / 两个模式同时选中 | 已验证 | 本机证据包 | [AX](trees/20-thinking-search-on.txt) | 两枚胶囊都为蓝色选中；第三方键盘剪贴板区域只存本机。 |
| S21 | 输入 / 多行草稿 | 已验证 | 本机证据包 | [AX](trees/21-compose-filled.txt) | TextView 值确认已输入；卡片高度150pt，发送按钮为蓝色。 |
| S22 | 回复完成 / 思考折叠 / Markdown | 已验证 | [PNG](screenshots/22-response-complete.png) | [AX](trees/22-response-complete.txt) | 原名 generating；实际已完成，显示标题、两条列表、Swift代码块及动作栏。 |
| S23 | 思考标题 Button 中心点击无变化 | 无变化已记录 | 本机证据包 | [AX](trees/23-thinking-toggle-noop.txt) | 原名 expanded；实际仍折叠。后改点 StaticText ref 才成功。 |
| S24 | 回复 / 思考展开 | 已验证 | [PNG](screenshots/24-thinking-expanded.png) | [AX](trees/24-thinking-expanded.txt) | 灰色思考文本、竖线与起点；内容高度增长，转至底部按钮出现。 |
| S25 | 用户消息 / 长按菜单 | 已验证 | [PNG](screenshots/25-user-message-menu.png) | [AX](trees/25-user-message-menu.txt) | 修改、复制、选择文本、分享四项。 |
| S26 | 修改输入 | 入口及取消已验证 | 本机证据包 | [AX](trees/26-message-edit.txt) | 带修改输入提示条与 cancel editing；仅打开后取消，未重发。 |
| S27 | 分享 / 对话组选择 | 入口及退出已验证 | [PNG](screenshots/27-share-selection.png) | [AX](trees/27-share-selection.txt) | 全选、勾选、已选择1组；生成图片、复制链接、微信、更多分享；未最终分享。 |
| S28 | 会话标题点击无变化 | 无变化已记录 | 本机证据包 | [AX](trees/28-title-tap-noop.txt) | 原名 title-menu；实际无菜单。树残留分享选择计数，截图不显示它。 |
| S29 | 历史抽屉 / 当前测试会话 | 已验证 | 本机证据包 | [AX](trees/29-sidebar-test.txt) | 今天分组、蓝色选中行及 ellipsis；个人历史仍可见。 |
| S30 | 会话操作菜单 | 已验证 | 本机证据包 | [AX](trees/30-session-menu.txt) | 重命名、置顶、多选、红色删除；未执行置顶或删除。 |
| S31 | 重命名对话弹窗 | 入口及取消已验证 | 本机证据包 | [AX](trees/31-session-rename.txt) | 预填标题、取消/完成；未保存修改。 |
| S32 | 历史多选 | 入口及退出已验证 | 本机证据包 | [AX](trees/32-session-multiselect.txt) | 默认选中来源会话；顶部数量与退出，底部置顶/删除；未提交。 |
| S33 | 生成中 / 正在思考 | 状态已验证 | [PNG](screenshots/33-streaming.png) | [AX](trees/33-streaming.txt) | 正在思考、底部停止按钮、转至底部；仅捕获生成中的思考阶段。 |
| S34 | 长回复自然完成 / 停止未执行 | 停止结果未验证 | [PNG](screenshots/34-long-response-complete.png) | [AX](trees/34-long-response-complete.txt) | 停止 ref 在点击前失效，工具明确未点击；回复自然完成，不是已停止。 |
| S35 | 长回复 / 转至底部 | 已验证 | [PNG](screenshots/35-long-response-bottom.png) | [AX](trees/35-long-response-bottom.txt) | 按钮确实到达第60条及动作栏，停止结果仍未验证。 |
| S36 | 助手消息 / 长按菜单 | 已验证 | [PNG](screenshots/36-assistant-menu.png) | [AX](trees/36-assistant-menu.txt) | 复制、选择文本、重新生成、喜欢、不喜欢、朗读、分享。 |
| S37 | 消息文本选择 | 已验证 | [PNG](screenshots/37-text-selection.png) | [AX](trees/37-text-selection.txt) | 蓝色选区和两个拖拽柄，复制/全选/分享浮动工具条；未复制或分享。 |
| S39 | 新对话 / 欢迎回来 | 已验证 | [PNG](screenshots/39-final-home.png) | [AX](trees/39-final-home.txt) | 返回空态；外观系统、思考关闭、搜索开启已恢复。树残留旧标题，截图无标题。 |
