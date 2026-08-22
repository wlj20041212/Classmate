/**
 * 飞鸽传书 Cloudflare Worker
 * 功能：发信、收信、我发的信、标记已读、召回、兑换码、owner登录、owner查看全部信件
 * 无需 Durable Objects，用 KV + 时间戳按需计算状态实现准时送达
 *
 * 核心思路（无DO准时送达）：
 *   - 发信时存 deliverAt（送达时间戳）和 willDie（是否会死）、deathReason（死因）
 *   - 每次查询 inbox/sent 时，Worker 检查 Date.now() vs deliverAt
 *   - 若 now >= deliverAt：willDie=true → 状态改 dead；willDie=false → 状态改 delivered
 *   - 即使用户关了网页，下次打开查询时 Worker 自动更新状态
 *   - 前端轮询30秒刷新，位置会随时间变化
 */

// ============ 配置 ============
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};
const TZ_OFFSET = 8 * 3600 * 1000; // 北京时间 UTC+8

// ============ 工具函数 ============
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

// UTC转北京时间字符串
function toBJTime(ts) {
  if (!ts) return '';
  return new Date(ts + TZ_OFFSET).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

// 生成消息ID
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// JWT 签名（简易 HMAC）
async function sign(payload, key) {
  const enc = new TextEncoder();
  const data = enc.encode(JSON.stringify(payload));
  const cryptoKey = await crypto.subtle.importKey(
    'raw', enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, data);
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function verifyToken(token, key) {
  if (!token) return null;
  try {
    const [payloadB64, sig] = token.split('.');
    const payload = JSON.parse(atob(payloadB64));
    if (payload.exp < Date.now()) return null;
    const expected = await sign(payload, key);
    if (sig !== expected) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// 获取请求中的 token
function getToken(req) {
  const auth = req.headers.get('Authorization') || '';
  return auth.replace('Bearer ', '');
}

// ============ 主入口 ============
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    // 兼容 /chat/api/* 和 /api/* 两种路径
    path = path.replace(/^\/chat/, '');

    // ---------- 路由 ----------
    // 公开接口
    if (path === '/api/send' && method === 'POST') return handleSend(request, env);
    if (path === '/api/inbox' && method === 'GET') return handleInbox(request, env, url);
    if (path === '/api/sent' && method === 'GET') return handleSent(request, env, url);
    if (path === '/api/read' && method === 'POST') return handleRead(request, env);
    if (path === '/api/recall' && method === 'POST') return handleRecall(request, env);
    if (path === '/api/redeem' && method === 'POST') return handleRedeem(request, env);
    if (path === '/api/delete-inbox' && method === 'POST') return handleDeleteInbox(request, env);
    if (path === '/api/delete-sent' && method === 'POST') return handleDeleteSent(request, env);
    if (path === '/api/pin' && method === 'POST') return handlePin(request, env);
    if (path === '/api/migrate' && method === 'POST') return handleMigrate(request, env);
    if (path === '/api/getname' && method === 'GET') return handleGetName(request, env, url);
    if (path === '/api/setname' && method === 'POST') return handleSetName(request, env);

    // owner 接口
    if (path === '/api/owner-login' && method === 'POST') return handleOwnerLogin(request, env);
    if (path === '/api/owner/messages' && method === 'GET') return handleOwnerMessages(request, env, url);
    if (path === '/api/owner/batch-delete' && method === 'POST') return handleOwnerBatchDelete(request, env);

    return json({ error: 'Not Found' }, 404);
  },
};

// ============ 发信 ============
async function handleSend(request, env) {
  try {
    const body = await request.json();
    const { to, content, flyHours, fromGPS, animal, petName, willDie, deathReason } = body;

    if (!to || !/^[A-HJ-NP-Z2-9]{6}$/.test(to)) return json({ error: '收件人信箱号无效' }, 400);
    if (!content) return json({ error: '内容不能为空' }, 400);

    const now = Date.now();
    const hours = parseFloat(flyHours) || 24;
    const deliverAt = now + hours * 3600000;
    const from = body.from || '';

    const msg = {
      id: genId(),
      from,                      // 发件人信箱号
      to,                        // 收件人信箱号
      content,                   // 信件内容
      fromGPS: fromGPS || null,  // 发件人定位 {lat,lng}
      toGPS: null,               // 收件人定位（收件人首次打开时记录）
      animal: animal || 'dove',  // 信使种类
      petName: petName || '',    // 信使名号
      willDie: !!willDie,        // 是否会死
      deathReason: deathReason || '', // 死因
      flyHours: hours,
      deliverAt,                 // 送达时间戳
      createdAt: now,            // 发送时间
      status: 'flying',          // 状态：flying/delivered/read/recalled/dead
      readAt: null,
    };

    // 存入 KV：收件人收件箱 + 发件人发件箱
    await env.MESSAGES.put(`msg:${msg.id}`, JSON.stringify(msg));
    await env.MESSAGES.put(`inbox:${to}:${msg.id}`, msg.id);
    await env.MESSAGES.put(`sent:${from}:${msg.id}`, msg.id);

    return json({ ok: true, messageId: msg.id, deliverAt });
  } catch (e) {
    return json({ error: '发送失败' }, 500);
  }
}

// ============ 按需计算状态（无DO核心） ============
async function computeStatus(msg, env) {
  // 如果还在飞行中，检查是否到时间了
  if (msg.status === 'flying') {
    const now = Date.now();
    if (now >= msg.deliverAt) {
      // 到时间了，判定最终状态
      if (msg.willDie) {
        msg.status = 'dead';
      } else {
        msg.status = 'delivered';
      }
      // 更新 KV
      await env.MESSAGES.put(`msg:${msg.id}`, JSON.stringify(msg));
    }
  }
  return msg;
}

// ============ 收件箱 ============
async function handleInbox(request, env, url) {
  const box = url.searchParams.get('box');
  if (!box) return json({ error: '缺少信箱号' }, 400);

  // 记录收件人定位
  const lat = url.searchParams.get('lat');
  const lng = url.searchParams.get('lng');

  const listRes = await env.MESSAGES.list({ prefix: `inbox:${box}:` });
  const messages = [];
  for (const key of listRes.keys) {
    const id = key.name.split(':')[2];
    const raw = await env.MESSAGES.get(`msg:${id}`);
    if (!raw) continue;
    let msg = JSON.parse(raw);
    // 跳过已被收件人删除的
    if (msg.inboxDeletedBy === box) continue;
    // 记录收件人定位（首次）
    if (lat && lng && !msg.toGPS && msg.to === box) {
      msg.toGPS = { lat: parseFloat(lat), lng: parseFloat(lng) };
      await env.MESSAGES.put(`msg:${id}`, JSON.stringify(msg));
    }
    // 按需计算状态
    msg = await computeStatus(msg, env);
    // 映射置顶字段
    msg.pinned = !!msg.pinnedByReceiver;
    messages.push(msg);
  }

  messages.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return json({ messages });
}

// ============ 我发的信 ============
async function handleSent(request, env, url) {
  const from = url.searchParams.get('from');
  if (!from) return json({ error: '缺少信箱号' }, 400);

  const listRes = await env.MESSAGES.list({ prefix: `sent:${from}:` });
  const messages = [];
  for (const key of listRes.keys) {
    const id = key.name.split(':')[2];
    const raw = await env.MESSAGES.get(`msg:${id}`);
    if (!raw) continue;
    let msg = JSON.parse(raw);
    // 跳过已被发件人删除的
    if (msg.sentDeletedBy === from) continue;
    msg = await computeStatus(msg, env);
    // 映射置顶字段
    msg.pinned = !!msg.pinnedBySender;
    messages.push(msg);
  }

  messages.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return json({ messages });
}

// ============ 标记已读 ============
async function handleRead(request, env) {
  try {
    const { id } = await request.json();
    const raw = await env.MESSAGES.get(`msg:${id}`);
    if (!raw) return json({ error: '信件不存在' }, 404);
    const msg = JSON.parse(raw);
    msg.status = 'read';
    msg.readAt = Date.now();
    await env.MESSAGES.put(`msg:${id}`, JSON.stringify(msg));
    return json({ ok: true });
  } catch (e) {
    return json({ error: '操作失败' }, 500);
  }
}

// ============ 召回 ============
async function handleRecall(request, env) {
  try {
    const { id } = await request.json();
    const raw = await env.MESSAGES.get(`msg:${id}`);
    if (!raw) return json({ error: '信件不存在' }, 404);
    const msg = JSON.parse(raw);
    if (msg.status !== 'flying') return json({ error: '信使已抵达，无法召回' }, 400);
    msg.status = 'recalled';
    await env.MESSAGES.put(`msg:${id}`, JSON.stringify(msg));
    return json({ ok: true });
  } catch (e) {
    return json({ error: '操作失败' }, 500);
  }
}

// ============ 兑换码（后端校验） ============
async function handleRedeem(request, env) {
  try {
    const { code } = await request.json();
    if (!code) return json({ error: '请输入兑换码' }, 400);

    const codeKey = `code:${code.toUpperCase()}`;
    const codeData = await env.CODES.get(codeKey);
    if (!codeData) return json({ error: '兑换码无效' }, 400);

    const info = JSON.parse(codeData);
    if (info.used >= (info.maxUse || 999)) return json({ error: '兑换码已用完' }, 400);

    // 增加使用次数
    info.used = (info.used || 0) + 1;
    await env.CODES.put(codeKey, JSON.stringify(info));

    return json({ ok: true, reward: info.reward }); // reward: 'all' 或 具体动物id
  } catch (e) {
    return json({ error: '兑换失败' }, 500);
  }
}

// ============ Owner 登录（后端校验密码） ============
async function handleOwnerLogin(request, env) {
  try {
    const { password } = await request.json();
    if (!password) return json({ error: '请输入密码' }, 400);

    if (password !== env.OWNER_PASSWORD) {
      return json({ error: '密码错误' }, 401);
    }

    // 生成 JWT（2小时有效）
    const payload = {
      role: 'owner',
      iat: Date.now(),
      exp: Date.now() + 2 * 3600000,
    };
    const token = btoa(JSON.stringify(payload)) + '.' + await sign(payload, env.OWNER_SECRET_KEY);

    return json({ ok: true, token });
  } catch (e) {
    return json({ error: '登录失败' }, 500);
  }
}

// ============ Owner 查看全部信件 ============
async function handleOwnerMessages(request, env, url) {
  // 无需 token，与 AI 聊天记录、圣诞树照片一致

  // 可选筛选
  const filterBox = url.searchParams.get('box');
  const filterStatus = url.searchParams.get('status');

  // 列出所有消息
  const listRes = await env.MESSAGES.list({ prefix: 'msg:' });
  const messages = [];
  for (const key of listRes.keys) {
    const raw = await env.MESSAGES.get(key.name);
    if (!raw) continue;
    let msg = JSON.parse(raw);
    msg = await computeStatus(msg, env);
    // 筛选
    if (filterBox && msg.from !== filterBox && msg.to !== filterBox) continue;
    if (filterStatus && msg.status !== filterStatus) continue;
    // owner 可见所有信息：内容、发件人定位、收件人定位、发送时间
    messages.push({
      id: msg.id,
      from: msg.from,
      to: msg.to,
      content: msg.content,
      fromGPS: msg.fromGPS,
      toGPS: msg.toGPS,
      animal: msg.animal,
      petName: msg.petName,
      status: msg.status,
      deathReason: msg.deathReason,
      createdAt: toBJTime(msg.createdAt),
      deliverAt: toBJTime(msg.deliverAt),
      readAt: msg.readAt ? toBJTime(msg.readAt) : null,
    });
  }

  messages.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return json({ messages, total: messages.length });
}

// ============ 删除收件（仅删除收件人视图，发件人仍可见） ============
async function handleDeleteInbox(request, env) {
  try {
    const { id, box } = await request.json();
    if (!id || !box) return json({ error: '参数缺失' }, 400);
    const raw = await env.MESSAGES.get(`msg:${id}`);
    if (!raw) return json({ ok: true });
    const msg = JSON.parse(raw);
    if (msg.to === box) {
      msg.inboxDeletedBy = box;
      await env.MESSAGES.put(`msg:${id}`, JSON.stringify(msg));
    }
    return json({ ok: true });
  } catch (e) {
    return json({ error: '删除失败' }, 500);
  }
}

// ============ 删除发件（仅删除发件人视图，收件人仍可见） ============
async function handleDeleteSent(request, env) {
  try {
    const { id, from } = await request.json();
    if (!id || !from) return json({ error: '参数缺失' }, 400);
    const raw = await env.MESSAGES.get(`msg:${id}`);
    if (!raw) return json({ ok: true });
    const msg = JSON.parse(raw);
    if (msg.from === from) {
      msg.sentDeletedBy = from;
      await env.MESSAGES.put(`msg:${id}`, JSON.stringify(msg));
    }
    return json({ ok: true });
  } catch (e) {
    return json({ error: '删除失败' }, 500);
  }
}

// ============ Owner 批量删除信件（真正删除，不可恢复） ============
async function handleOwnerBatchDelete(request, env) {
  try {
    const { ids } = await request.json();
    if (!Array.isArray(ids) || !ids.length) return json({ error: '参数缺失' }, 400);
    let deleted = 0;
    for (const id of ids) {
      if (!id) continue;
      await env.MESSAGES.delete(`msg:${id}`);
      deleted++;
    }
    return json({ ok: true, deleted });
  } catch (e) {
    return json({ error: '删除失败' }, 500);
  }
}

// ============ 置顶/取消置顶 ============
async function handlePin(request, env) {
  try {
    const { id, box, side, pinned } = await request.json();
    if (!id || !box) return json({ error: '参数缺失' }, 400);
    const raw = await env.MESSAGES.get(`msg:${id}`);
    if (!raw) return json({ ok: true });
    const msg = JSON.parse(raw);
    // side: inbox / sent，对应不同方的置顶标记
    const pinField = side === 'sent' ? 'pinnedBySender' : 'pinnedByReceiver';
    msg[pinField] = !!pinned;
    await env.MESSAGES.put(`msg:${id}`, JSON.stringify(msg));
    return json({ ok: true });
  } catch (e) {
    return json({ error: '操作失败' }, 500);
  }
}

// ============ 信箱迁移：飞行中信件转移到新信箱 ============
async function handleMigrate(request, env) {
  try {
    const { oldBox, newBox } = await request.json();
    if (!oldBox || !newBox) return json({ error: '参数缺失' }, 400);
    let migrated = 0;
    // 迁移收件箱飞行中信件
    const inboxList = await env.MESSAGES.list({ prefix: `inbox:${oldBox}:` });
    for (const key of inboxList.keys) {
      const id = key.name.split(':')[2];
      const raw = await env.MESSAGES.get(`msg:${id}`);
      if (!raw) continue;
      const msg = JSON.parse(raw);
      if (msg.status === 'flying' && msg.to === oldBox) {
        msg.to = newBox;
        await env.MESSAGES.put(`msg:${id}`, JSON.stringify(msg));
        // 删旧索引，加新索引
        await env.MESSAGES.delete(`inbox:${oldBox}:${id}`);
        await env.MESSAGES.put(`inbox:${newBox}:${id}`, '1');
        migrated++;
      }
    }
    // 迁移发件箱飞行中信件
    const sentList = await env.MESSAGES.list({ prefix: `sent:${oldBox}:` });
    for (const key of sentList.keys) {
      const id = key.name.split(':')[2];
      const raw = await env.MESSAGES.get(`msg:${id}`);
      if (!raw) continue;
      const msg = JSON.parse(raw);
      if (msg.status === 'flying' && msg.from === oldBox) {
        msg.from = newBox;
        await env.MESSAGES.put(`msg:${id}`, JSON.stringify(msg));
        await env.MESSAGES.delete(`sent:${oldBox}:${id}`);
        await env.MESSAGES.put(`sent:${newBox}:${id}`, '1');
      }
    }
    return json({ ok: true, migrated });
  } catch (e) {
    return json({ error: '迁移失败' }, 500);
  }
}

// ============ 信箱取名 ============
async function handleGetName(request, env, url) {
  const box = (url.searchParams.get('box') || '').toUpperCase();
  if (!box || !/^[A-HJ-NP-Z2-9]{6}$/.test(box)) return json({ error: '信箱号无效' }, 400);
  const raw = await env.MESSAGES.get(`name:${box}`);
  return json({ box, name: raw || '' });
}

async function handleSetName(request, env) {
  try {
    const { box, name } = await request.json();
    const b = (box || '').toUpperCase();
    if (!b || !/^[A-HJ-NP-Z2-9]{6}$/.test(b)) return json({ error: '信箱号无效' }, 400);
    const n = (name || '').trim().slice(0, 8);
    if (!n) {
      await env.MESSAGES.delete(`name:${b}`);
      return json({ ok: true, name: '' });
    }
    await env.MESSAGES.put(`name:${b}`, n);
    return json({ ok: true, name: n });
  } catch (e) {
    return json({ error: '保存失败' }, 500);
  }
}

/**
 * ============ 初始化兑换码 ============
 * 部署后手动执行一次（通过 wrangler kv:key put 或 API）：
 *
 *   wrangler kv:key put --binding=CODES "code:WZWWLJ" '{"reward":"all","used":0,"maxUse":999}'
 *
 * 这会在 CODES KV 中创建兑换码 WZWWLJ，奖励为全部动物。
 * 可创建更多兑换码：
 *   wrangler kv:key put --binding=CODES "code:BLUE" '{"reward":"blue","used":0,"maxUse":10}'
 *   wrangler kv:key put --binding=CODES "code:GOOSE" '{"reward":"goose","used":0,"maxUse":50}'
 */
