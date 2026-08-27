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
 *
 * KV 存储结构（v2，用 get 替代 list，避免 list 额度限制）：
 *   msg:{id}          → 信件 JSON
 *   idx:inbox:{box}   → [id1, id2, ...]  收件箱信件ID数组
 *   idx:sent:{box}    → [id1, id2, ...]  发件箱信件ID数组
 *   idx:all           → [id1, id2, ...]  全部信件ID数组（owner用）
 *   name:{box}        → 信箱名号
 *   （兼容旧数据：inbox:{box}:{id} / sent:{box}:{id} 仍存在但不再 list）
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

// ============ 索引读写工具（用 get/set 替代 list） ============
// 读取索引数组
async function getIndex(env, key) {
  const raw = await env.MESSAGES.get(key);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch (e) { return []; }
}

// 写入索引数组
async function setIndex(env, key, arr) {
  await env.MESSAGES.put(key, JSON.stringify(arr));
}

// 往索引数组追加一个 id（去重）
async function indexPush(env, key, id) {
  const arr = await getIndex(env, key);
  if (!arr.includes(id)) {
    arr.push(id);
    await setIndex(env, key, arr);
  }
}

// 从索引数组移除一个 id
async function indexRemove(env, key, id) {
  const arr = await getIndex(env, key);
  const i = arr.indexOf(id);
  if (i >= 0) {
    arr.splice(i, 1);
    await setIndex(env, key, arr);
  }
}

// ============ 微信通知（微信测试号 + 模板消息，全部用 get/put/delete，不用 list） ============
// 部署后需设置 secrets：
//   wrangler secret put WX_APPID       （测试号 appID）
//   wrangler secret put WX_SECRET     （测试号 appsecret）
//   wrangler secret put WX_TOKEN      （接口配置信息的 Token，自定义字符串）
//   wrangler secret put WX_TEMPLATE_ID（测试号新增模板后得到的模板ID）
// 测试号页面「接口配置信息」填：
//   URL:   https://<worker域名>/wx/callback
//   Token: 与 WX_TOKEN 一致
// 用户流程：页面点开启通知 → 展示带信箱参数的二维码 → 微信扫码关注 → 自动绑定
const WX_API = 'https://api.weixin.qq.com';
const SITE_URL = 'https://wanglejiang.top/chat';
const SUPPORT_LINE = '有任何问题可发邮件：2252821948@qq.com（六小时回复一次）';
const WX_PEND_KEY = 'pend'; // 待送达通知队列（单key，cron用get读取，避免list限额）
const WX_TOKEN_CACHE = 'wx_access_token_cache'; // access_token 缓存（2小时有效）
// KV 新增键：
//   wxopenid:{box} → 用户 openid（扫码自动绑定，一个微信可绑多个信箱，迁移后旧号通知仍可达）
//   wxremark:{box} → {对方信箱:备注}（用户自己的备注，仅用于发给他本人的通知）

async function getWxOpenid(env, box) {
  if (!box) return '';
  try { return (await env.MESSAGES.get(`wxopenid:${box}`)) || ''; } catch (e) { return ''; }
}
async function getWxRemarks(env, box) {
  if (!box) return {};
  try { return JSON.parse((await env.MESSAGES.get(`wxremark:${box}`)) || '{}'); } catch (e) { return {}; }
}
// 联系人显示：有备注 → 备注（信箱号）；无备注 → 信箱号
function wxContactLabel(remarks, box) {
  const r = (remarks && remarks[box]) || '';
  return r ? r + '（' + box + '）' : box;
}
function fmtFly(h) {
  if (!h || h <= 0) return '片刻';
  if (h < 1) return Math.max(1, Math.round(h * 60)) + '分钟';
  if (h < 24) return (Math.round(h * 10) / 10) + '小时';
  return (Math.round((h / 24) * 10) / 10) + '天';
}

// access_token 管理：KV 缓存，过期前5分钟刷新
async function getWxAccessToken(env) {
  if (!env.WX_APPID || !env.WX_SECRET) return '';
  try {
    const cached = await env.MESSAGES.get(WX_TOKEN_CACHE);
    if (cached) {
      const { token, expires } = JSON.parse(cached);
      if (token && Date.now() < expires - 300000) return token;
    }
  } catch (e) {}
  try {
    const res = await fetch(`${WX_API}/cgi-bin/token?grant_type=client_credential&appid=${env.WX_APPID}&secret=${env.WX_SECRET}`);
    const data = await res.json();
    if (!data.access_token) return '';
    const expires = Date.now() + (data.expires_in || 7200) * 1000;
    await env.MESSAGES.put(WX_TOKEN_CACHE, JSON.stringify({ token: data.access_token, expires }));
    return data.access_token;
  } catch (e) { return ''; }
}

// 推送一条模板消息通知；返回 {ok, msg}
// 模板内容（测试号新增模板时填写）：
//   {{first.DATA}}\n{{content.DATA}}\n{{remark.DATA}}
async function wxPush(env, openid, title, content) {
  if (!openid || !env.WX_TEMPLATE_ID) return { ok: false, msg: '未配置' };
  const token = await getWxAccessToken(env);
  if (!token) return { ok: false, msg: 'token获取失败' };
  try {
    const res = await fetch(`${WX_API}/cgi-bin/message/template/send?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        touser: openid,
        template_id: env.WX_TEMPLATE_ID,
        url: SITE_URL,
        data: {
          first: { value: title, color: '#b3432b' },
          content: { value: content },
          remark: { value: SUPPORT_LINE, color: '#9a8a72' },
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    return data.errcode === 0 ? { ok: true } : { ok: false, msg: (data.errcode || '') + ' ' + (data.errmsg || '') };
  } catch (e) {
    return { ok: false, msg: '网络错误' };
  }
}

// 微信回调：GET 验证服务器（echostr）；POST 接收事件（扫码关注自动绑定）
async function handleWxCallback(request, env, url) {
  const method = request.method;
  const q = url.searchParams;
  if (method === 'GET') {
    // 签名验证：sha1(sort(token, timestamp, nonce)) === signature
    const signature = q.get('signature') || '', timestamp = q.get('timestamp') || '', nonce = q.get('nonce') || '';
    const echostr = q.get('echostr') || '';
    const arr = [env.WX_TOKEN || '', timestamp, nonce].sort();
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(arr.join('')));
    const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    return new Response(hash === signature ? echostr : '', { status: hash === signature ? 200 : 403 });
  }
  if (method === 'POST') {
    try {
      const xml = await request.text();
      const pick = (tag) => { const m = xml.match(new RegExp('<' + tag + '><!\\[CDATA\\[(.*?)\\]\\]></' + tag + '>')); return m ? m[1] : ''; };
      const eventType = pick('Event');
      const openid = pick('FromUserName');
      if (!openid) return new Response('success');
      if (eventType === 'subscribe' || eventType === 'SCAN') {
        // 扫码绑定：EventKey 为 qrscene_{信箱号}（首次关注）或 {信箱号}（已关注再扫）
        let key = pick('EventKey') || '';
        if (key.startsWith('qrscene_')) key = key.slice('qrscene_'.length);
        if (/^[A-HJ-NP-Z2-9]{6}$/.test(key)) {
          await env.MESSAGES.put(`wxopenid:${key}`, openid);
          await wxPush(env, openid, '飞鸽传书 · 绑定成功',
            '信箱 ' + key + ' 已开启微信通知\n新信在途、送达、信使殒命均会在此提醒你');
        }
      }
    } catch (e) {}
    return new Response('success');
  }
  return new Response('success');
}

// 生成带信箱参数的二维码：用户扫码关注即绑定
async function handleWxQrcode(request, env, url) {
  const b = (url.searchParams.get('box') || '').toUpperCase();
  if (!b || !/^[A-HJ-NP-Z2-9]{6}$/.test(b)) return json({ error: '信箱号无效' }, 400);
  const token = await getWxAccessToken(env);
  if (!token) return json({ error: '通知服务未配置或不可用' }, 500);
  try {
    const res = await fetch(`${WX_API}/cgi-bin/qrcode/create?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expire_seconds: 86400, // 二维码1天有效
        action_name: 'QR_STR_SCENE',
        action_info: { scene: { scene_str: b } },
      }),
    });
    const data = await res.json();
    if (!data.ticket) return json({ error: '获取二维码失败' }, 500);
    return json({ ok: true, qrcode: 'https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=' + encodeURIComponent(data.ticket) });
  } catch (e) {
    return json({ error: '获取二维码失败' }, 500);
  }
}

// 发信时：登记待送达队列 + 收件人在途提醒 + 发件人寄出回执
async function wxRegisterSend(env, msg) {
  // 登记待送达队列（单key，cron到点处理送达/殒命通知）
  try {
    let pend = [];
    try { pend = JSON.parse((await env.MESSAGES.get(WX_PEND_KEY)) || '[]'); } catch (e) {}
    if (!Array.isArray(pend)) pend = [];
    pend.push({
      id: msg.id, to: msg.to, from: msg.from,
      deliverAt: msg.deliverAt, willDie: msg.willDie,
      deathReason: msg.deathReason || '', flyHours: msg.flyHours, createdAt: msg.createdAt,
    });
    await env.MESSAGES.put(WX_PEND_KEY, JSON.stringify(pend));
  } catch (e) {}

  const flyStr = fmtFly(msg.flyHours);
  const sentTime = toBJTime(msg.createdAt);
  // 收件人：新信在途提醒
  const toUid = await getWxOpenid(env, msg.to);
  if (toUid) {
    const rmk = await getWxRemarks(env, msg.to);
    await wxPush(env, toUid, '飞鸽传书 · 新信在途',
      '一封来自「' + wxContactLabel(rmk, msg.from) + '」的信正在飞来\n' +
      '预计 ' + flyStr + ' 后抵达你的信箱\n寄出时间：' + sentTime);
  }
  // 发件人：寄出回执（正在运送中）
  const fromUid = await getWxOpenid(env, msg.from);
  if (fromUid) {
    const rmk = await getWxRemarks(env, msg.from);
    await wxPush(env, fromUid, '飞鸽传书 · 送达回执',
      '你寄往「' + wxContactLabel(rmk, msg.to) + '」的信已发送，正在运送中\n' +
      '寄出时间：' + sentTime + ' · 飞行时长：' + flyStr);
  }
}

// 送达/殒命通知：什么时候到/什么时候死，就什么时候提示
async function wxNotifyArrived(env, msg) {
  const flyStr = fmtFly(msg.flyHours);
  const sentTime = toBJTime(msg.createdAt);
  const toUid = await getWxOpenid(env, msg.to);
  const fromUid = await getWxOpenid(env, msg.from);
  if (msg.willDie) {
    // 殒命：双方都告知（收件人在发信时已收到在途提醒，不能让他空等）
    if (toUid) {
      const rmk = await getWxRemarks(env, msg.to);
      await wxPush(env, toUid, '飞鸽传书 · 信使殒命',
        '一封来自「' + wxContactLabel(rmk, msg.from) + '」的信，信使途中殒命，未能送达\n' +
        '死因：' + (msg.deathReason || '天有不测风云'));
    }
    if (fromUid) {
      const rmk = await getWxRemarks(env, msg.from);
      await wxPush(env, fromUid, '飞鸽传书 · 信使殒命',
        '你寄往「' + wxContactLabel(rmk, msg.to) + '」的信使途中殒命，信件未能送达\n' +
        '死因：' + (msg.deathReason || '天有不测风云') + '\n' +
        '寄出时间：' + sentTime + ' · 飞行时长：' + flyStr);
    }
    return;
  }
  // 送达：收件人提示信到了
  if (toUid) {
    const rmk = await getWxRemarks(env, msg.to);
    await wxPush(env, toUid, '飞鸽传书 · 新信件',
      '你的信箱收到一封来自「' + wxContactLabel(rmk, msg.from) + '」的信，纸短情长，速去查看\n' +
      '寄出时间：' + sentTime + ' · 飞行时长：' + flyStr);
  }
  // 送达：发件人回执
  if (fromUid) {
    const rmk = await getWxRemarks(env, msg.from);
    await wxPush(env, fromUid, '飞鸽传书 · 送达回执',
      '你寄往「' + wxContactLabel(rmk, msg.to) + '」的信已安全送达对方信箱\n' +
      '寄出时间：' + sentTime + ' · 飞行时长：' + flyStr);
  }
}

// cron 每分钟跑：到点的信 → 更新状态 + 推送送达/殒命通知
async function processWxPend(env) {
  let pend = [];
  try { pend = JSON.parse((await env.MESSAGES.get(WX_PEND_KEY)) || '[]'); } catch (e) {}
  if (!Array.isArray(pend) || !pend.length) return;
  const now = Date.now();
  const remain = [];
  for (const item of pend) {
    if (!item || !item.id) continue;
    if ((item.deliverAt || 0) > now) { remain.push(item); continue; }
    try {
      const raw = await env.MESSAGES.get('msg:' + item.id);
      if (!raw) continue; // 信件已不存在，丢弃
      const msg = JSON.parse(raw);
      if (msg.status !== 'flying') continue; // 已召回/已被查询处理，丢弃
      // 与 computeStatus 相同的状态判定
      msg.status = msg.willDie ? 'dead' : 'delivered';
      await env.MESSAGES.put('msg:' + item.id, JSON.stringify(msg));
      await wxNotifyArrived(env, msg);
    } catch (e) {
      remain.push(item); // 出错留下轮重试
    }
  }
  await env.MESSAGES.put(WX_PEND_KEY, JSON.stringify(remain));
}

// ============ 主入口 ============
export default {
  async scheduled(event, env, ctx) {
    // 每分钟：检查到点信件，推送送达/殒命通知
    ctx.waitUntil(processWxPend(env));
  },
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

    // 微信通知（测试号）
    if (path === '/wx/callback') return handleWxCallback(request, env, url);
    if (path === '/api/wx/qrcode' && method === 'GET') return handleWxQrcode(request, env, url);
    if (path === '/api/wx/unbind' && method === 'POST') return handleWxUnbind(request, env);
    if (path === '/api/wx/status' && method === 'GET') return handleWxStatus(request, env, url);
    if (path === '/api/wx/remarks' && method === 'POST') return handleWxRemarks(request, env);

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
    const { to, content, flyHours, fromGPS, animal, petName, willDie, deathReason, deathIcon } = body;
    const from = body.from || '';

    if (!to || !/^[A-HJ-NP-Z2-9]{6}$/.test(to)) return json({ error: '收件人信箱号无效' }, 400);
    if (to === from) return json({ error: '收件人不能是自己' }, 400);
    if (!content) return json({ error: '内容不能为空' }, 400);

    const now = Date.now();
    const hours = parseFloat(flyHours) || 24;
    const deliverAt = now + hours * 3600000;

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
      deathIcon: deathIcon || '',    // 殒命场景图标
      flyHours: hours,
      deliverAt,                 // 送达时间戳
      createdAt: now,            // 发送时间
      status: 'flying',          // 状态：flying/delivered/read/recalled/dead
      readAt: null,
    };

    // 存入 KV：信件本身 + 索引（用 get/set 替代 list）
    await env.MESSAGES.put(`msg:${msg.id}`, JSON.stringify(msg));
    await indexPush(env, `idx:inbox:${to}`, msg.id);
    await indexPush(env, `idx:sent:${from}`, msg.id);
    await indexPush(env, 'idx:all', msg.id);

    // 兼容旧数据格式（同时写旧 key，但不再 list 读取）
    await env.MESSAGES.put(`inbox:${to}:${msg.id}`, msg.id);
    await env.MESSAGES.put(`sent:${from}:${msg.id}`, msg.id);

    // 微信通知：登记待送达队列 + 收件人在途提醒 + 发件人寄出回执
    await wxRegisterSend(env, msg);

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

  // 直接 list 读取（实时性好，避免索引最终一致性问题）
  const idSet = new Set();
  try {
    const list = await env.MESSAGES.list({ prefix: `inbox:${box}:` });
    if (list && list.keys) {
      list.keys.forEach((k) => {
        const parts = k.name.split(':');
        if (parts.length >= 3) idSet.add(parts[2]);
      });
    }
  } catch (e) {}
  // 合并索引中的id（双保险）
  try {
    const idxIds = await getIndex(env, `idx:inbox:${box}`);
    idxIds.forEach((id) => idSet.add(id));
  } catch (e) {}
  const ids = Array.from(idSet);
  const messages = [];
  for (const id of ids) {
    try {
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
    } catch (e) {}
  }

  messages.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return json({ messages });
}

// ============ 我发的信 ============
async function handleSent(request, env, url) {
  const from = url.searchParams.get('from');
  if (!from) return json({ error: '缺少信箱号' }, 400);

  // 直接 list 读取（实时性好，避免索引最终一致性问题）
  const idSet = new Set();
  try {
    const list = await env.MESSAGES.list({ prefix: `sent:${from}:` });
    if (list && list.keys) {
      list.keys.forEach((k) => {
        const parts = k.name.split(':');
        if (parts.length >= 3) idSet.add(parts[2]);
      });
    }
  } catch (e) {}
  // 合并索引中的id（双保险）
  try {
    const idxIds = await getIndex(env, `idx:sent:${from}`);
    idxIds.forEach((id) => idSet.add(id));
  } catch (e) {}
  const ids = Array.from(idSet);
  const messages = [];
  for (const id of ids) {
    try {
      const raw = await env.MESSAGES.get(`msg:${id}`);
      if (!raw) continue;
      let msg = JSON.parse(raw);
      // 跳过已被发件人删除的
      if (msg.sentDeletedBy === from) continue;
      msg = await computeStatus(msg, env);
      // 映射置顶字段
      msg.pinned = !!msg.pinnedBySender;
      messages.push(msg);
    } catch (e) {}
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

  // 用 get 读取全局索引（替代 list）
  let ids = await getIndex(env, 'idx:all');
  // 兼容旧数据：若新索引为空，回退 list 旧 key 一次并迁移
  if (ids.length === 0) {
    const oldList = await env.MESSAGES.list({ prefix: 'msg:' });
    if (oldList.keys.length > 0) {
      ids = oldList.keys.map((k) => k.name.slice(4));
      await setIndex(env, 'idx:all', ids);
      // 同时补进各信箱索引
      for (const id of ids) {
        const raw = await env.MESSAGES.get(`msg:${id}`);
        if (raw) {
          const msg = JSON.parse(raw);
          if (msg.to) await indexPush(env, `idx:inbox:${msg.to}`, id);
          if (msg.from) await indexPush(env, `idx:sent:${msg.from}`, id);
        }
      }
    }
  }
  const messages = [];
  for (const id of ids) {
    const raw = await env.MESSAGES.get(`msg:${id}`);
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
      // owner删除只从 idx:all 索引移除（owner后台不再显示）
      // 不删除信件本身，不影响用户的收件箱/发件箱
      await indexRemove(env, 'idx:all', id);
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

    // list 读取旧收件箱 + 合并索引（双保险）
    const inboxSet = new Set();
    try {
      const inboxList = await env.MESSAGES.list({ prefix: `inbox:${oldBox}:` });
      if (inboxList && inboxList.keys) {
        inboxList.keys.forEach((k) => {
          const parts = k.name.split(':');
          if (parts.length >= 3) inboxSet.add(parts[2]);
        });
      }
    } catch (e) {}
    try {
      const inboxIdxIds = await getIndex(env, `idx:inbox:${oldBox}`);
      inboxIdxIds.forEach((id) => inboxSet.add(id));
    } catch (e) {}
    for (const id of Array.from(inboxSet)) {
      try {
        const raw = await env.MESSAGES.get(`msg:${id}`);
        if (!raw) continue;
        const msg = JSON.parse(raw);
        // 跳过自己发给自己的信件（漏洞：新信箱发给旧信箱后迁移）
        if (msg.status === 'flying' && msg.to === oldBox && msg.from !== newBox) {
          msg.to = newBox;
          await env.MESSAGES.put(`msg:${id}`, JSON.stringify(msg));
          await indexRemove(env, `idx:inbox:${oldBox}`, id);
          await indexPush(env, `idx:inbox:${newBox}`, id);
          await env.MESSAGES.delete(`inbox:${oldBox}:${id}`);
          await env.MESSAGES.put(`inbox:${newBox}:${id}`, id);
          migrated++;
        }
      } catch (e) {}
    }

    // list 读取旧发件箱 + 合并索引（双保险）
    const sentSet = new Set();
    try {
      const sentList = await env.MESSAGES.list({ prefix: `sent:${oldBox}:` });
      if (sentList && sentList.keys) {
        sentList.keys.forEach((k) => {
          const parts = k.name.split(':');
          if (parts.length >= 3) sentSet.add(parts[2]);
        });
      }
    } catch (e) {}
    try {
      const sentIdxIds = await getIndex(env, `idx:sent:${oldBox}`);
      sentIdxIds.forEach((id) => sentSet.add(id));
    } catch (e) {}
    for (const id of Array.from(sentSet)) {
      try {
        const raw = await env.MESSAGES.get(`msg:${id}`);
        if (!raw) continue;
        const msg = JSON.parse(raw);
        // 跳过自己发给自己的信件（漏洞：新信箱发给旧信箱后迁移）
        if (msg.status === 'flying' && msg.from === oldBox && msg.to !== newBox) {
          msg.from = newBox;
          await env.MESSAGES.put(`msg:${id}`, JSON.stringify(msg));
          await indexRemove(env, `idx:sent:${oldBox}`, id);
          await indexPush(env, `idx:sent:${newBox}`, id);
          await env.MESSAGES.delete(`sent:${oldBox}:${id}`);
          await env.MESSAGES.put(`sent:${newBox}:${id}`, id);
          migrated++;
        }
      } catch (e) {}
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

// ============ 微信通知：解绑 / 状态 / 备注同步（绑定走扫码回调） ============
async function handleWxUnbind(request, env) {
  try {
    const { box } = await request.json();
    const b = (box || '').toUpperCase();
    if (!b || !/^[A-HJ-NP-Z2-9]{6}$/.test(b)) return json({ error: '信箱号无效' }, 400);
    await env.MESSAGES.delete(`wxopenid:${b}`);
    // 备注（通知用）也一并清理
    await env.MESSAGES.delete(`wxremark:${b}`);
    return json({ ok: true });
  } catch (e) {
    return json({ error: '解绑失败' }, 500);
  }
}

async function handleWxStatus(request, env, url) {
  const b = (url.searchParams.get('box') || '').toUpperCase();
  if (!b || !/^[A-HJ-NP-Z2-9]{6}$/.test(b)) return json({ error: '信箱号无效' }, 400);
  const openid = await getWxOpenid(env, b);
  return json({ bound: !!openid });
}

async function handleWxRemarks(request, env) {
  try {
    const { box, remarks } = await request.json();
    const b = (box || '').toUpperCase();
    if (!b || !/^[A-HJ-NP-Z2-9]{6}$/.test(b)) return json({ error: '信箱号无效' }, 400);
    const clean = {};
    if (remarks && typeof remarks === 'object') {
      const keys = Object.keys(remarks).slice(0, 200);
      for (const k of keys) {
        if (/^[A-HJ-NP-Z2-9]{6}$/.test(k)) {
          const v = String(remarks[k] || '').trim().slice(0, 12);
          if (v) clean[k] = v;
        }
      }
    }
    // 空则删（关同步开关/清空时，服务端不残留）
    if (Object.keys(clean).length) await env.MESSAGES.put(`wxremark:${b}`, JSON.stringify(clean));
    else await env.MESSAGES.delete(`wxremark:${b}`);
    return json({ ok: true });
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
