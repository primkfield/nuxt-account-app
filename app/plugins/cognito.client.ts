import { UserManager, WebStorageStateStore, InMemoryWebStorage, Log } from 'oidc-client-ts'

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig().public
  const state = reactive({ authenticated: false, configured: false })
  // Capture once in a private closure and remove authorization parameters early.
  let callbackUrl: string | undefined
  if (window.location.pathname.replace(/\/$/, '') === '/login/callback') {
    callbackUrl = window.location.href
    window.history.replaceState(window.history.state, '', '/login/callback')
  }
  Log.setLevel(Log.NONE)
  const configured = Object.values(config).every(v => typeof v === 'string' && v.length > 0)
  let manager: UserManager | undefined
  if (configured) {
    manager = new UserManager({
      authority: config.cognitoIssuer,
      client_id: config.cognitoClientId,
      redirect_uri: config.cognitoRedirectUri,
      response_type: 'code',
      response_mode: 'query',
      scope: config.cognitoScopes,
      disablePKCE: false,
      loadUserInfo: false,
      automaticSilentRenew: false,
      monitorSession: false,
      revokeTokenTypes: ['refresh_token'],
      requestTimeoutInSeconds: 15,
      staleStateAgeInSeconds: 900,
      // Only the short-lived PKCE transaction goes into sessionStorage.
      stateStore: new WebStorageStateStore({ store: window.sessionStorage, prefix: 'account-lab.state.' }),
      // Tokens stay in this tab's memory, never the Nuxt payload or localStorage.
      userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
    })
    state.configured = true
    manager.events.addAccessTokenExpired(() => { state.authenticated = false })
  }
  const requireManager = () => {
    if (!manager) throw new Error('NOT_CONFIGURED')
    return manager
  }
  const auth = {
    state,
    async login() {
      const client = requireManager()
      await client.clearStaleState()
      await client.signinRedirect({ nonce: crypto.randomUUID() })
    },
    async callback() {
      const client = requireManager()
      const url = callbackUrl
      callbackUrl = undefined
      if (!url) throw new Error('INVALID_CALLBACK')
      try {
        const user = await client.signinRedirectCallback(url)
        if (user.expired || !user.access_token) throw new Error('INVALID_SESSION')
        state.authenticated = true
      } catch {
        await client.removeUser()
        state.authenticated = false
        throw new Error('LOGIN_FAILED')
      }
    },
    async requestProfile<T>(method: 'GET' | 'PATCH', body?: Record<string, unknown>) {
      const client = requireManager()
      const user = await client.getUser()
      if (!user || user.expired) {
        state.authenticated = false
        throw new Error('SESSION_EXPIRED')
      }
      return await $fetch<T>('/api/me', {
        method,
        ...(method === 'PATCH' ? { body } : {}),
        headers: { Authorization: `Bearer ${user.access_token}` },
        cache: 'no-store',
        retry: 0,
      })
    },
    async logout() {
      const client = requireManager()
      // If revocation fails, leave the user on the page so they can retry.
      await client.revokeTokens(['refresh_token'])
      await client.removeUser()
      state.authenticated = false
      const logout = new URL('/logout', config.cognitoDomain)
      logout.searchParams.set('client_id', config.cognitoClientId)
      logout.searchParams.set('logout_uri', config.cognitoLogoutUri)
      window.location.assign(logout.href)
    },
  }
  return { provide: { auth } }
})
