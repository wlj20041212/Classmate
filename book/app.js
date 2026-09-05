/* ============================================================
   王氏春秋 · 交互引擎
   自动分页（写满换页）+ 古文/白话AI互译（后台预译）+ 画像 + 返回主站
   页数取古文/白话两者最大值，切换语言页码不变。
   ============================================================ */
(function () {
  'use strict';

  const cnNums = ['零','一','二','三','四','五','六','七','八','九','十','十一','十二','十三','十四','十五','十六','十七','十八','十九','二十'];
  const cnIdx = { 一:1, 二:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9, 十:10 };

  /* ---------- 乐江AI 配置（与诗稿页同源，后台静默调用） ---------- */
  const AI_URL   = 'https://api.agnes-ai.cn/v1/chat/completions';
  const AI_KEY   = 'sk-coiOt3YttnpJakJOLvsAhnt82ttTK8qq0TDOQaBwN38MULHj';
  const AI_MODEL = 'agnes-2.5-flash';
  const AI_SYSTEM = '你是一位精通文言文与白话文对译的学者，译文准确流畅。';

  /* ---------- 章节数据初始化 ---------- */
  BOOK.chapters.forEach(function (ch) {
    ch.lang = 'wen';        // 默认古文；点「白话」译为白话，再点「文言」还原
    ch.pagesWen = null;
    ch.pagesBai = null;
    ch.textBai = null;
    ch.heights = null;
    ch.translating = false;
  });

  /* ---------- DOM ---------- */
  const $ = function (s) { return document.querySelector(s); };
  const spreadEl = $('#spread');
  const halfL = $('#halfLeft');
  const halfR = $('#halfRight');
  const bookEl = $('#book');
  const coverShell = $('#coverShell');
  const coverBook = $('#coverBook');
  const hintTip = $('#hintTip');
  const btnPrev = $('#btnPrev');
  const btnNext = $('#btnNext');
  const btnBack = $('#btnBack');

  let curLeft = 0, curRight = 1;
  let busy = false;
  let opened = false;

  /* ---------- 页面流 ---------- */
  let chStart = [];
  let pageList = [{ kind: 'front' }, { kind: 'toc' }];
  let colophonIdx = 2;
  let PAGE_LEN = 3;
  let LAST = 2;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(pointer: fine)').matches;

  /* ---------- 小工具 ---------- */
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function cn(n) { return cnNums[n] || String(n); }
  function toParas(textOrArr) {
    const arr = Array.isArray(textOrArr) ? textOrArr : String(textOrArr).split(/\n+/);
    return arr.map(function (t) {
      t = String(t).trim();
      if (!t) return null;
      return { text: t, judge: /^王生曰/.test(t), cont: false };
    }).filter(Boolean);
  }
  function paras(arr) {
    return toParas(arr).map(function (p) { return '<p>' + esc(p.text) + '</p>'; }).join('');
  }

  /* ---------- 段落渲染（含王生曰样式） ---------- */
  function paraHtml(p) {
    if (p.judge) {
      const mark = p.cont ? '' : '<span class="ss-mark">王生曰：</span>';
      const txt = p.cont ? p.text : p.text.replace(/^王生曰[：:]\s*/, '');
      return '<div class="shisheng">' + mark + esc(txt) + '</div>';
    }
    return '<p>' + esc(p.text) + '</p>';
  }

  /* ============================================================
     自动分页引擎：离屏测量，写满一页再换下一页
     ============================================================ */
  let mBox = null;
  function measurer() {
    if (!mBox) {
      mBox = document.createElement('div');
      mBox.className = 'textbody';
      mBox.style.cssText = 'position:fixed;left:-99999px;top:0;visibility:hidden;pointer-events:none;';
      document.body.appendChild(mBox);
    }
    return mBox;
  }
  function measureParas(list) {
    const m = measurer();
    m.innerHTML = list.map(paraHtml).join('');
    return m.scrollHeight;
  }

  // 离屏探针：模拟半个书页，量出正文可用高度
  function probe(html) {
    const d = document.createElement('div');
    d.className = 'half right';
    d.style.cssText = 'position:fixed;left:-99999px;top:0;visibility:hidden;pointer-events:none;'
      + 'width:' + halfR.clientWidth + 'px;height:' + halfR.clientHeight + 'px;';
    d.innerHTML = html;
    document.body.appendChild(d);
    return d;
  }

  function computeHeights(ch) {
    // 正文页探针（页眉 + 空正文 + 页码）
    const p1 = probe('<div class="paper"><div class="rule"></div>' + headerHtml(ch, ch.vol)
      + '<div class="textbody"></div>' + pageNumHtml(3) + '</div>');
    const tb = p1.querySelector('.textbody');
    const bodyH = tb.clientHeight;
    const w = tb.clientWidth;
    // 关键：测量器必须继承 .paper 的实际字号与行高，否则分页严重失准
    const cs = getComputedStyle(p1.querySelector('.paper'));
    const m = measurer();
    m.style.width = w + 'px';
    m.style.fontSize = cs.fontSize;
    m.style.lineHeight = cs.lineHeight;
    p1.parentNode.removeChild(p1);
    // 标题页探针（标题 + 画像 + 空正文）
    const p2 = probe(titlePageHtml(ch, 0, 0, true));
    const tH = p2.querySelector('.textbody').clientHeight;
    p2.parentNode.removeChild(p2);
    return [Math.max(tH, 60), Math.max(bodyH, 60)];
  }

  // 分页：paras 段落数组；heights=[标题页正文高, 正文页高]
  function paginate(parasIn, heights) {
    const src = parasIn.map(function (p) { return { text: p.text, judge: p.judge, cont: p.cont }; });
    const pages = [];
    let hi = 0;
    const H = function () { return heights[Math.min(hi, heights.length - 1)]; };
    let cur = [];
    let i = 0, guard = 0;
    while (i < src.length && guard++ < 400) {
      const p = src[i];
      cur.push(p);
      if (measureParas(cur) <= H()) { i++; continue; }
      cur.pop();
      if (cur.length) {
        // 本页已满：先收页，同段下页再试
        pages.push(cur);
        cur = []; hi++;
        continue;
      }
      // 单段超一页：二分找换行点切分
      let lo = 2, hiB = p.text.length, best = 2;
      while (lo <= hiB) {
        const mid = (lo + hiB) >> 1;
        cur = [{ text: p.text.slice(0, mid), judge: p.judge, cont: p.cont }];
        if (measureParas(cur) <= H()) { best = mid; lo = mid + 1; }
        else { hiB = mid - 1; }
      }
      pages.push([{ text: p.text.slice(0, best), judge: p.judge, cont: p.cont }]);
      src[i] = { text: p.text.slice(best), judge: p.judge, cont: true };
      cur = []; hi++;
    }
    if (cur.length) pages.push(cur);
    return pages;
  }

  /* ---------- 重建页面流（页数 = 古文/白话最大值；补齐整跨页） ---------- */
  function rebuildPages(keepPos) {
    let mark = null;
    if (keepPos) {
      const p = pageList[curLeft];
      if (p) mark = { kind: p.kind, ch: p.ch, pi: p.pi };
    }
    const pl = [{ kind: 'front' }, { kind: 'toc' }];
    chStart = [];
    BOOK.chapters.forEach(function (ch, ci) {
      chStart.push(pl.length);
      pl.push({ kind: 'title', ch: ci });
      const n = Math.max(ch.pagesWen ? ch.pagesWen.length : 1, ch.pagesBai ? ch.pagesBai.length : 1);
      for (let k = 1; k < n; k++) pl.push({ kind: 'body', ch: ci, pi: k });
    });
    colophonIdx = pl.length;
    pl.push({ kind: 'colophon' });
    if (pl.length % 2 === 1) pl.push({ kind: 'blank' }); // 补一张空白页，保证整跨页成对
    pageList = pl;
    PAGE_LEN = pl.length;
    LAST = PAGE_LEN - 1;
    if (keepPos && mark) {
      let target = -1;
      for (let k = 0; k < pl.length; k++) {
        const q = pl[k];
        if (q.kind === mark.kind && q.ch === mark.ch && q.pi === mark.pi) { target = k; break; }
      }
      if (target > 0) {
        const tl = target - (target % 2); // 对齐到跨页左页
        curLeft = tl; curRight = Math.min(tl + 1, LAST);
      }
    }
    // 规范到合法跨页（左页必为偶数索引）
    curLeft = Math.min(curLeft - (curLeft % 2), Math.max(LAST - 1, 0));
    curRight = Math.min(curLeft + 1, LAST);
  }

  /* ============================================================
     乐江AI：古文 → 白话（后台预译 + localStorage 缓存）
     ============================================================ */
  function hashStr(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  function cacheKey(ch) { return 'book_bai_v3_' + hashStr(ch.textWen.join('|') + (ch.eraNote || '')); }

  function buildPrompt(ch) {
    return '请把下面这篇文言文列传翻译成现代白话文。要求：\n'
      + '一、只输出白话译文，不要任何解释、标题或原文；\n'
      + '二、按原文分段，段落间用一个换行分隔；\n'
      + '三、“王生曰：”开头的评语段也译成白话，并保留“王生曰：”开头；\n'
      + '四、译文必须使用简体中文（现代汉语白话文），严禁输出英文、拼音或夹杂外语；\n'
      + '五、纪年换算：干支或私撰年号纪年须换算为公元年份，并以「共和国X年（公元YYYY年）」格式括注。中华人民共和国以一九四九年十月一日成立，周年自该日算起：事件在当年十月一日及以后的，周年=该年份-1949；在十月一日之前的，周年=该年份-1950。例如2005年2月在国庆之前，应写作「共和国五十五年（公元2005年）」；2005年10月1日之后才写作「共和国五十六年（公元2005年）」。严禁出现「共和国前XX年」这类公元前式表述，严禁把年份算错；\n'
      + '六、译文通顺自然，符合现代汉语习惯。\n'
      + (ch.eraNote ? '\n纪年参照（务必遵守）：' + ch.eraNote + '\n' : '')
      + '\n' + ch.textWen.join('\n');
  }

  async function translateChapter(ch) {
    if (ch.textBai) return ch.textBai;
    let cached = null;
    try { cached = localStorage.getItem(cacheKey(ch)); } catch (e) {}
    if (cached) { ch.textBai = cached; return cached; }
    ch.translating = true;
    paintView();
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, 45000);
    try {
      const res = await fetch(AI_URL, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        signal: controller.signal,
        headers: {
          'Authorization': 'Bearer ' + AI_KEY,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          model: AI_MODEL,
          messages: [
            { role: 'system', content: AI_SYSTEM },
            { role: 'user', content: buildPrompt(ch) }
          ],
          temperature: 0.7,
          stream: false
        })
      });
      if (!res.ok) throw new Error('busy');
      const data = await res.json();
      let reply = ((data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || data.response || '').trim();
      if (!reply) throw new Error('empty');
      // 清理常见 markdown 残留符号
      reply = reply.replace(/^#{1,6}\s*/gm, '').replace(/\*\*/g, '').replace(/^\s*[-*]\s+/gm, '').replace(/^「|」$/g, '');
      ch.textBai = reply;
      try { localStorage.setItem(cacheKey(ch), reply); } catch (e) {}
      return reply;
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timer);
      ch.translating = false;
    }
  }

  // 后台预译：打开页面即静默翻译，用户点击时直接出结果
  function pretranslate(ch) {
    if (ch.textBai) { ensureBaiPages(ch); return; }
    let cached = null;
    try { cached = localStorage.getItem(cacheKey(ch)); } catch (e) {}
    if (cached) {
      ch.textBai = cached;
      ensureBaiPages(ch);
      return;
    }
    translateChapter(ch).then(function (r) {
      if (r) ensureBaiPages(ch);
    });
  }
  function ensureBaiPages(ch) {
    if (!ch.textBai || !ch.heights) return;
    ch.pagesBai = paginate(toParas(ch.textBai), ch.heights);
    rebuildPages(true);
    paintView();
    updateNav();
  }

  /* ---------- 语言切换 ---------- */
  async function toggleLang(ci) {
    if (busy) return;
    const ch = BOOK.chapters[ci];
    if (ch.lang === 'wen') {
      if (!ch.textBai || !ch.pagesBai) {
        const r = await translateChapter(ch);
        if (!r) {
          paintView();
          hintTip.textContent = '译事不谐，请稍后再试';
          setTimeout(function () { updateHint(); }, 2200);
          return;
        }
        ch.pagesBai = paginate(toParas(r), ch.heights);
        rebuildPages(true);
      }
      ch.lang = 'bai';
    } else {
      ch.lang = 'wen';
    }
    paintView();
  }

  /* ============================================================
     渲染
     ============================================================ */
  function langOf(ci) { return BOOK.chapters[ci].lang; }

  function headerHtml(ch, midTxt) {
    if (!ch) return '';
    return '<div class="pagehead">' +
      '<span class="col-left">王氏春秋</span>' +
      '<span class="mid">' + esc(midTxt || '') + '</span>' +
      '<span class="col-right">' + esc(ch.title) + '</span>' +
      '</div>';
  }
  function pageNumHtml(idx, extra) {
    if (extra) return '<div class="pagenum">' + esc(extra) + '</div>';
    if (idx === 0) return '<div class="pagenum">卷首</div>';
    if (idx === 1) return '<div class="pagenum">目录</div>';
    if (idx === colophonIdx) return '<div class="pagenum">卷末</div>';
    return '<div class="pagenum">' + cn(idx + 1) + '</div>';
  }

  function langBtnHtml(ch, ci) {
    if (ch.translating) {
      return '<button class="ai-btn sq busy" disabled>译中…</button>';
    }
    if (ch.lang === 'wen') {
      return '<button class="ai-btn sq" data-lang="wen" data-ch="' + ci + '" aria-label="译为白话">白话</button>';
    }
    return '<button class="ai-btn sq on-wen" data-lang="bai" data-ch="' + ci + '" aria-label="还原文言">文言</button>';
  }

  function pageBodyHtml(ch, pi) {
    const pages = (ch.lang === 'wen' ? ch.pagesWen : ch.pagesBai) || [];
    if (pi < pages.length) return pages[pi].map(paraHtml).join('');
    // 短的一方留余白页（保证两语页数一致）
    return '<div class="blank-page">余 白</div>';
  }

  function titlePageHtml(ch, ci, idx, probeMode) {
    return '<div class="paper" data-idx="' + idx + '">' +
      '<div class="rule"></div>' +
      headerHtml(ch, ch.vol) +
      '<div class="title-flex">' +
        '<div class="tf-main">' +
          '<div class="title-line">' +
            '<span class="chapter-title">' + esc(ch.title) + '</span>' +
            (probeMode ? '<button class="ai-btn sq">白话</button>' : langBtnHtml(ch, ci)) +
          '</div>' +
          '<div class="chapter-meta">' + esc(ch.name) + ' · ' + esc(ch.place) + '人' +
            (ch.no ? '　·　篇目 ' + esc(ch.no) : '') + '</div>' +
        '</div>' +
        (ch.portrait ? '<div class="tf-portrait"><img src="' + esc(ch.portrait) + '" alt=""></div>' : '') +
      '</div>' +
      '<div class="sep-orn"></div>' +
      '<div class="textbody">' + (probeMode ? '' : pageBodyHtml(ch, 0)) + '</div>' +
      pageNumHtml(idx) +
    '</div>';
  }

  function renderHalf(idx, isLeft) {
    const p = pageList[idx];
    if (!p) return '';
    if (p.kind === 'blank') return '<div class="paper"><div class="rule"></div></div>';
    if (p.kind === 'front') return renderFront(idx);
    if (p.kind === 'toc') return renderToc(idx);
    if (p.kind === 'colophon') return renderColophon(idx);
    const ch = BOOK.chapters[p.ch];
    if (p.kind === 'title') return titlePageHtml(ch, p.ch, idx, false);
    return '<div class="paper" data-idx="' + idx + '">' +
      '<div class="rule"></div>' +
      headerHtml(ch, ch.vol) +
      '<div class="textbody">' + pageBodyHtml(ch, p.pi) + '</div>' +
      pageNumHtml(idx) +
    '</div>';
  }

  function renderFront(idx) {
    return '<div class="paper" data-idx="' + idx + '">' +
      '<div class="rule"></div>' +
      '<div class="front-wrap">' +
        '<div class="intro-seal">陇西<br>王氏</div>' +
        '<div class="front-title">王氏春秋</div>' +
        '<div class="front-sub">仿太史公列传体例 · 录己身与平生交游事略</div>' +
        '<div class="textbody">' + paras(FRONT) + '</div>' +
        '<div class="front-note">' + FRONT_NOTE + '</div>' +
        '<div class="front-note self-note">' + esc(FRONT_SELFNOTE) + '</div>' +
      '</div>' +
      pageNumHtml(idx) +
    '</div>';
  }

  function renderToc(idx) {
    let items = '';
    BOOK.chapters.forEach(function (ch, ci) {
      items += '<div class="toc-item" data-go="' + chStart[ci] + '" tabindex="0" role="button">' +
        '<span class="toc-no">卷' + cn(ci + 1) + '</span>' +
        '<span class="toc-name">' + esc(ch.title) + '</span>' +
        '<span class="toc-dots"></span>' +
        '<span class="toc-page">' + esc(ch.no) + '</span>' +
        '</div>';
    });
    items += '<div class="toc-item" data-go="' + colophonIdx + '" tabindex="0" role="button">' +
      '<span class="toc-no">附</span>' +
      '<span class="toc-name">卷末赘语</span>' +
      '<span class="toc-dots"></span>' +
      '<span class="toc-page">末</span></div>';

    let chips = '';
    BOOK.chapters.forEach(function (ch) {
      chips += '<button class="suggest-chip" data-q="' + esc(ch.no) + '">' + esc(ch.no) + '</button>';
      const short = ch.name.charAt(0) === '王' ? ch.name.slice(1) : ch.name;
      if (short !== ch.no) chips += '<button class="suggest-chip" data-q="' + esc(short) + '">' + esc(short) + '</button>';
    });

    return '<div class="paper" data-idx="' + idx + '">' +
      '<div class="rule"></div>' +
      '<div class="toc-wrap">' +
        '<div class="toc-title">目 录</div>' +
        '<div class="search-box">' +
          '<span class="s-icon">索</span>' +
          '<input id="searchInput" type="text" placeholder="搜人名 · 页码 · 篇号  如：乐江 / 01" autocomplete="off">' +
          '<button class="search-btn" id="searchBtn">寻</button>' +
        '</div>' +
        '<div class="suggest-row">' + chips + '</div>' +
        '<div class="search-none" id="searchNone">未寻得此人此页，请换词再试</div>' +
        '<div class="toc-list">' + items + '</div>' +
        '<div class="toc-foot">点篇目即展 · 键搜可直达</div>' +
      '</div>' +
      pageNumHtml(idx) +
    '</div>';
  }

  function renderColophon(idx) {
    return '<div class="paper" data-idx="' + idx + '">' +
      '<div class="rule"></div>' +
      '<div class="front-wrap">' +
        '<div class="front-sub" style="margin-top:.4em">卷 末 赘 语</div>' +
        '<div class="textbody" style="margin-top:.2em">' + paras([COLOPHON]) + '</div>' +
        '<div class="front-note">右《王氏春秋》一卷终 · 观者自得</div>' +
      '</div>' +
      pageNumHtml(idx) +
    '</div>';
  }

  function paintView() {
    halfL.innerHTML = renderHalf(curLeft, true);
    halfR.innerHTML = renderHalf(curRight, false);
    bindEvents();
  }

  function bindEvents() {
    const find = function (root, sel) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
    find(spreadEl, '.toc-item').forEach(function (el) {
      const go = function () {
        if (busy) return;
        gotoPage(Number(el.getAttribute('data-go')));
      };
      el.addEventListener('click', go);
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    });
    find(spreadEl, '.suggest-chip').forEach(function (el) {
      el.addEventListener('click', function () {
        doSearch(el.getAttribute('data-q') || '');
      });
    });
    find(spreadEl, '.ai-btn.sq').forEach(function (el) {
      el.addEventListener('click', function () {
        toggleLang(Number(el.getAttribute('data-ch')));
      });
    });
    const searchBtn = $('#searchBtn'), searchInput = $('#searchInput');
    if (searchBtn) {
      const run = function () { doSearch((searchInput && searchInput.value) || ''); };
      searchBtn.addEventListener('click', run);
      if (searchInput) {
        searchInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); run(); } });
      }
    }
  }

  /* ---------- 检索 ---------- */
  function doSearch(q) {
    q = String(q || '').trim();
    const noneEl = $('#searchNone');
    if (noneEl) noneEl.classList.remove('show');
    if (!q) return;
    const target = resolveSearch(q);
    if (target >= 0) { gotoPage(target); return; }
    if (noneEl) noneEl.classList.add('show');
  }
  function resolveSearch(q) {
    if (/卷末|跋|后记|赘语/.test(q)) return colophonIdx;
    for (let i = 0; i < BOOK.chapters.length; i++) {
      const ch = BOOK.chapters[i];
      if (ch.name.indexOf(q) >= 0 || ch.title.indexOf(q) >= 0) return chStart[i];
    }
    const num = q.replace(/[^\d]/g, '');
    if (num) {
      const n = parseInt(num, 10);
      if (n >= 1 && n <= BOOK.chapters.length) return chStart[n - 1];
      if (n >= 1 && n <= PAGE_LEN) return n - 1;
    }
    if (cnIdx[q] !== undefined) {
      const n = cnIdx[q];
      if (n >= 1 && n <= PAGE_LEN) return n - 1;
    }
    return -1;
  }

  /* ---------- 跳转与翻页 ---------- */
  function gotoPage(P) {
    if (busy) return;
    if (P < 0) P = 0;
    if (P > LAST) P = LAST;
    const tl = P - (P % 2); // 对齐到跨页左页
    if (tl === curLeft) { flash(); return; }
    if (tl === curLeft + 2) { next(); return; }
    if (tl + 2 === curLeft) { prev(); return; }
    quickFlipTo(tl);
  }
  function flash() {
    const pp = halfR.querySelector('.paper');
    if (pp) {
      pp.style.transition = 'opacity .25s';
      pp.style.opacity = '.35';
      setTimeout(function () {
        pp.style.opacity = '1';
        setTimeout(function () { pp.style.opacity = ''; pp.style.transition = ''; }, 280);
      }, 60);
    }
  }
  function canNext() { return curRight < LAST; }
  function canPrev() { return curLeft > 0; }

  function makeSheet(dir, frontIdx, backIdx) {
    const sheet = document.createElement('div');
    sheet.className = 'sheet3d ' + (dir === 'next' ? 'nexting' : 'prevving');
    sheet.innerHTML = '<div class="face front">' + renderHalf(frontIdx) + '</div>' +
      '<div class="face back">' + renderHalf(backIdx) + '</div>' +
      '<div class="shadow-on"></div>';
    return sheet;
  }

  /* 整跨页翻页：一次前进/后退两页，如真实书本翻过一张纸 */
  function next() {
    if (busy || !canNext()) return;
    busy = true;
    const newLeft = curRight + 1;
    const newRight = Math.min(newLeft + 1, LAST);
    const sheet = makeSheet('next', curRight, newLeft); // 正面=旧右页，背面=新左页
    curLeft = newLeft; curRight = newRight;
    spreadEl.appendChild(sheet);
    paintView();
    let armed = false;
    const run = function () {
      if (armed) return;
      armed = true;
      sheet.classList.add('run');
      setTimeout(function () { finishFlip(sheet); }, 940);
    };
    requestAnimationFrame(function () { requestAnimationFrame(run); });
    setTimeout(run, 140); // 兜底：rAF 被节流时也能完成翻页
  }
  function prev() {
    if (busy || !canPrev()) return;
    busy = true;
    const newRight = curLeft - 1;
    const newLeft = newRight - 1;
    const sheet = makeSheet('prev', curLeft, newRight); // 正面=旧左页，背面=新右页
    curLeft = newLeft; curRight = newRight;
    spreadEl.appendChild(sheet);
    paintView();
    let armed = false;
    const run = function () {
      if (armed) return;
      armed = true;
      sheet.classList.add('run');
      setTimeout(function () { finishFlip(sheet); }, 940);
    };
    requestAnimationFrame(function () { requestAnimationFrame(run); });
    setTimeout(run, 140); // 兜底：rAF 被节流时也能完成翻页
  }
  function finishFlip(sheet) {
    if (sheet && sheet.parentNode) sheet.parentNode.removeChild(sheet);
    busy = false;
    updateNav();
    updateHint();
  }
  function quickFlipTo(tl) {
    busy = true;
    const forward = tl > curLeft;
    spreadEl.classList.add('quick-turn', forward ? 'qleft' : 'qright');
    setTimeout(function () {
      curLeft = tl; curRight = tl + 1 > LAST ? LAST : tl + 1;
      paintView();
      spreadEl.classList.remove(forward ? 'qleft' : 'qright');
      spreadEl.classList.add('qidle');
      setTimeout(function () {
        spreadEl.classList.remove('qidle', 'quick-turn');
        busy = false;
        updateNav(); updateHint();
      }, 90);
    }, 235);
  }

  /* ---------- 导航状态 ---------- */
  function updateNav() {
    btnPrev.disabled = !canPrev();
    btnNext.disabled = !canNext();
    const showPrev = canPrev() && finePointer;
    const showNext = canNext() && finePointer;
    btnPrev.classList.toggle('visible', showPrev);
    btnNext.classList.toggle('visible', showNext);
    btnPrev.style.pointerEvents = showPrev ? 'auto' : 'none';
    btnNext.style.pointerEvents = showNext ? 'auto' : 'none';
  }
  function updateHint() {
    if (opened && finePointer) {
      const side = curRight === LAST ? '已至卷末 · 按 ← 回览' : (canNext() && canPrev() ? '← 上页 · 下页 → 或 键搜人名' : (canNext() ? '右页未完 · → 续览' : ''));
      hintTip.textContent = side;
    }
  }

  /* ---------- 封面开关 ---------- */
  function openBook() {
    if (opened) return;
    opened = true;
    coverBook.classList.add('closing');
    setTimeout(function () {
      coverShell.classList.add('hidden');
      paintView();
      updateNav(); updateHint();
    }, reduceMotion ? 20 : 820);
  }
  function closeBook() {
    if (busy) return;
    curLeft = 0; curRight = 1;
    paintView();
    updateNav();
    coverShell.classList.remove('hidden');
    coverBook.classList.remove('closing');
    void coverBook.offsetWidth;
    opened = false;
    hintTip.textContent = finePointer ? '轻触封面，再启此卷' : '';
  }
  coverShell.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('.cover-shell')) openBook();
  });
  $('#btnCloseBook').addEventListener('click', function () { if (opened) closeBook(); });

  /* ---------- 返回：从主站进入 → 回主站；直接输网址 → 退出 ---------- */
  btnBack.addEventListener('click', function () {
    const ref = document.referrer || '';
    const host = location.hostname;
    const sameSite = ref && (ref.indexOf(host) >= 0);
    const fromBook = /\/book(\/|$|\?)/.test(ref);
    if (sameSite && !fromBook) {
      location.href = '../index.html';
    } else if (history.length > 1) {
      history.back();
    } else {
      location.href = '../index.html';
    }
  });

  /* ---------- 输入 ---------- */
  btnNext.addEventListener('click', function () { if (!busy && canNext()) next(); });
  btnPrev.addEventListener('click', function () { if (!busy && canPrev()) prev(); });

  document.addEventListener('keydown', function (e) {
    if (!opened || busy) return;
    if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
    else if (e.key === 'Escape') { closeBook(); }
  });

  let touchX = null, touchY = null, touchT = null;
  document.addEventListener('touchstart', function (e) {
    if (!opened) return;
    const t = e.changedTouches[0];
    touchX = t.clientX; touchY = t.clientY; touchT = Date.now();
  }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (!opened || busy || touchX === null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchX;
    const dy = t.clientY - touchY;
    const dt = Date.now() - touchT;
    touchX = touchY = null;
    if (dt > 900) return;
    if (Math.abs(dx) < 46 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    if (dx < 0) next(); else prev();
  }, { passive: true });

  /* ---------- 重排（窗口尺寸变化 / 字体加载完成） ---------- */
  let resizeTimer = null;
  function repaginateAll() {
    BOOK.chapters.forEach(function (ch) {
      ch.heights = computeHeights(ch);
      ch.pagesWen = paginate(toParas(ch.textWen), ch.heights);
      if (ch.textBai) ch.pagesBai = paginate(toParas(ch.textBai), ch.heights);
    });
    rebuildPages(true);
    paintView();
    updateNav(); updateHint();
  }
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(repaginateAll, 300);
  });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { setTimeout(repaginateAll, 50); });
  }

  /* ---------- 启动 ---------- */
  function boot() {
    paintView();
    updateNav();
    hintTip.textContent = '轻触封面，启阅此卷';
    coverShell.classList.remove('hidden');
    setTimeout(function () {
      BOOK.chapters.forEach(function (ch) {
        ch.heights = computeHeights(ch);
        ch.pagesWen = paginate(toParas(ch.textWen), ch.heights);
      });
      rebuildPages(false);
      paintView();
      updateNav();
      BOOK.chapters.forEach(pretranslate);
    }, 30);
  }
  boot();
})();
