import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick, onMounted, reactive, ref } from 'vue'
import Account from '../app/pages/account.vue'

const auth = {
  state: reactive({ authenticated: false, configured: true }),
  requestProfile: vi.fn(), login: vi.fn(), logout: vi.fn(),
}
function render() {
  return mount(Account, { global: { stubs: { ClientOnly: { template: '<slot />' } } } })
}
function sessionButton(wrapper: ReturnType<typeof render>) {
  return wrapper.findAll('button').find(button => /ログアウト|Cognitoのセッションを終了する/.test(button.text()))!
}
beforeEach(() => {
  vi.clearAllMocks()
  auth.state.authenticated = false
  auth.state.configured = true
  auth.requestProfile.mockResolvedValue({ displayName: 'Example User', locale: 'ja-JP', version: 1 })
  auth.logout.mockResolvedValue(undefined)
  auth.login.mockResolvedValue(undefined)
  vi.stubGlobal('useNuxtApp', () => ({ $auth: auth }))
  vi.stubGlobal('reactive', reactive)
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('onMounted', onMounted)
})
afterEach(() => vi.unstubAllGlobals())

describe('Account page session controls (Nuxt/OIDC mocked)', () => {
  it('keeps the logout action when authenticated', async () => {
    auth.state.authenticated = true
    const wrapper = render()
    await flushPromises()
    expect(wrapper.find('form').exists()).toBe(true)
    expect(sessionButton(wrapper).text()).toBe('ログアウト')
    await sessionButton(wrapper).trigger('click')
    expect(auth.logout).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('keeps an explicit session-ending action after authentication expires', async () => {
    auth.state.authenticated = true
    const wrapper = render()
    await flushPromises()
    auth.state.authenticated = false
    await nextTick()
    expect(wrapper.find('form').exists()).toBe(false)
    expect(sessionButton(wrapper).text()).toBe('Cognitoのセッションを終了する')
    await sessionButton(wrapper).trigger('click')
    expect(auth.logout).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('offers session termination on an initially unauthenticated page after reload', async () => {
    const wrapper = render()
    expect(auth.requestProfile).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('再読み込みで失われたトークンの失効')
    await sessionButton(wrapper).trigger('click')
    expect(auth.logout).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('shows an error and re-enables the action when revocation fails', async () => {
    auth.logout.mockRejectedValueOnce(new Error('network unavailable'))
    const wrapper = render()
    await sessionButton(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('再試行してください')
    expect(sessionButton(wrapper).attributes('disabled')).toBeUndefined()
    await sessionButton(wrapper).trigger('click')
    expect(auth.logout).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('disables login and logout while session termination is pending', async () => {
    auth.logout.mockReturnValueOnce(new Promise(() => {}))
    const wrapper = render()
    await sessionButton(wrapper).trigger('click')
    expect(wrapper.findAll('button').every(button => button.attributes('disabled') !== undefined)).toBe(true)
    wrapper.unmount()
  })

  it('disables login and session termination when configuration is absent', () => {
    auth.state.configured = false
    const wrapper = render()
    expect(wrapper.findAll('button').every(button => button.attributes('disabled') !== undefined)).toBe(true)
    wrapper.unmount()
  })
})
