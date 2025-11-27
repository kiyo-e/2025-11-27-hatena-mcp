# Hatena Blog MCP Server

Cloudflare Workers + Hono + Durable Objects で実装した、はてなブログ操作用のMCPサーバーです。

## 特徴

- **2層のOAuth認証**:
  1. ChatGPT → MCP サーバー用の自前OAuth 2.1実装
  2. MCP サーバー → はてなブログ用のOAuth 1.0aクライアント

- **完全なサーバーレス**: Cloudflare Workers + Durable Objectsで動作
- **JWT署名**: RS256によるアクセストークンの発行と検証

## セットアップ

### 1. 依存関係のインストール

```bash
bun install
```

### 2. はてなブログのOAuthアプリケーション登録

1. [はてなのOAuthアプリケーション登録](https://www.hatena.ne.jp/oauth/develop)にアクセス
2. 新規アプリケーションを作成
3. コールバックURLを設定: `https://your-worker.workers.dev/hatena/oauth/callback`
4. Consumer KeyとConsumer Secretを取得

### 3. JWT鍵とOAuthクライアントの生成

```bash
bun run setup
```

出力された環境変数を`.dev.vars`ファイルにコピーします。

### 4. 環境変数の設定

`.dev.vars`ファイルを作成し、以下の環境変数を設定：

```env
# Hatena OAuth 1.0a credentials
HATENA_CONSUMER_KEY=your_hatena_consumer_key
HATENA_CONSUMER_SECRET=your_hatena_consumer_secret

# Self-hosted OAuth 2.0 server settings
OAUTH_ISSUER=https://your-worker.workers.dev
OAUTH_CLIENT_ID=generated_client_id
OAUTH_CLIENT_SECRET=generated_client_secret
OAUTH_REDIRECT_URIS=https://chatgpt-oauth-callback-url

# JWT signing keys
JWT_PUBLIC_KEY={"kid":"...","alg":"RS256",...}
JWT_PRIVATE_KEY={"kid":"...","alg":"RS256",...}
```

### 5. デプロイ

```bash
bun run deploy
```

### 6. OAuthクライアントの登録

デプロイ後、一度だけクライアント登録を実行：

```bash
curl -X POST https://your-worker.workers.dev/oauth/setup \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "your_oauth_client_id",
    "client_secret": "your_oauth_client_secret",
    "redirect_uris": ["https://chatgpt-callback-url"]
  }'
```

### 7. ChatGPTでMCPサーバーを設定

1. ChatGPTのMCPコネクタ設定を開く
2. 以下を設定:
   - URL: `https://your-worker.workers.dev/mcp`
   - 認証タイプ: OAuth
   - Client ID: `OAUTH_CLIENT_ID`の値
   - Client Secret: `OAUTH_CLIENT_SECRET`の値

## OAuth フロー

### ChatGPT → MCP (OAuth 2.1)

1. ChatGPTが`/.well-known/oauth-protected-resource`を取得
2. ChatGPTが`/oauth/authorize`にユーザーをリダイレクト
3. MCP サーバーが認可コードを発行してChatGPTにリダイレクト
4. ChatGPTが`/oauth/token`で認可コードをアクセストークン（JWT）に交換
5. 以降、ChatGPTは`Authorization: Bearer <JWT>`で`/mcp`にアクセス

### MCP → はてなブログ (OAuth 1.0a)

1. ChatGPTがMCPツール`start_hatena_oauth`を呼び出し
2. MCPサーバーがはてなのrequest tokenを取得して`authorizeUrl`を返す
3. ユーザーがはてなで認可
4. はてなが`/hatena/oauth/callback`にリダイレクト
5. MCPサーバーがaccess tokenを取得してDurable Objectに保存
6. 以降、MCP操作はユーザーのはてなアクセストークンを使用

## API エンドポイント

### Well-Known Endpoints

- `GET /.well-known/oauth-protected-resource`: MCP OAuth リソースメタデータ
- `GET /.well-known/oauth-authorization-server`: OAuth認可サーバーメタデータ

### OAuth Endpoints

- `GET /oauth/authorize`: OAuth認可エンドポイント
- `POST /oauth/token`: トークンエンドポイント
- `GET /oauth/jwks`: 公開鍵エンドポイント（JWK Set）
- `POST /oauth/setup`: クライアント登録（一度のみ実行）

### MCP Endpoints

- `POST /mcp`: MCP JSON-RPCエンドポイント（Bearer認証必須）

### Hatena Callback

- `GET /hatena/oauth/callback`: はてなOAuthコールバック

## MCP ツール

### `start_hatena_oauth`

はてなブログとの連携を開始します。`authorizeUrl`を返すので、ユーザーがそのURLにアクセスして認可を完了します。

### `list_entries`

ブログエントリーの一覧を取得します。

パラメータ:
- `blogId` (string): ブログID
- `limit` (number, optional): 取得件数
- `offset` (number, optional): オフセット

### `create_entry`

新しいブログエントリーを作成します。

パラメータ:
- `blogId` (string): ブログID
- `title` (string): タイトル
- `content` (string): 本文
- `draft` (boolean, optional): 下書きかどうか

### `update_entry`

既存のブログエントリーを更新します。

パラメータ:
- `blogId` (string): ブログID
- `entryId` (string): エントリーID
- `title` (string, optional): タイトル
- `content` (string, optional): 本文
- `draft` (boolean, optional): 下書きかどうか

## ローカル開発

```bash
bun run dev
```

ローカル開発時は`http://localhost:8787`でアクセスできます。

## アーキテクチャ

```
ChatGPT
  ↓ OAuth 2.1 (自前実装)
MCP Server (Cloudflare Workers)
  ├── Durable Objects
  │   ├── UserDO: ユーザーごとのはてなトークン
  │   ├── OAuthStateDO: はてなOAuthの一時状態
  │   ├── ClientDO: OAuthクライアント情報
  │   ├── AuthCodeDO: OAuth認可コード
  │   └── AccessTokenDO: OAuthアクセストークン
  ↓ OAuth 1.0a (クライアント)
Hatena Blog API
```

## ライセンス

MIT
