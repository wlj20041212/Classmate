/**
 * 乐江 AI 代理 Worker
 * 前端不持有密钥，统一走此 Worker 转发到 agnes-ai.cn
 * 密钥存在 Cloudflare 环境变量 AI_API_KEY 中（wrangler secret put 设置）
 */

const AI_ENDPOINT = 'https://api.agnes-ai.cn/v1/chat/completions';
const AI_MODEL = 'agnes-2.5-flash';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: CORS });
    }

    // 读取环境变量中的密钥（不在代码里，不在 git 里）
    const apiKey = env.AI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: '密钥未配置' }), {
        status: 500, headers: { 'Content-Type': 'application/json', ...CORS }
      });
    }

    try {
      const body = await request.json();
      // 注入 model（前端不传，防止篡改）
      if (!body.model) body.model = AI_MODEL;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);

      const res = await fetch(AI_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timer);

      // 透传响应
      const data = await res.text();
      return new Response(data, {
        status: res.status,
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    } catch (e) {
      const msg = e.name === 'AbortError' ? '请求超时' : '服务繁忙';
      return new Response(JSON.stringify({ error: msg }), {
        status: 502, headers: { 'Content-Type': 'application/json', ...CORS }
      });
    }
  }
};
