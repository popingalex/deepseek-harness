# Agent Note: Web 投影结构化引用且不暴露 wire identity

Status: implemented

[English](2026-08-18-web-structured-reference-projection.md) | 中文

## 问题

Emergency Harness 的位置引用以原始 `EH_LOCATION_V1` 字符串进入 composer，并显示在 dock 中；用户、assistant 和团队历史又各自使用不同的文本或按钮渲染。结果是存储 id 与来源 session id 可能进入可见标签，而且 dock 中显示的 token 并不是输入状态机 occurrence，因此提交序列化没有持久 owner 或失败语义。

## 决策

`ui-primitives` 统一拥有结构化引用的纯 parser、显示 formatter、clipboard 投影、`ReferenceChip` 与 `ReferenceText`。新 wire 值使用 `[[EH_REF_V1:{...}]]`，envelope 为 `{ kind: 'location' | 'asset' | 'issue' | 'fact', id?, name?, location?, time? }`；历史同时解析 `EH_LOCATION_V1`。malformed token 保持原始文本。显示与 clipboard 标签忽略 `id`；命名位置先显示名称，再显示严格六位小数的经纬度，最后显示可选的格式化时间。

conversation 输入 action face 暴露 `appendReference`。它在草稿末尾创建既有 U+FFFC occurrence，并把模型序列化交给注册 source 的 codec。Emergency Harness 注册 `eh-reference`，在 `ReferenceInsert.ref` 中保存 envelope JSON，为 composer 与 clipboard 缓存安全显示标签，只在提交时序列化。因此 composer 使用 InputBar 原生 occurrence chip，不再维护平行的 dock 预览。

用户与 assistant 文本 renderer 在既有文本接缝调用 `ReferenceText`。Emergency Harness 团队消息的正文 token、显式 refs 与位置使用同一 primitive。wire token 与存储 identity 在日志或模型文本需要时可以保留，但不会成为可见 chip 内容。

## 考虑过的替代方案

**保留 dock token，并在提交时转换草稿。** 这会在 `InputState.occurrences` 之外建立第二份输入状态，失去原生 undo、copy、owner 失效和序列化失败语义。

**在 Emergency Harness 中分别实现 renderer。** 这会让用户、assistant 与团队标签继续漂移，也会让原生历史无法识别已有 legacy token。

**缺少显示名称时使用 `id`。** 存储 id 不是用户标签。formatter 改用按 kind 区分的 fallback，而完整 id 仍可留在 wire envelope 中。

## 测试

`ui-primitives` 测试 parser、legacy 兼容、malformed 输入、六位位置标签、时间、clipboard 投影与 id 隐藏。`ui-conversation` 测试公开 occurrence 插入、codec 序列化和用户／assistant 历史。`ui-workspace` 测试 event metadata 与本地 Calendar SVG。Emergency Harness 的源码／bundle verifier 和 Playwright 覆盖团队 chip 以及地图到 composer 再到历史的路径。

## 后果

四类引用在 composer 与 transcript 中共享一份显示和 clipboard 契约。插入结构化 occurrence 的插件必须注册 codec；codec 缺失或序列化失败时保留草稿，而不是发送 clipboard 文本。assistant Markdown 在引用 token 处分段，因此 Markdown 语法不能跨该 token 延续，这是有意的限制。
