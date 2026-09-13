# nuxt-account-app

Nuxtの静的サイトとAmazon Cognitoを組み合わせた、アカウント管理PoCのフロントエンドです。Cognitoでのログイン後、JWTで保護されたAPIを呼び出してプロフィールを取得・更新します。

このリポジトリはフロントエンドのみを管理します。CloudFormationテンプレート、API Gateway／Lambdaの実装、AWS環境の設定値は含みません。認証とプロフィール操作には、後述のバックエンドを別途用意してください。

## ディレクトリ構成

```text
nuxt-account-app/
├── package.json
├── package-lock.json
├── tsconfig.json
├── nuxt.config.ts
├── .env.example
├── .gitignore
├── README.md
└── app/
    ├── app.vue
    ├── plugins/
    │   └── cognito.client.ts
    └── pages/
        ├── index.vue
        ├── account.vue
        └── login/
            └── callback.vue
```

## 使用技術

- Nuxt 4.5.2
- oidc-client-ts 3.5.0
- TypeScript

Node.js 24.18.0／npm 11.16.0で、依存関係のインストール、型チェック、静的生成を確認しています。`package-lock.json`で依存関係を固定しています。

`package.json`の`private: true`はnpmへの誤公開を防ぐ設定です。GitHubリポジトリの公開・非公開とは独立しています。

## セットアップ

```bash
git clone https://github.com/primkfield/nuxt-account-app.git
cd nuxt-account-app
npm ci
cp .env.example .env
```

`.env`に自身の環境の値を設定します。値を空のままにすると、画面は表示できますがログインはできません。

| 環境変数 | 設定内容 |
| --- | --- |
| `NUXT_PUBLIC_COGNITO_ISSUER` | User PoolのIssuer URL |
| `NUXT_PUBLIC_COGNITO_DOMAIN` | Cognitoのログイン用ドメイン。先頭に`https://`を含める |
| `NUXT_PUBLIC_COGNITO_CLIENT_ID` | クライアントシークレットを持たないApp ClientのID |
| `NUXT_PUBLIC_COGNITO_SCOPES` | `openid email`と、プロフィール取得・更新用のカスタムスコープ。スペース区切りで指定 |
| `NUXT_PUBLIC_COGNITO_REDIRECT_URI` | フロントエンドの`/login/callback`への完全なURL |
| `NUXT_PUBLIC_COGNITO_LOGOUT_URI` | フロントエンドのトップページへの完全なURL |

これらはブラウザに配信される公開設定です。クライアントシークレット、AWSアクセスキー、パスワード、トークンは設定しないでください。`.env`はGit管理対象から除外していますが、設定値は静的生成した成果物には含まれます。

## ローカル起動・静的生成

```bash
npm run dev
```

ローカル起動だけではバックエンドは作成されません。画面表示は確認できますが、認証にはローカル用のコールバック／ログアウトURLの登録が必要です。プロフィール操作には、同一オリジンの`/api/me`に到達できる開発用構成も必要です。このリポジトリにはAPIモックや開発用プロキシ設定は含みません。

型チェックと、S3に配置する静的ファイルの生成：

```bash
npm run typecheck
npm run generate
```

配信対象は`.output/public/`の中身です。`/`、`/account`、`/login/callback`を事前生成します。Cognitoの設定値は生成前に指定し、値を変更した場合は再生成してください。S3上ではNuxtのサーバー処理は動作しません。

## 接続するAWS構成

- フロントエンド：CloudFront → 非公開S3（OAC）
- バックエンド：CloudFrontの`/api/*` → API Gateway HTTP API → Lambda → DynamoDB
- 認証：Cognito User PoolのManaged LoginとAuthorization Code Flow + PKCE

CognitoのApp ClientでAuthorization Code Flowと必要なスコープを許可し、コールバック／ログアウトURLをフロントエンドの設定と一致させます。

CloudFrontでは`/api/*`のキャッシュを無効にし、Authorizationヘッダーと必要なHTTPメソッドをAPI側へ転送します。静的ページへの直接アクセスも解決できるように、`/account`と`/login/callback`を、それぞれの`index.html`へ対応付ける設定が必要です。

API GatewayではJWTを検証し、ルートごとに取得・更新用のスコープを要求します。Lambdaでは、検証済みトークンの`sub`に対応する利用者のデータだけを操作します。フロントエンドの表示制御だけで認可しないでください。

### プロフィールAPI

フロントエンドは、同一オリジンの`/api/me`へAccess TokenをBearer形式で送ります。接続先を切り替える環境変数や、APIの実装は含みません。

- `GET /api/me`：自分のプロフィールを取得
- `PATCH /api/me`：`displayName`、`locale`、`version`を送って更新

成功時は、両メソッドとも以下の形のJSONを返すバックエンドを想定しています。

```json
{
  "displayName": "検証ユーザー",
  "locale": "ja-JP",
  "version": 1
}
```

`locale`は`ja-JP`または`en-US`です。`version`はバックエンドで管理し、更新成功時に進めます。更新競合時の`409`、未認証の`401`、権限不足の`403`を画面で通知します。

## 認証とPoCの範囲

- パスワードはCognitoの画面で入力します。
- トークンはタブ内のメモリに保持します。ページ再読み込み時は再ログインが必要です。
- PKCEの一時的なトランザクション状態のみ`sessionStorage`に保存します。
- 自動トークン更新は無効です。ログアウトではリフレッシュトークンの失効、メモリ内セッションの削除、Cognitoのログアウト画面への遷移を行います。
- ログアウトによって、発行済みJWTをAPI Gatewayが直ちに拒否することまでは保証しません。
- 退会、メール変更、MFA復旧、管理者画面は含みません。
- WAFや監視基盤を作成するコードは含みません。本番運用に必要な対策をすべて備えた構成ではありません。

公開リポジトリには、実環境の設定値、認証情報、`node_modules/`、ビルド成果物を含めていません。公開ソースの検証では型チェックと静的生成を実施し、このリポジトリ作成時に実AWSへの認証・API操作の再試験は行っていません。
