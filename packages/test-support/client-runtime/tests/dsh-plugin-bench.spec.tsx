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
import { act, waitFor } from '@testing-library/react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ShortcutCatalogEntry } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { inject as resourcesInject, apply as resourcesApply } from '@deepseek-ai/dsh-client-resources/client'
import { inject as sidebarInject, apply as sidebarApply } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { dispatchReferenceOpen, normalizeReference, type ReferenceOpenContext } from '../../../../../externals/dsh-reference-renderer/src/index.ts'
import { apply as pluginApply, inject as pluginInject } from '../../../../../externals/dsh-resource-sidebar/src/client/index.ts'
import { DemoResourceCenter } from '../../../../../externals/dsh-resource-sidebar/src/demo-provider.ts'
import { demoObjectAddress } from '../../../../../externals/dsh-resource-sidebar/src/address.ts'

const SESSION = 's-bench' as SessionId

async function mountBench() {
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
  const center = new DemoResourceCenter()
  await runtime.mount({ inject: ['resources'], apply: (ctx) => { ctx.resources.register(center.provider) } })
  await runtime.mount({ inject: [...sidebarInject], apply: sidebarApply })
  const feature = await runtime.mount({ inject: [...pluginInject], apply: pluginApply })
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
