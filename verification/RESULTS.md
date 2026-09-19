# 再現可能なローカル検証

実行日：2026-09-19。対象はこのファイルと同じコミットのソースです。実AWSへのデプロイ・再試験は実施していません。

## 環境と固定ファイル

| 項目 | 使用環境 |
| --- | --- |
| OS | macOS 26.6.2 (25G83)、arm64 |
| JavaScript | Node.js 24.18.0、npm 11.16.0、`package-lock.json` |
| フロントエンド検証 | Vitest 5.0.1、Vue Test Utils 2.5.1、jsdom 30.1.0。実ブラウザではない |
| Python | CPython 3.13.9、uv 0.8.15、`verification/uv.lock`（推移的依存・ハッシュを固定） |
| AWS SDK・代替環境 | boto3 1.43.98、Moto 5.2.3、PyYAML 6.0.3。実AWSに接続しない |
| テンプレート | `infra/nuxt-account-cloudformation.yaml`。SHA-256: `a9ec5b9af1ea6f85c8411179cd828fd890c98a20aa2deb639c2b4d2187cb7a21` |

## コマンド

リポジトリのルートで実行します。AWS認証情報は不要で、Pythonテスト内の`testing`はMoto向けのダミー値です。

```bash
npm ci
npm test
npm run typecheck
uv run --project verification --python 3.13.9 --frozen python verification/test_cloudformation.py

NUXT_PUBLIC_COGNITO_ISSUER=https://example.com/issuer \
NUXT_PUBLIC_COGNITO_DOMAIN=https://login.example.com \
NUXT_PUBLIC_COGNITO_CLIENT_ID=example-client \
NUXT_PUBLIC_COGNITO_SCOPES='openid email profile-api/read profile-api/write' \
NUXT_PUBLIC_COGNITO_REDIRECT_URI=https://example.com/login/callback \
NUXT_PUBLIC_COGNITO_LOGOUT_URI=https://example.com/ \
npm run generate
```

生成用の`example.com`は公開設定の埋め込みを調べるダミーです。この成果物で実Cognitoへログインはできません。実環境へ配置しないでください。

## Lambda・CloudFront Function：11件

テストコードは[`test_cloudformation.py`](test_cloudformation.py)です。テンプレートのインラインコードを直接取り出して実行し、テスト用の別実装は用意していません。Pythonの10件はDynamoDBをMotoで代替し、最後の1件はCloudFront FunctionのコードをNode.jsで実行します。サブケースを別テストとして数えていません。

| 検証項目（テストメソッド） | 環境 | 期待値 | 結果 |
| --- | --- | --- | --- |
| `test_first_read_does_not_create_account` | Python・Moto | 初回GETは200・version 0、項目は作成しない | PASS |
| `test_create_update_and_stale_write` | Python・Moto | 初回1→更新2、古いversionの更新は409 | PASS |
| `test_other_user_is_isolated` | Python・Moto | 別subの初回versionは0、2ユーザーの項目を分離 | PASS |
| `test_user_id_override_is_rejected` | Python・Moto | userIdの追加指定は400、項目は作成しない | PASS |
| `test_missing_sub_or_id_token_is_rejected` | Python・Moto | subなし・token_use=idは401 | PASS |
| `test_unavailable_account_cannot_read_or_reactivate` | Python・Moto | DELETINGはGET 403、PATCH 409、再作成不可 | PASS |
| `test_json_content_type_and_size` | Python・Moto | 不正JSON 400、Content-Type不正415、過大本文413 | PASS |
| `test_base64_body` | Python・Moto | 正常Base64本文は200、不正Base64は400 | PASS |
| `test_invalid_fields` | Python・Moto | 空表示名・制御文字・未許可locale・bool/負数versionは400 | PASS |
| `test_unimplemented_route` | Python・Moto | 未実装DELETEは404 | PASS |
| `test_nuxt_static_routes_and_api_exclusion` | Node.js | 静的パスのHTML変換、API・アセット除外、query保持 | PASS |

全Lambda応答について`Cache-Control: no-store`も照合します。JWT Authorizerそのものは実行していません。模擬claimsでLambdaの防御処理を確認するテストです。

## フロントエンド：13件

[`tests/cognito.test.ts`](../tests/cognito.test.ts)の7件と[`tests/account.test.ts`](../tests/account.test.ts)の6件です。本番プラグインとVue SFCを読み込み、OIDC通信・Nuxtの注入のみを代替しています。

| 検証項目 | 環境 | 期待値 | 結果 |
| --- | --- | --- | --- |
| Refresh Token保持時の終了順序 | Vitest・jsdom、OIDCモック | 失効→メモリ削除→正しい/logout URLへ遷移 | PASS |
| Access Token期限切れイベント後の終了 | 同上 | authenticated=falseでもRefresh Tokenを失効して遷移 | PASS |
| 再読み込み相当（userなし）の終了 | 同上 | 失効リクエストなしで/logoutへ遷移 | PASS |
| userはあるがRefresh Tokenなし | 同上 | 失効リクエストなしで/logoutへ遷移 | PASS |
| 失効通信失敗と再試行 | 同上 | メモリを削除せず遷移もしない。再試行成功後に終了 | PASS |
| 期限切れプロフィール要求 | 同上 | SESSION_EXPIRED、APIは呼ばない | PASS |
| 設定なしの終了要求 | 同上 | NOT_CONFIGURED、遷移しない | PASS |
| 認証済み画面 | Vitest・Vue Test Utils・jsdom | フォームとログアウトボタンを表示・操作できる | PASS |
| 認証期限切れ後の画面 | 同上 | フォームを隠してもセッション終了ボタンは操作できる | PASS |
| 再読み込み相当の未認証画面 | 同上 | GETを呼ばず、終了ボタンと制約説明を表示 | PASS |
| 終了失敗後の画面 | 同上 | エラー表示とボタン再有効化、再試行できる | PASS |
| 終了処理中の画面 | 同上 | ログイン・終了を二重実行できない | PASS |
| 設定なしの画面 | 同上 | ログイン・終了ボタンを無効化 | PASS |

## 実行結果

```text
npm test
Test Files  2 passed (2)
Tests       13 passed (13)

uv run --project verification --python 3.13.9 --frozen python verification/test_cloudformation.py
Ran 11 tests
OK

npm run typecheck: exit 0
npm run generate: exit 0
```

`npm ci`後にもテスト・型チェック・静的生成が成功しました。`/`、`/account`、`/login/callback`のHTMLを生成しています。インストール時の依存パッケージ非推奨・install script通知と、生成時のNuxt依存内の未使用import警告はあり、警告ゼロという結果ではありません。コマンドの終了コードはいずれも0です。

補助的な目視確認として、ダミー設定で生成した`/account/`をローカルHTTPサーバーとCodex内蔵ブラウザで開き、再読み込み後も「Cognitoのセッションを終了する」が表示されることを確認しました。Cognitoへの接続・終了処理は実行しておらず、13件の自動テストにも数えていません。

## 証拠の範囲

- 11件の成功は実DynamoDBの競合・分離試験、API Gateway JWT Authorizerの試験ではありません。
- 13件の成功は実Cognitoの失効・Cookie消去・メール・TOTP試験ではありません。再読み込みのテストは新しいメモリ状態を作っており、実ブラウザのリロード操作ではありません。
- 修正前の問題はコードの静的確認によるものです。実AWSで期限切れ／再読み込みを再現した結果はありません。
- 実AWSでの通常操作確認は記事に示す旧版の結果と分離し、このコミットの実AWS合格とは扱いません。
