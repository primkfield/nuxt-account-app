<script setup lang="ts">
const busy = ref(false)
const message = ref('')
async function login() {
  busy.value = true
  try { await useNuxtApp().$auth.login() }
  catch { message.value = 'ログイン画面を開けませんでした。接続と公開設定を確認してください。'; busy.value = false }
}
</script>
<template>
  <section>
    <p class="eyebrow">SERVERLESS ACCOUNT MANAGEMENT</p>
    <h1>ログインから、<br>自分だけのプロフィールへ。</h1>
    <p class="muted">Nuxtの静的サイトに、Cognitoの認証とJWTで保護したAPIを組み合わせた検証アプリです。</p>
    <div class="actions"><button :disabled="busy" @click="login">ログイン・新規登録</button><NuxtLink class="button secondary" to="/account">プロフィールを開く</NuxtLink></div>
    <p v-if="message" role="alert" class="status error">{{ message }}</p>
    <div class="grid">
      <article class="card"><p class="eyebrow">01 / SIGN IN</p><h2>Cognitoで本人確認</h2><p>登録・ログイン・パスワード再設定は、Cognitoの認証画面で行います。</p></article>
      <article class="card"><p class="eyebrow">02 / AUTHORIZE</p><h2>APIで権限を確認</h2><p>API Gatewayがアクセストークンを検証し、自分の情報だけを操作します。</p></article>
      <article class="card"><p class="eyebrow">03 / PROFILE</p><h2>プロフィールを保存</h2><p>表示名と言語をDynamoDBに保存。パスワードはここには保存しません。</p></article>
    </div>
    <p class="muted">この検証版はトークンをメモリ内に保持するため、ページを再読み込みした場合は再ログインが必要です。</p>
  </section>
</template>
