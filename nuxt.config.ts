export default defineNuxtConfig({
  compatibilityDate: '2026-09-12',
  ssr: true,
  devtools: { enabled: false },
  nitro: { prerender: { autoSubfolderIndex: true, routes: ['/', '/account', '/login/callback'] } },
  runtimeConfig: {
    public: {
      cognitoIssuer: '',
      cognitoDomain: '',
      cognitoClientId: '',
      cognitoScopes: '',
      cognitoRedirectUri: '',
      cognitoLogoutUri: '',
    },
  },
  app: { head: {
    htmlAttrs: { lang: 'ja' },
    title: 'アカウント管理の検証 | Nuxt × Cognito',
    meta: [{ name: 'referrer', content: 'no-referrer' }, { name: 'robots', content: 'noindex, nofollow' }],
  } },
})
