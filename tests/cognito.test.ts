import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), revokeTokens: vi.fn(), removeUser: vi.fn(),
  addAccessTokenExpired: vi.fn(), clearStaleState: vi.fn(), signinRedirect: vi.fn(),
}))
vi.mock('oidc-client-ts', () => ({
  UserManager: class {
    getUser = mocks.getUser
    revokeTokens = mocks.revokeTokens
    removeUser = mocks.removeUser
    clearStaleState = mocks.clearStaleState
    signinRedirect = mocks.signinRedirect
    events = { addAccessTokenExpired: mocks.addAccessTokenExpired }
  },
  WebStorageStateStore: class {}, InMemoryWebStorage: class {},
  Log: { NONE: 0, setLevel: vi.fn() },
}))

const config = {
  cognitoIssuer: 'https://example.com/issuer', cognitoDomain: 'https://login.example.com',
  cognitoClientId: 'example-client', cognitoRedirectUri: 'https://example.com/login/callback',
  cognitoScopes: 'openid email profile-api/read profile-api/write',
  cognitoLogoutUri: 'https://example.com/',
}
const assign = vi.fn()
let expired: () => void

async function createAuth(settings = config) {
  vi.stubGlobal('useRuntimeConfig', () => ({ public: settings }))
  const { default: plugin } = await import('../app/plugins/cognito.client')
  // The Nuxt wrapper is an identity function in this unit-test harness.
  return (plugin as unknown as () => { provide: { auth: any } })().provide.auth
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getUser.mockResolvedValue(null)
  mocks.revokeTokens.mockResolvedValue(undefined)
  mocks.removeUser.mockResolvedValue(undefined)
  mocks.addAccessTokenExpired.mockImplementation(callback => { expired = callback })
  vi.stubGlobal('defineNuxtPlugin', (plugin: unknown) => plugin)
  vi.stubGlobal('reactive', reactive)
  vi.stubGlobal('window', {
    location: { pathname: '/account', assign }, sessionStorage: {},
  })
  vi.stubGlobal('$fetch', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

describe('Cognito session termination (OIDC/network mocked)', () => {
  it('revokes the retained refresh token before clearing memory and redirecting', async () => {
    mocks.getUser.mockResolvedValue({ refresh_token: 'dummy-refresh', expired: false })
    const auth = await createAuth()
    auth.state.authenticated = true
    await auth.logout()
    expect(mocks.revokeTokens).toHaveBeenCalledWith(['refresh_token'])
    expect(mocks.revokeTokens.mock.invocationCallOrder[0]).toBeLessThan(mocks.removeUser.mock.invocationCallOrder[0]!)
    expect(mocks.removeUser.mock.invocationCallOrder[0]).toBeLessThan(assign.mock.invocationCallOrder[0]!)
    expect(auth.state.authenticated).toBe(false)
    const target = new URL(assign.mock.calls[0]![0])
    expect(target.origin + target.pathname).toBe('https://login.example.com/logout')
    expect(Object.fromEntries(target.searchParams)).toEqual({ client_id: 'example-client', logout_uri: 'https://example.com/' })
  })

  it('can revoke and terminate after the access-token expiry event', async () => {
    mocks.getUser.mockResolvedValue({ refresh_token: 'dummy-refresh', expired: true })
    const auth = await createAuth()
    auth.state.authenticated = true
    expired()
    expect(auth.state.authenticated).toBe(false)
    expect(mocks.removeUser).not.toHaveBeenCalled()
    await auth.logout()
    expect(mocks.revokeTokens).toHaveBeenCalledOnce()
    expect(assign).toHaveBeenCalledOnce()
  })

  it('still visits /logout after a reload with no in-memory user', async () => {
    const auth = await createAuth()
    expect(auth.state.authenticated).toBe(false)
    await auth.logout()
    expect(mocks.revokeTokens).not.toHaveBeenCalled()
    expect(mocks.removeUser).toHaveBeenCalledOnce()
    expect(assign).toHaveBeenCalledOnce()
  })

  it('does not attempt revocation when no refresh token is retained', async () => {
    mocks.getUser.mockResolvedValue({ access_token: 'dummy-access', expired: true })
    const auth = await createAuth()
    await auth.logout()
    expect(mocks.revokeTokens).not.toHaveBeenCalled()
    expect(assign).toHaveBeenCalledOnce()
  })

  it('preserves memory after revocation failure and allows a retry', async () => {
    mocks.getUser.mockResolvedValue({ refresh_token: 'dummy-refresh', expired: true })
    mocks.revokeTokens.mockRejectedValueOnce(new Error('network unavailable'))
    const auth = await createAuth()
    await expect(auth.logout()).rejects.toThrow('network unavailable')
    expect(mocks.removeUser).not.toHaveBeenCalled()
    expect(assign).not.toHaveBeenCalled()
    await auth.logout()
    expect(mocks.revokeTokens).toHaveBeenCalledTimes(2)
    expect(mocks.removeUser).toHaveBeenCalledOnce()
    expect(assign).toHaveBeenCalledOnce()
  })

  it('rejects an expired profile request without calling the API', async () => {
    mocks.getUser.mockResolvedValue({ expired: true })
    const auth = await createAuth()
    auth.state.authenticated = true
    await expect(auth.requestProfile('GET')).rejects.toThrow('SESSION_EXPIRED')
    expect(auth.state.authenticated).toBe(false)
    expect(globalThis.$fetch).not.toHaveBeenCalled()
  })

  it('rejects session termination when the public configuration is absent', async () => {
    const auth = await createAuth({ ...config, cognitoClientId: '' })
    await expect(auth.logout()).rejects.toThrow('NOT_CONFIGURED')
    expect(assign).not.toHaveBeenCalled()
  })
})
