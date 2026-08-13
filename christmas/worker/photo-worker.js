/**
 * 圣诞树拍照上传 Worker
 *
 * 功能：
 *   POST /upload          接收照片（FormData: image=Blob, invite_code=String），存入 KV
 *   GET  /                照片墙页面（HTML），列出所有照片
 *   GET  /view?key=xxx    查看单张照片（返回图片二进制）
 *   GET  /api/list        照片列表（JSON）
 *   GET  /api/delete?key  删除照片（JSON）
 *
 * 部署步骤见同目录 README 或项目说明。
 * KV 命名空间绑定名：PHOTOS
 */

// ====== 安全配置 ======
// 查看照片墙需要的访问口令（防止任何人都能看到照片）。
// 留空字符串 "" 则不校验，任何人都能访问 GET / 和 /api/list。
// 建议改成你自己的密码，访问时在 URL 上加 ?pwd=你的密码
const VIEW_PASSWORD = "";

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
};

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, no-cache, must-revalidate', ...CORS },
    });
}

function checkPwd(url) {
    if (!VIEW_PASSWORD) return true;
    return url.searchParams.get('pwd') === VIEW_PASSWORD;
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // CORS 预检
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: CORS });
        }

        // ---------- 上传照片 ----------
        if (request.method === 'POST' && url.pathname === '/upload') {
            try {
                const formData = await request.formData();
                const image = formData.get('image');
                const inviteCode = formData.get('invite_code') || 'no-code';

                if (!image || typeof image === 'string') {
                    return json({ success: false, message: '缺少图片字段 image' }, 400);
                }

                // 读取图片二进制
                const buffer = await image.arrayBuffer();

                // 生成唯一 key：photo_时间戳_随机串
                const key = `photo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

                // 存入 KV（KV 单值最大 25MB，照片压缩后远小于此）
                await env.PHOTOS.put(key, buffer, {
                    metadata: {
                        invite_code: String(inviteCode),
                        type: image.type || 'image/jpeg',
                        size: buffer.byteLength,
                        timestamp: Date.now(),
                        ua: (request.headers.get('user-agent') || '').slice(0, 200),
                    },
                });

                return json({ success: true, key, size: buffer.byteLength });
            } catch (err) {
                return json({ success: false, message: '上传失败: ' + err.message }, 500);
            }
        }

        // ---------- 查看单张照片 ----------
        if (request.method === 'GET' && url.pathname === '/view') {
            const key = url.searchParams.get('key');
            if (!key) return new Response('缺少 key 参数', { status: 400, headers: CORS });

            const obj = await env.PHOTOS.getWithMetadata(key);
            if (!obj) return new Response('照片不存在', { status: 404, headers: CORS });

            return new Response(obj.value, {
                headers: {
                    'Content-Type': obj.metadata?.type || 'image/jpeg',
                    'Cache-Control': 'no-cache',
                    ...CORS,
                },
            });
        }

        // ---------- JSON 列表 ----------
        if (request.method === 'GET' && url.pathname === '/api/list') {
            if (!checkPwd(url)) return json({ success: false, message: '口令错误' }, 403);
            const list = await env.PHOTOS.list();
            const items = list.keys.map(k => ({
                key: k.name,
                invite_code: k.metadata?.invite_code || '',
                type: k.metadata?.type || 'image/jpeg',
                size: k.metadata?.size || 0,
                time: k.metadata?.timestamp || 0,
                time_str: k.metadata?.timestamp ? new Date(k.metadata.timestamp).toLocaleString('zh-CN') : '',
            }));
            return json({ success: true, count: items.length, items });
        }

        // ---------- 删除照片 ----------
        if (request.method === 'GET' && url.pathname === '/api/delete') {
            if (!checkPwd(url)) return json({ success: false, message: '口令错误' }, 403);
            const key = url.searchParams.get('key');
            if (!key) return json({ success: false, message: '缺少 key' }, 400);
            await env.PHOTOS.delete(key);
            return json({ success: true, key });
        }

        // ---------- 照片墙 HTML ----------
        if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
            if (!checkPwd(url)) {
                return new Response(
                    '<html><body style="font-family:sans-serif;text-align:center;padding:50px">' +
                    '<h2>🔒 照片墙</h2><form method="get"><input name="pwd" placeholder="访问口令" ' +
                    'style="padding:8px;font-size:16px"/><button style="padding:8px 16px">进入</button></form></body></html>',
                    { headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS } }
                );
            }
            const list = await env.PHOTOS.list();
            const pwdParam = VIEW_PASSWORD ? `?pwd=${encodeURIComponent(VIEW_PASSWORD)}` : '';
            const cells = list.keys.map(k => {
                const meta = k.metadata || {};
                const timeStr = meta.timestamp ? new Date(meta.timestamp).toLocaleString('zh-CN') : '';
                const sizeKB = meta.size ? (meta.size / 1024).toFixed(1) + ' KB' : '';
                const del = `/api/delete${pwdParam}&key=${encodeURIComponent(k.name)}`;
                return (
                    `<div style="display:inline-block;margin:10px;vertical-align:top;text-align:center;` +
                    `background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.15)">` +
                    `<img src="/view?key=${encodeURIComponent(k.name)}" style="max-width:240px;display:block"/>` +
                    `<div style="padding:8px;font-size:12px;color:#333">` +
                    `<div>${timeStr}</div>` +
                    `<div style="color:#888">邀请码: ${meta.invite_code || '-'} | ${sizeKB}</div>` +
                    `<a href="${del}" style="color:#e74c3c;text-decoration:none" ` +
                    `onclick="return confirm('删除这张照片?')">删除</a>` +
                    `</div></div>`
                );
            }).join('');
            const html = (
                `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">` +
                `<meta name="viewport" content="width=device-width,initial-scale=1">` +
                `<title>🎄 照片墙 (${list.keys.length})</title></head>` +
                `<body style="margin:0;padding:20px;background:#f0f2f5;font-family:sans-serif">` +
                `<h2 style="text-align:center">🎄 照片墙 — 共 ${list.keys.length} 张</h2>` +
                `<div style="text-align:center">${cells || '<p style="color:#888">还没有照片</p>'}</div>` +
                `</body></html>`
            );
            return new Response(html, {
                headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS },
            });
        }

        return new Response('🎄 Christmas Photo Worker\n\n端点:\n  POST /upload  上传照片\n  GET  /        照片墙\n  GET  /view    查看单张\n  GET  /api/list  JSON列表', {
            headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS },
        });
    },
};
