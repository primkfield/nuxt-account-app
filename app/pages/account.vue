<script setup lang="ts">
type Profile = { displayName: string; locale: 'ja-JP' | 'en-US'; version: number }
const auth = import.meta.client ? useNuxtApp().$auth : undefined
const profile = reactive<Profile>({ displayName: '', locale: 'ja-JP', version: 0 })
const loaded = ref(false)
const busy = ref(false)
const message = ref('')
const failed = ref(false)
function report(error: unknown) {
  failed.value = true
  const status = (error as { status?: number; statusCode?: number }).statusCode ?? (error as { status?: number }).status
  message.value = status === 409 ? '更新が競合しました。「再取得」で最新情報を確認し、入力し直してください。'
    : status === 401 || (error as Error).message === 'SESSION_EXPIRED' ? 'ログインの有効期限が切れました。再度ログインしてください。'
      : status === 403 ? 'この操作は許可されていません。' : '処理を完了できませんでした。接続を確認して再試行してください。'
}
async function load() {
  if (!auth?.state.authenticated) return
  busy.value = true; message.value = ''; failed.value = false
  try { Object.assign(profile, await auth.requestProfile<Profile>('GET')); loaded.value = true; message.value = 'プロフィールを取得しました。' }
  catch (error) { loaded.value = false; report(error) }
  finally { busy.value = false }
}
async function save() {
  if (!auth || !loaded.value) return
  busy.value = true; message.value = ''; failed.value = false
  try {
    Object.assign(profile, await auth.requestProfile<Profile>('PATCH', { displayName: profile.displayName, locale: profile.locale, version: profile.version }))
    message.value = 'プロフィールを保存しました。'
  } catch (error) { report(error) }
  finally { busy.value = false }
}
async function login() { busy.value = true; try { await auth?.login() } catch (error) { report(error); busy.value = false } }
async function logout() { busy.value = true; try { await auth?.logout() } catch { failed.value = true; message.value = 'ログアウト処理を完了できませんでした。接続を確認し、再試行してください。'; busy.value = false } }
onMounted(load)
</script>
<template>
  <section>
    <p class="eyebrow">YOUR PROFILE</p><h1>マイプロフィール</h1>
    <ClientOnly>
      <div v-if="auth?.state.authenticated" class="card">
        <p>本人確認済み · 自分のプロフィールだけを操作できます。</p>
        <form @submit.prevent="save">
          <label for="display-name">表示名</label><input id="display-name" v-model="profile.displayName" maxlength="80" required autocomplete="off" :disabled="busy || !loaded">
          <label for="locale">表示言語</label><select id="locale" v-model="profile.locale" :disabled="busy || !loaded"><option value="ja-JP">日本語</option><option value="en-US">English</option></select>
          <p class="muted">保存バージョン：{{ profile.version }}<span v-if="profile.version === 0">（まだ保存されていません）</span></p>
          <div class="actions"><button :disabled="busy || !loaded" type="submit">保存する</button><button :disabled="busy" class="secondary" type="button" @click="load">再取得</button></div>
        </form>
      </div>
      <div v-else class="card">
        <h2>ログインしてください</h2><p>プロフィール情報は、ログイン後にAPIから取得します。静的なHTMLには含まれません。</p>
        <button :disabled="busy || !auth?.state.configured" @click="login">Cognitoでログイン</button>
        <p class="muted">認証期限切れや再読み込み後も、Cognitoのログインセッションが残る場合があります。下のボタンから終了できます。再読み込みで失われたトークンの失効や、他の端末のログアウトは行えません。</p>
      </div>
      <div class="actions">
        <button :disabled="busy || !auth?.state.configured" class="secondary" type="button" @click="logout">{{ auth?.state.authenticated ? 'ログアウト' : 'Cognitoのセッションを終了する' }}</button>
      </div>
      <template #fallback><p role="status">認証状態を確認しています。</p></template>
    </ClientOnly>
    <p v-if="message" :role="failed ? 'alert' : 'status'" class="status" :class="{error:failed}">{{ message }}</p>
    <p class="muted">検証用の表示名を使用し、個人情報を入力しないでください。退会・メール変更・MFA復旧画面は、この検証版には含まれません。</p>
  </section>
</template>
