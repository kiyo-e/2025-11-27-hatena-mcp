import { Hono } from 'hono';
import type { CloudflareBindings } from '../types';

export const app = new Hono<{ Bindings: CloudflareBindings }>();

app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Hatena MCP Server</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
          background-color: #f4f4f9;
          color: #333;
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          margin: 0;
        }
        .container {
          text-align: center;
          background: white;
          padding: 2rem;
          border-radius: 8px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          max-width: 600px;
          width: 100%;
        }
        h1 {
          font-size: 2.5rem;
          margin-bottom: 0.5rem;
          color: #00A4DE; /* Hatena Blue-ish */
        }
        p {
          font-size: 1.1rem;
          line-height: 1.6;
          color: #666;
        }
        .code {
          background: #eee;
          padding: 0.2rem 0.4rem;
          border-radius: 4px;
          font-family: monospace;
          font-size: 0.9em;
        }
        .footer {
          margin-top: 2rem;
          font-size: 0.9rem;
          color: #999;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Hatena MCP Server</h1>
        <p>Hatena MCP (Model Context Protocol) サーバーへようこそ。</p>
        <p>このサーバーは、MCPプロトコルを通じてはてなブログの機能を公開し、AIエージェントがブログ記事の閲覧や作成、更新を行えるようにします。</p>
        <p>MCPエンドポイントは <span class="code">/mcp</span> にあります。</p>
        <div class="footer">
          &copy; 2025 kiyo-e
        </div>
      </div>
    </body>
    </html>
  `);
});
