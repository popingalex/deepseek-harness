# Agent Note：被领域认领的空白会话保持可见，且 New Session 不再复用

Status: implemented

[English](2026-08-19-domain-claimed-blank-sessions.md) | 中文

## 问题

空白会话（还没有 `turn/start`）会被 New Session 流程复用，并且除非是当前会话，否则在分组界面上隐藏。在首个 turn 之前就认领会话的领域——Emergency Harness 会在空白会话上登记事件草稿，以便首次提问前配置成员——同时踩中两条规则：新会话会把用户悄无声息地带进事件草稿；而用户一旦切走，草稿就从工作区树里消失。

## 决策

复用现有的 `sessionVisibility` 解析器（ui-workspace 树）作为领域认领标记：判定为 `'visible'` 的空白会话即领域所有。`WorkspaceRuntime.connectWorkspace` 的复用扫描咨询同一个可选服务并跳过被认领的空白会话，因此 New Session 会新建一个普通会话，而不是回收被认领的会话。不引入新服务：领域提供一个解析器，同时获得两种行为。Emergency Harness 从其事件登记表提供该解析器，事件草稿从创建到首次提问一直留在树中（带徽章），原生「新会话」按钮不需要任何拦截。

## 否决的备选方案

**在领域插件里拦截原生「新会话」点击。** 捕获阶段的 DOM 监听可以改道这个手势，但它与框架默认行为对抗，按钮结构或语言一变就坏，而且覆盖不了其他复用入口（工作区连接）。否决。

**推迟到首次提问才登记事件。** 延迟登记不动空白会话，但成员配置就得放在平行的客户端暂存里、提交时才物化——形成第二条创建流程，放弃时还会留下孤儿角色会话。否决。

**用标记会话事件翻转 blank 位。** 列表投影只在 `turn/start` 时清除 `blank`；插件事件有意不计入，伪造 turn 会污染轨迹。否决。

## 测试

`packages/client/runtime/tests/workspaces-service.client.spec.ts` 覆盖复用扫描跳过被认领空白（落到普通成员空白；只剩被认领空白时新建）。既有复用、归档、游离 cwd 用例保持通过。EH 侧用 Playwright 验证点击流程。

## 影响

`sessionVisibility` 现在承载两种行为：解析器对空白会话给出 `'visible'` 即意味着「领域所有，New Session 不得染指」。只想要树内可见而不排除复用的领域没有独立开关——目前没有这种需求。Host 侧的 blank 定义不变。
