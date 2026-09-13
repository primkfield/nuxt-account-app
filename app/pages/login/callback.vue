<script setup lang="ts">
const error = ref(false)
const router = useRouter()
const auth = import.meta.client ? useNuxtApp().$auth : undefined
onMounted(async () => {
  try {
    // Also update the router's state after its initial navigation has settled.
    // The original response is held only inside the client plugin's closure.
    await router.replace({ path: '/login/callback', query: {}, hash: '' })
    if (!auth) throw new Error('NOT_CONFIGURED')
    await auth.callback()
    await navigateTo('/account', { replace: true })
  } catch { error.value = true }
})
</script>
<template>
  <section class="card">
    <p class="eyebrow">AUTHENTICATION CALLBACK</p>
    <h1>{{ error ? 'ログインを確認できませんでした' : 'ログインを確認しています' }}</h1>
    <p v-if="error" role="alert">ログインを最初からやり直してください。戻るボタンで認証URLを再利用しないでください。</p>
    <p v-else role="status">認証の結果を検証しています。この画面にパスワードや確認コードを入力する必要はありません。</p>
    <NuxtLink v-if="error" class="button" to="/">トップへ戻る</NuxtLink>
  </section>
</template>
