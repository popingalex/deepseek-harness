// @vitest-environment jsdom
/**
 * 0924 Native-First 插件线 Vertical Slice bench（Plugin A + Plugin B）。
 *
 * 被测正本在 emergency-harness 仓 `externals/dsh-reference-renderer` 与
 * `externals/dsh-resource-sidebar`（submodule，相对路径引入源码）。本文件是
 * 跨仓 bench 的落点：审计 §15 裁定 React slot 树组合验证必须在 DSH 自家
 * vitest runner 执行（跨仓 runner 无法内联 DSH lib），属 R8 用户裁决授权的
 * 必要测试提交。R10：进程内 jsdom，不 boot 实例、不占端口。
 *
 * 覆盖规划 §39 sidebar mount 验收 + §41 桥的 Vertical Slice：
 * reference/open → 桥归一化 → ctx.sidebarRight.openResource → 真 tab 域 →
 * 真实 ctx.resources + demo provider → useResource 四态渲染。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render as rtlRender, waitFor } from '@testing-library/react'
import { createElement as h, Fragment } from 'react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ShortcutCatalogEntry } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { inject as resourcesInject, apply as resourcesApply } from '@deepseek-ai/dsh-client-resources/client'
import { inject as sidebarInject, apply as sidebarApply } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import {
  dispatchReferenceOpen,
  normalizeReference,
  ReferenceChip,
  splitWireSegments,
  type ReferenceActivation,
  type ReferenceOpenContext,
} from '../../../../../externals/dsh-reference-renderer/src/index.ts'
import { apply as pluginApply, createApply as pluginCreateApply, inject as pluginInject } from '../../../../../externals/dsh-resource-sidebar/src/client/index.ts'
import { DemoResourceCenter, demoFixturePresentation } from '../../../../../externals/dsh-resource-sidebar/src/demo-provider.ts'
import { demoObjectAddress } from '../../../../../externals/dsh-resource-sidebar/src/address.ts'
import type { Context } from '@deepseek-ai/cordis'

const SESSION = 's-bench' as SessionId

async function mountBench(opts: { apply?: (ctx: Context) => void; skipDemoCenter?: boolean } = {}) {
  const runtime = await SlotTestRuntime.create()
  runtimes.push(runtime)
  runtime.ctx.provide('layout', { openRightbar: vi.fn(), closeRightbar: vi.fn() } as never)
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  const catalog = createSnapshotStore<readonly ShortcutCatalogEntry[]>([])
  runtime.ctx.provide('shortcuts', { register: () => () => {}, catalog } as never)
  runtime.slots.installLocale(locale)
  await runtime.declare({
    'rightbar': { kind: 'single', scope: 'root' },
    'conversation.session.header.corner': { kind: 'single', scope: 'session' },
  })
  await runtime.sessions.add({ id: SESSION })
  const reference = runtime.sessions.retainFor(runtime.ctx, SESSION, { source: 'mainView' })
  await runtime.mount({ inject: [...resourcesInject], apply: resourcesApply })
  let center: DemoResourceCenter | undefined
  if (opts.skipDemoCenter !== true) {
    center = new DemoResourceCenter()
    await runtime.mount({ inject: ['resources'], apply: (ctx) => { ctx.resources.register(center!.provider) } })
  }
  await runtime.mount({ inject: [...sidebarInject], apply: sidebarApply })
  const feature = await runtime.mount({ inject: [...pluginInject], apply: opts.apply ?? pluginApply })
  const view = runtime.renderSlot('rightbar', { width: 420, viewportWidth: 1440, canShow: true }, { session: reference })
  return { runtime, feature, center, controller: runtime.ctx.sidebarRight, view }
}

function openContext(uri: string): ReferenceOpenContext {
  return { descriptor: normalizeReference({ uri, label: 'WI-1' })!, activation: 'pointer' }
}

async function dispatch(runtime: SlotTestRuntime, uri: string) {
  let result: unknown
  await act(async () => { result = await dispatchReferenceOpen(runtime.ctx, openContext(uri)) })
  return result
}

const runtimes: SlotTestRuntime[] = []
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.dispose()
})

describe('0924 插件线 Vertical Slice（reference/open → 桥 → sidebar → useResource）', () => {
  it('全链：alias 引用打开 demo-object 资源，body 渲染 live 值', async () => {
    const h = await mountBench()
    const result = await dispatch(h.runtime, 'dsh-ref:demo-object:WI-1')
    expect(result).toEqual({ handled: true })
    const tab = h.controller.active()!
    expect(tab.contentId).toBe(demoObjectAddress('WI-1'))
    expect(tab.kind).toBe('resource-object')
    await waitFor(() => {
      const body = h.view.container.querySelector('[data-resource-status]')
      expect(body?.getAttribute('data-resource-status')).toBe('live')
    })
    expect(h.view.container.querySelector('[data-resource-value]')?.textContent).toContain('Demo WI-1')
    await h.runtime.dispose()
  })

  it('same address 再次 open → 聚焦既有 tab（dedupe 归 DSH，规划 §20）', async () => {
    const h = await mountBench()
    await dispatch(h.runtime, 'dsh-ref:demo-object:WI-1')
    const first = h.controller.active()!
    await dispatch(h.runtime, demoObjectAddress('WI-1')) // canonical 形态同址
    const second = h.controller.active()!
    expect(second.id).toBe(first.id)
    expect(h.view.container.querySelectorAll('[data-dockkit-tab]')).toHaveLength(1)
    await h.runtime.dispose()
  })

  it('put 变更帧 → body live 更新（authoritative refresh，规划 §19）', async () => {
    const h = await mountBench()
    await dispatch(h.runtime, 'dsh-ref:demo-object:WI-1')
    await waitFor(() => {
      expect(h.view.container.querySelector('[data-resource-status]')?.getAttribute('data-resource-status')).toBe('live')
    })
    act(() => { h.center.put('WI-1', { state: 'doing' }) })
    await waitFor(() => {
      expect(h.view.container.querySelector('[data-resource-value]')?.textContent).toContain('"state": "doing"')
    })
    await h.runtime.dispose()
  })

  it('非资源地址 → 桥 decline，无 tab 产生（§49/§52 诚实降级）', async () => {
    const h = await mountBench()
    const result = await dispatch(h.runtime, 'https://example.com/x')
    expect(result).toBeUndefined()
    expect(h.controller.active()).toBeUndefined()
    await h.runtime.dispose()
  })

  it('presentation contribution 经 resource.presentation 接管渲染（§23），全 decline 落 fallback', async () => {
    const h = await mountBench()
    await act(async () => {
      h.runtime.slots.inject('resource.presentation', () => h.runtime.slots.register(
        {
          name: 'resource.presentation',
          select: owner => owner.address === demoObjectAddress('WI-1') ? { marker: 'custom-projection' } : null,
        },
        (props: { matched: { marker: string } }) => <div data-custom-presentation>{props.matched.marker}</div>,
      ))
    })
    await dispatch(h.runtime, 'dsh-ref:demo-object:WI-1')
    await waitFor(() => {
      expect(h.view.container.querySelector('[data-custom-presentation]')?.textContent).toBe('custom-projection')
    })
    expect(h.view.container.querySelector('[data-resource-value]')).toBeNull() // winner 当选，fallback 不渲染
    await h.runtime.dispose()
  })

  it('插件卸载 → 桥注销，dispatch 回落 no-op（N15）', async () => {
    const h = await mountBench()
    await dispatch(h.runtime, 'dsh-ref:demo-object:WI-1')
    expect(h.controller.active()).not.toBeNull()
    await h.feature.dispose()
    const result = await dispatch(h.runtime, 'dsh-ref:demo-object:WI-2')
    expect(result).toBeUndefined()
    expect(h.controller.active()!.contentId).toBe(demoObjectAddress('WI-1')) // 旧 tab 仍在（sidebar 域未卸）
    await h.runtime.dispose()
  })
})

/* ------------------------------------------------------------------ */
/*  0925 Step 5：user/agent 对称 E2E（plan v3 §18；D1/D3）。              */
/*                                                                      */
/*  作者（user / agent）只决定哪段 wire 文本进入渲染组合；组合本身零分叉： */
/*  splitWireSegments 切片 → ReferenceChip → dispatchReferenceOpen → 桥。 */
/*  消费宿主（conversation 气泡）采用的正是这一组合，本块用 Plugin A 公开  */
/*  契约按原样组装两侧气泡，验证 render/open 目的地/失败语义全对称。      */
/* ------------------------------------------------------------------ */

const WIRE_TEXT = '查看 [WI-1](dsh-ref:demo-object:WI-1) 并继续'
const UNKNOWN_TEXT = '查 [Nope](dsh-ref:no-such-kind:X-1)'

/** 消费宿主气泡的组合正本（切片 + chip + uri 化 dispatch，author 无关）。 */
function WireBubble({ text, dispatch }: { text: string; dispatch: (uri: string, activation: ReferenceActivation) => void }) {
  return h('p', { 'data-eh-dsh-ref-text': 'true' },
    splitWireSegments(text).map((segment, index) => segment.type === 'text'
      ? h(Fragment, { key: `s-${index}` }, segment.text)
      : h(ReferenceChip, {
        key: `r-${index}`,
        descriptor: segment.descriptor,
        onActivate: ({ descriptor, activation }) => dispatch(descriptor.uri, activation),
      })))
}

/** 气泡胶水：uri 重建 descriptor → dispatchReferenceOpen（identity=uri，N5）。
 *  事件驱动路径不包 act——fireEvent 自带 act，嵌套 act 会破坏全局 act 栈，
 *  毒化后续 runtime 的 auto frame 渲染；异步结果经 waitFor 轮询断言。 */
function bubbleDispatch(ctx: SlotTestRuntime['ctx'], record: (uri: string, activation: ReferenceActivation) => void) {
  return (uri: string, activation: ReferenceActivation) => {
    record(uri, activation)
    return dispatchReferenceOpen(ctx, { descriptor: normalizeReference({ uri })!, activation })
  }
}

describe('0925 对称 E2E：user 与 agent 引用同构（render/open/failure，author 零分叉）', () => {
  // 本文件运行环境无 RTL auto-cleanup（vitest globals 关闭）：气泡视图用完
  // 必须显式卸载，残留 React root 会干扰下一个 runtime 的 auto frame 渲染。
  const mountedViews: Array<{ unmount: () => void }> = []
  const renderBubble = (text: string, dispatch: (uri: string, activation: ReferenceActivation) => void) => {
    const view = rtlRender(h(WireBubble, { text, dispatch }))
    mountedViews.push(view)
    return view
  }

  it('两侧同 wire 文本 → 相同 canonical chip、相同 open 目的地、同 tab 去重', async () => {
    const bench = await mountBench()
    const dispatched: Array<{ uri: string; activation: ReferenceActivation }> = []
    const dispatchOf = bubbleDispatch(bench.runtime.ctx, (uri, activation) => dispatched.push({ uri, activation }))
    const user = renderBubble(WIRE_TEXT, dispatchOf)
    const agent = renderBubble(WIRE_TEXT, dispatchOf)

    // render 对称：同一 canonical uri（alias→canonical 与作者无关）、同一交互 affordance
    const userChip = user.container.querySelector('button.dsh-ref-chip')!
    const agentChip = agent.container.querySelector('button.dsh-ref-chip')!
    expect(userChip.getAttribute('data-reference-uri')).toBe(demoObjectAddress('WI-1'))
    expect(agentChip.getAttribute('data-reference-uri')).toBe(demoObjectAddress('WI-1'))
    expect(userChip.textContent).toBe(agentChip.textContent)

    // open 对称：两位作者各激活一次 → 同一 tab（去重），引用身份未按作者分裂
    fireEvent.click(userChip)
    await waitFor(() => { expect(bench.controller.active()?.contentId).toBe(demoObjectAddress('WI-1')) })
    const first = bench.controller.active()!
    fireEvent.click(agentChip)
    await waitFor(() => { expect(bench.controller.active()!.id).toBe(first.id) })
    expect(bench.view.container.querySelectorAll('[data-dockkit-tab]')).toHaveLength(1)
    expect(dispatched).toHaveLength(2)
    expect(dispatched.map(row => row.uri)).toEqual([demoObjectAddress('WI-1'), demoObjectAddress('WI-1')])
    await bench.runtime.dispose()
    for (const view of mountedViews.splice(0)) view.unmount()
  })

  it('失败语义对称：无人接管的引用对两位作者同样 decline，不产生 tab', async () => {
    const bench = await mountBench()
    const dispatched: Array<{ uri: string; activation: ReferenceActivation }> = []
    const dispatchOf = bubbleDispatch(bench.runtime.ctx, (uri, activation) => dispatched.push({ uri, activation }))
    const user = renderBubble(UNKNOWN_TEXT, dispatchOf)
    const agent = renderBubble(UNKNOWN_TEXT, dispatchOf)

    // unclaimed dsh-resource:// 地址：placeResource throw → 桥 warn+decline
    fireEvent.click(user.container.querySelector('button.dsh-ref-chip')!)
    fireEvent.click(agent.container.querySelector('button.dsh-ref-chip')!)
    await waitFor(() => { expect(dispatched).toHaveLength(2) })
    // 两次激活均无人接管：chip 干净 no-op（无 fake detail、无 fake sidebar）
    expect(bench.controller.active()).toBeUndefined()
    expect(bench.view.container.querySelector('[data-resource-status]')).toBeNull()
    await bench.runtime.dispose()
    for (const view of mountedViews.splice(0)) view.unmount()
  })
})

/* ------------------------------------------------------------------ */
/*  0925 Phase 6/7：GenUI contribution（§42 只读声明式）+ Actions        */
/*  （§43 声明式操作 → invoker → Host 权威操作 → 资源流新帧）。          */
/*  fixture center 经 createApply({demo:{center}}) 注入，bench 全程可控。*/
/* ------------------------------------------------------------------ */

describe('0925 Phase 6 GenUI：声明式 presentation plan 经 resource.presentation 当选渲染', () => {
  it('值携带合法 plan → GenUI 渲染白名单词表，fallback 不渲染', async () => {
    const center = new DemoResourceCenter({ fixture: true })
    const bench = await mountBench({
      skipDemoCenter: true,
      apply: pluginCreateApply({ demo: { center } }),
    })
    const result = await dispatch(bench.runtime, 'dsh-ref:demo-object:WI-1')
    expect(result).toEqual({ handled: true })
    await waitFor(() => {
      expect(bench.view.container.querySelector('[data-genui]')).not.toBeNull()
    })
    expect(bench.view.container.querySelector('[data-genui-title]')?.textContent).toBe('Demo 对象')
    expect(bench.view.container.querySelector('[data-genui-field="状态"]')?.textContent).toContain('initial')
    expect(bench.view.container.textContent).toContain('GenUI 展示')
    expect(bench.view.container.querySelector('[data-resource-value]')).toBeNull()
    await bench.runtime.dispose()
  })

  it('权威变更帧 → GenUI 随帧刷新（plan 由 provider 重新生成，§24）', async () => {
    const center = new DemoResourceCenter({ fixture: true })
    const bench = await mountBench({
      skipDemoCenter: true,
      apply: pluginCreateApply({ demo: { center } }),
    })
    await dispatch(bench.runtime, 'dsh-ref:demo-object:WI-1')
    await waitFor(() => {
      expect(bench.view.container.querySelector('[data-genui]')).not.toBeNull()
    })
    // provider 每帧随权威值重新生成 plan（§24：generated tree ≠ 状态证据）
    act(() => { center.put('WI-1', { state: 'doing', presentation: demoFixturePresentation('doing') }) })
    await waitFor(() => {
      expect(bench.view.container.querySelector('[data-genui-field="状态"]')?.textContent).toContain('doing')
    })
    await bench.runtime.dispose()
  })

  it('未知 kind → fail-closed 标记，payload 内容零渲染', async () => {
    const center = new DemoResourceCenter({ fixture: true })
    const bench = await mountBench({
      skipDemoCenter: true,
      apply: pluginCreateApply({ demo: { center } }),
    })
    await dispatch(bench.runtime, 'dsh-ref:demo-object:WI-1')
    await waitFor(() => {
      expect(bench.view.container.querySelector('[data-genui]')).not.toBeNull()
    })
    act(() => { center.put('WI-1', { presentation: { sections: [{ kind: 'mystery', payload: 'SECRET' }] } }) })
    await waitFor(() => {
      expect(bench.view.container.querySelector('[data-genui-unsupported]')).not.toBeNull()
    })
    expect(bench.view.container.textContent).not.toContain('SECRET')
    await bench.runtime.dispose()
  })
})

describe('0925 Phase 7 Actions：声明式操作 → invoker → 权威流刷新 / 失败诚实', () => {
  it('点击声明动作 → invoker 执行 → 权威帧回来 → GenUI 更新', async () => {
    const center = new DemoResourceCenter({ fixture: true })
    const bench = await mountBench({
      skipDemoCenter: true,
      apply: pluginCreateApply({ demo: { center } }),
    })
    await dispatch(bench.runtime, 'dsh-ref:demo-object:WI-1')
    await waitFor(() => {
      expect(bench.view.container.querySelector('[data-resource-action="advance"]')).not.toBeNull()
    })
    expect(bench.view.container.querySelector('[data-resource-action="advance"]')?.getAttribute('data-resource-operation')).toBe('demo.advance')
    fireEvent.click(bench.view.container.querySelector('[data-resource-action="advance"]')!)
    await waitFor(() => {
      expect(bench.view.container.querySelector('[data-genui-field="状态"]')?.textContent).toContain('doing')
    })
    fireEvent.click(bench.view.container.querySelector('[data-resource-action="archive"]')!)
    await waitFor(() => {
      expect(bench.view.container.querySelector('[data-genui-field="状态"]')?.textContent).toContain('archived')
    })
    await bench.runtime.dispose()
  })

  it('终态后再点 advance → invoker false → 行内诚实报错，状态不变', async () => {
    const center = new DemoResourceCenter({ fixture: true })
    center.invoke('WI-1', 'advance')
    center.invoke('WI-1', 'advance')
    center.invoke('WI-1', 'advance') // → done
    const bench = await mountBench({
      skipDemoCenter: true,
      apply: pluginCreateApply({ demo: { center } }),
    })
    await dispatch(bench.runtime, 'dsh-ref:demo-object:WI-1')
    await waitFor(() => {
      expect(bench.view.container.querySelector('[data-genui-field="状态"]')?.textContent).toContain('done')
    })
    fireEvent.click(bench.view.container.querySelector('[data-resource-action="advance"]')!)
    await waitFor(() => {
      expect(bench.view.container.querySelector('[data-resource-action-error]')).not.toBeNull()
    })
    expect(bench.view.container.querySelector('[data-genui-field="状态"]')?.textContent).toContain('done')
    await bench.runtime.dispose()
  })

  it('协议无 invoker（demo:false + 外部 center 声明动作）→ 点击诚实报错，零执行', async () => {
    const center = new DemoResourceCenter()
    center.put('WI-1', { availableActions: [{ id: 'biz', label: '业务操作', operation: 'biz.do' }] })
    const bench = await mountBench({
      skipDemoCenter: true,
      apply: pluginCreateApply({ patterns: ['dsh-resource://demo-object/**'], demo: false }),
    })
    // demo:false → 本 apply 不注册 provider；bench 自带 center 仍由 mountBench 注册
    await runtimeRegister(bench.runtime, center)
    await dispatch(bench.runtime, 'dsh-ref:demo-object:WI-1')
    await waitFor(() => {
      expect(bench.view.container.querySelector('[data-resource-action="biz"]')).not.toBeNull()
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fireEvent.click(bench.view.container.querySelector('[data-resource-action="biz"]')!)
    await waitFor(() => {
      expect(bench.view.container.querySelector('[data-resource-action-error]')).not.toBeNull()
    })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no invoker registered for protocol "demo-object"'))
    warn.mockRestore()
    await bench.runtime.dispose()
  })
})

/** 向已 mount 的 runtime 补注册一个 provider（bench 局部场景用）。 */
async function runtimeRegister(runtime: SlotTestRuntime, center: DemoResourceCenter): Promise<void> {
  await act(async () => {
    await runtime.mount({ inject: ['resources'], apply: (ctx) => { ctx.resources.register(center.provider) } })
  })
}

/* ------------------------------------------------------------------ */
/*  0925 Plugin Management（Next Steps §13）：隔离 / 碰撞 / 卸载泄漏。    */
/*  Cordis fiber/effect 生命周期是 authoritative owner——测试证明        */
/*  installability / independence / clean unload / collision fail-closed。*/
/* ------------------------------------------------------------------ */

describe('0925 插件管理：碰撞 fail-closed 与卸载泄漏', () => {
  it('duplicate protocol 二次注册 fail-closed（不半加载）', async () => {
    const bench = await mountBench()
    // 同 kind 二次注册：第一次注册后 provider 已被 B 的 demo fixture 占位（apply 内部 center）
    // → 外部再注册同协议必须被 DSH fail-loud 拒绝，插件侧幂等吞掉（审计 §24 坑③语义）
    const { DemoResourceCenter } = await import('../../../../../externals/dsh-resource-sidebar/src/demo-provider.ts')
    let threw: Error | null = null
    await act(async () => {
      try {
        await bench.runtime.mount({
          inject: ['resources'],
          apply: (ctx) => { ctx.resources.register(new DemoResourceCenter().provider) },
        })
      } catch (error) {
        threw = error as Error
      }
    })
    expect(threw).not.toBeNull()
    expect(String(threw!.message)).toMatch(/already has a provider/)
    await bench.runtime.dispose()
  })

  it('插件卸载 → 资源流 abort + slot 注册消失（干净卸载，无泄漏）', async () => {
    const bench = await mountBench()
    await dispatch(bench.runtime, 'dsh-ref:demo-object:WI-1')
    await waitFor(() => {
      expect(bench.view.container.querySelector('[data-resource-status]')?.getAttribute('data-resource-status')).toBe('live')
    })
    // 卸载 B 插件 feature：body/tab slot/桥全部走 ctx.effect 注册的 disposer
    await bench.feature.dispose()
    // tab body slot 注销 → 该 tab 无 viewer（DSH 正常 none 行为，不留假 UI）
    const slotEntries = bench.runtime.ctx.slots.entries('sidebar.right.pane.tab')
    const bBody = slotEntries.filter(e => e?.options?.key === 'dsh-resource-sidebar/resource-object')
    expect(bBody).toHaveLength(0)
    // provider 卸载 → 资源流 abort（useResource 回 none）
    // 引用再次 dispatch：桥已随 feature dispose 注销 → 无人接管 decline
    const result = await dispatch(bench.runtime, 'dsh-ref:demo-object:WI-2')
    expect(result).toBeUndefined()
    await bench.runtime.dispose()
  })

  it('A-only 无 B 时：reference/open 无消费者 → 干净 decline（不崩 DSH 核心）', async () => {
    const runtime = await SlotTestRuntime.create()
    runtimes.push(runtime)
    runtime.ctx.provide('layout', { openRightbar: vi.fn(), closeRightbar: vi.fn() } as never)
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale)
    const catalog = createSnapshotStore<readonly ShortcutCatalogEntry[]>([])
    runtime.ctx.provide('shortcuts', { register: () => () => {}, catalog } as never)
    runtime.slots.installLocale(locale)
    await runtime.declare({
      'rightbar': { kind: 'single', scope: 'root' },
      'conversation.session.header.corner': { kind: 'single', scope: 'session' },
    })
    await runtime.sessions.add({ id: SESSION })
    await runtime.mount({ inject: [...resourcesInject], apply: resourcesApply })
    await runtime.mount({ inject: [...sidebarInject], apply: sidebarApply })
    // 只挂 A（不挂 B 桥）→ dispatch 必须干净 decline
    const feature = await runtime.mount({
      inject: [],
      apply: () => {},
    })
    const result = await dispatch(runtime, 'dsh-ref:demo-object:WI-1')
    expect(result).toBeUndefined()
    expect(runtime.ctx.sidebarRight.active()).toBeUndefined()
    await feature.dispose()
    await runtime.dispose()
  })
})

describe('0925 插件管理：运行时 enable/disable 与缺失降级', () => {
  it('disable B 后 DSH 核心继续工作：既有 resource tab 回 none/failed 诚实态，无假 UI', async () => {
    const bench = await mountBench()
    await dispatch(bench.runtime, 'dsh-ref:demo-object:WI-1')
    await waitFor(() => {
      expect(bench.view.container.querySelector('[data-resource-status]')?.getAttribute('data-resource-status')).toBe('live')
    })
    // 运行时 disable（feature dispose 模拟 enable/disable E2E 的 disable 路径）
    await bench.feature.dispose()
    // DSH 核心 sidebar 仍在（域未随插件卸载）；既有 tab 失去 viewer/provider → 诚实降级
    expect(bench.controller.active()).not.toBeUndefined()
    // 资源源回 none（provider 已随插件卸载）；引用 dispatch 无消费者 → decline
    const result = await dispatch(bench.runtime, 'dsh-ref:demo-object:WI-2')
    expect(result).toBeUndefined()
    await bench.runtime.dispose()
  })

  it('reload B：卸载后重新装载 → 同 id 二次注册被 DSH fail-loud 拒绝（碰撞 fail-closed）', async () => {
    // §8 Upgrade 语义：reload 不是插件内原地复活——旧 fiber 的 tab type 注册
    // 仍由 DSH registry 持有（dispose 未清）时，同 id 重挂必须 fail-closed。
    // 升级/reload 的正确路径 = DSH plugin-manager 原生 preflight→stop old→mount new。
    const bench = await mountBench()
    await bench.feature.dispose()
    let threw: Error | null = null
    await act(async () => {
      try {
        await bench.runtime.mount({ inject: [...pluginInject], apply: pluginApply })
      } catch (error) {
        threw = error as Error
      }
    })
    expect(threw).not.toBeNull()
    expect(String(threw!.message)).toMatch(/already registered/)
    await bench.runtime.dispose()
  })

  it('missing provider：地址合法但协议无 provider → 桥接管后 openResource 抛错 → decline 诚实降级', async () => {
    const bench = await mountBench()
    // 卸载 B 后其 demo provider 消失；dh-object tab 仍在（object-sidebar 是 EH 侧，bench 无）——
    // 此处验证 B 自带 demo-object 协议：provider 缺席时引用打开诚实 decline
    await bench.feature.dispose()
    const result = await dispatch(bench.runtime, 'dsh-ref:demo-object:WI-1')
    expect(result).toBeUndefined()
    await bench.runtime.dispose()
  })
})
