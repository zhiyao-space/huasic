/* 画串工坊 · Artist String Lab —— 纯前端逻辑 */
'use strict';

/* ================= 工具 ================= */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const loadLS = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
const saveLS = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hide');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hide'), 1800);
}
async function copyText(txt) {
  try { await navigator.clipboard.writeText(txt); toast('已复制'); }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta);
    ta.select(); try { document.execCommand('copy'); toast('已复制'); } catch (e2) { toast('复制失败'); }
    ta.remove();
  }
}
function b64ToBlob(b64) {
  const s = String(b64).replace(/^data:image\/\w+;base64,/, '');
  const bin = atob(s); const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: 'image/png' });
}

/* ================= IndexedDB（画串录） ================= */
let _db;
function db() {
  return _db ||= new Promise((res, rej) => {
    const r = indexedDB.open('asl-records', 1);
    r.onupgradeneeded = e => e.target.result.createObjectStore('records', { keyPath: 'id' });
    r.onsuccess = e => res(e.target.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbPut(rec) { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('records', 'readwrite'); t.objectStore('records').put(rec); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
async function idbAll() { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('records', 'readonly'); const rq = t.objectStore('records').getAll(); rq.onsuccess = () => res(rq.result || []); rq.onerror = () => rej(rq.error); }); }
async function idbDel(id) { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('records', 'readwrite'); t.objectStore('records').delete(id); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
async function idbClear() { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('records', 'readwrite'); t.objectStore('records').clear(); t.oncomplete = res; t.onerror = () => rej(t.error); }); }

/* ================= 状态 ================= */
const S = {
  artists: [],
  custom: loadLS('asl_custom', []),        // 导入的自定义画师串
  filter: { q: '', cat: '', sort: 'hot' },
  sel: loadLS('asl_sel', []),              // [{t,w}]
  fmt: Object.assign({ tpl: 'artist:{tag}:{w}', dec: '1', omit: false, sortW: true, custom: '' }, loadLS('asl_fmt', {})),
  rnd: loadLS('asl_rnd', {}),
  settings: Object.assign({
    provider: 'openai', base: '', key: '', model: 'nai-diffusion-3',
    steps: 28, scale: 6, sampler: 'k_euler_ana', seed: '', autoSave: true, prefix: ''
  }, loadLS('asl_settings', {})),
  prompt: loadLS('asl_prompt', ''),
  negative: loadLS('asl_negative', ''),
  recUrls: new Map(),                      // blobURL 缓存
};

function mergeArtists() {
  const m = new Map();
  for (const a of (window.ARTIST_DATA || [])) m.set(a.t, { ...a });
  for (const c of S.custom) {
    const old = m.get(c.t);
    m.set(c.t, { t: c.t, n: c.n != null ? c.n : (old ? old.n : null), c: c.c || (old ? old.c : '其他风格'), d: c.d || (old ? old.d : '') });
  }
  S.artists = [...m.values()];
}

/* ================= 页面切换 ================= */
function go(page) {
  $$('.navbtn').forEach(b => b.classList.toggle('on', b.dataset.page === page));
  $$('.page').forEach(p => p.classList.toggle('on', p.id === 'page-' + page));
  if (page === 'records') renderRecords();
}
$('#navBtns').addEventListener('click', e => { const b = e.target.closest('.navbtn'); if (b) go(b.dataset.page); });

/* ================= 画师库 ================= */
const PAGE_SIZE = 60;
let libShown = PAGE_SIZE;

function filtered() {
  let arr = S.artists;
  const f = S.filter;
  if (f.cat) arr = arr.filter(a => a.c === f.cat);
  if (f.q) {
    const q = f.q.toLowerCase();
    arr = arr.filter(a => a.t.toLowerCase().includes(q) || (a.c || '').includes(q) || (a.d || '').toLowerCase().includes(q));
  }
  if (f.sort === 'hot') arr = [...arr].sort((x, y) => (y.n || 0) - (x.n || 0));
  else if (f.sort === 'az') arr = [...arr].sort((x, y) => x.t.localeCompare(y.t));
  else if (f.sort === 'rand') { for (let i = arr.length - 1; i > 0; i--) { const j = randInt(0, i); [arr[i], arr[j]] = [arr[j], arr[i]]; } }
  return arr;
}

function catCounts() {
  const m = new Map();
  for (const a of S.artists) m.set(a.c, (m.get(a.c) || 0) + 1);
  return m;
}

function renderChips() {
  const el = $('#libChips'); const m = catCounts();
  const cats = [...(window.ARTIST_CATS || [])].filter(c => m.get(c));
  el.innerHTML = `<button class="chip ${S.filter.cat === '' ? 'on' : ''}" data-c="">全部 <b>${S.artists.length}</b></button>` +
    cats.map(c => `<button class="chip ${S.filter.cat === c ? 'on' : ''}" data-c="${esc(c)}">${esc(c)} <b>${m.get(c)}</b></button>`).join('');
}
$('#libChips').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return;
  S.filter.cat = b.dataset.c; libShown = PAGE_SIZE; renderChips(); renderLibrary();
});

function renderLibrary() {
  const arr = filtered();
  const slice = arr.slice(0, libShown);
  $('#libGrid').innerHTML = slice.map(a => `
    <div class="acard">
      <div class="meta"><span class="badge">${esc(a.c)}</span><span class="hot">${a.n != null ? a.n + ' posts' : '自定义'}</span></div>
      <div class="tag">${esc(a.t)}</div>
      <div class="desc">${esc(a.d || '')}</div>
      <div class="foot">
        <span class="faint" style="font-size:11px">${inSel(a.t) ? '已加入' : ''}</span>
        <button class="mini" data-add="${esc(a.t)}">${inSel(a.t) ? '重新加入' : '+ 加入调串'}</button>
      </div>
    </div>`).join('') || '<div class="empty">没有匹配的画师串</div>';
  $('#libMore').style.display = arr.length > libShown ? '' : 'none';
  $('#libMore').textContent = `加载更多（${libShown}/${arr.length}）`;
}
$('#libGrid').addEventListener('click', e => {
  const b = e.target.closest('[data-add]'); if (!b) return;
  addSel(b.dataset.add, 1); toast('已加入调串台：' + b.dataset.add);
});
$('#libMore').addEventListener('click', () => { libShown += PAGE_SIZE; renderLibrary(); });
$('#libQ').addEventListener('input', e => { S.filter.q = e.target.value.trim(); libShown = PAGE_SIZE; renderLibrary(); });
$('#libCat').addEventListener('change', e => { S.filter.cat = e.target.value; libShown = PAGE_SIZE; renderChips(); renderLibrary(); });
$('#libSort').addEventListener('change', e => { S.filter.sort = e.target.value; libShown = PAGE_SIZE; renderLibrary(); });

/* ================= 已选（调串台左栏） ================= */
function inSel(t) { return S.sel.some(s => s.t === t); }
function addSel(t, w) { if (!inSel(t)) { S.sel.push({ t, w: w ?? 1 }); persistSel(); } renderMixer(); }
function persistSel() { saveLS('asl_sel', S.sel); updateNav(); }

$('#selClear').addEventListener('click', () => { S.sel = []; persistSel(); renderMixer(); });
$('#selShuffle').addEventListener('click', () => {
  for (let i = S.sel.length - 1; i > 0; i--) { const j = randInt(0, i); [S.sel[i], S.sel[j]] = [S.sel[j], S.sel[i]]; }
  persistSel(); renderMixer();
});
$('#selList').addEventListener('input', e => {
  const inp = e.target.closest('[data-w]'); if (!inp) return;
  const t = decodeURIComponent(inp.dataset.w); const item = S.sel.find(s => s.t === t);
  if (item) { item.w = Math.max(0.05, parseFloat(inp.value) || 1); persistSel(); renderPreview(); }
});
$('#selList').addEventListener('click', e => {
  const b = e.target.closest('[data-del]'); if (!b) return;
  const t = decodeURIComponent(b.dataset.del);
  S.sel = S.sel.filter(s => s.t !== t); persistSel(); renderMixer();
});

/* ================= 权重格式 ================= */
function fmtW(w) {
  const d = +S.fmt.dec || 1;
  let s = (+w).toFixed(d);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}
function buildStr(list) {
  const items = [...list];
  if (S.fmt.sortW) items.sort((a, b) => b.w - a.w);
  return items.map(({ t, w }) => {
    let tpl = S.fmt.tpl === '__custom__' ? (S.fmt.custom || '{tag}') : S.fmt.tpl;
    if (S.fmt.omit && Math.abs(w - 1) < 1e-9) tpl = tpl.replace(/:\s*\{w\}/g, '').replace(/\{w\}/g, '').replace(/[:.]$/, '');
    return tpl.replaceAll('{tag}', t).replaceAll('{w}', fmtW(w));
  }).join(', ');
}
function fullPrompt(str) {
  return [S.settings.prefix.trim(), str, S.prompt.trim()].filter(Boolean).join(', ');
}
function renderPreview() {
  const s = S.sel.length ? buildStr(S.sel) : '（在左侧加入画师串后显示）';
  $('#fmtPrev').textContent = s;
}
function bindFmt() {
  $('#fTpl').value = S.fmt.tpl;
  $('#fCustom').value = S.fmt.custom || '';
  $('#fCustom').classList.toggle('hide', S.fmt.tpl !== '__custom__');
  $('#fDec').value = S.fmt.dec; $('#fOmit').checked = !!S.fmt.omit; $('#fSortW').checked = !!S.fmt.sortW;
}
$('#fTpl').addEventListener('change', e => { S.fmt.tpl = e.target.value; $('#fCustom').classList.toggle('hide', e.target.value !== '__custom__'); saveLS('asl_fmt', S.fmt); renderPreview(); });
$('#fCustom').addEventListener('input', e => { S.fmt.custom = e.target.value; saveLS('asl_fmt', S.fmt); renderPreview(); });
$('#fDec').addEventListener('change', e => { S.fmt.dec = e.target.value; saveLS('asl_fmt', S.fmt); renderPreview(); });
$('#fOmit').addEventListener('change', e => { S.fmt.omit = e.target.checked; saveLS('asl_fmt', S.fmt); renderPreview(); });
$('#fSortW').addEventListener('change', e => { S.fmt.sortW = e.target.checked; saveLS('asl_fmt', S.fmt); renderPreview(); });

$('#copyStr').addEventListener('click', () => {
  if (!S.sel.length) return toast('请先加入画师串');
  copyText(buildStr(S.sel));
});
$('#copyFull').addEventListener('click', () => {
  if (!S.sel.length) return toast('请先加入画师串');
  copyText(fullPrompt(buildStr(S.sel)));
});

/* ================= 随机调和 ================= */
function bindRnd() {
  const r = S.rnd;
  $('#rTimes').value = r.times ?? 3; $('#rMin').value = r.min ?? 2; $('#rMax').value = r.max ?? 4;
  $('#rWmin').value = r.wmin ?? 0.6; $('#rWmax').value = r.wmax ?? 1.4;
  $('#rSrc').value = r.src || 'filter'; $('#rAuto').checked = !!r.auto;
  $('#rStyle').value = r.style || ''; $('#rKey').value = r.key || '';
  $('#randOut').innerHTML = '';
}
function saveRnd() {
  S.rnd = { times: +$('#rTimes').value, min: +$('#rMin').value, max: +$('#rMax').value,
    wmin: +$('#rWmin').value, wmax: +$('#rWmax').value, src: $('#rSrc').value,
    style: $('#rStyle').value, key: $('#rKey').value.trim(), auto: $('#rAuto').checked };
  saveLS('asl_rnd', S.rnd);
}
function randomPool() {
  const style = $('#rStyle').value, key = $('#rKey').value.trim().toLowerCase();
  let base;
  if (style || key) base = S.artists;   // 画风/关键词定向：全库匹配，优先于来源
  else if ($('#rSrc').value === 'sel') base = S.sel.map(s => S.artists.find(a => a.t === s.t) || { t: s.t, c: '', d: '' });
  else if ($('#rSrc').value === 'all') base = S.artists;
  else base = filtered();
  if (style) base = base.filter(a => a.c === style);
  if (key) base = base.filter(a =>
    a.t.toLowerCase().includes(key) || (a.c || '').toLowerCase().includes(key) || (a.d || '').toLowerCase().includes(key));
  return base;
}
$('#btnRandom').addEventListener('click', async () => {
  saveRnd();
  const pool = [...new Set(randomPool().map(a => a.t))];
  if (pool.length < 2) return toast('来源池太小：换个画风定向/关键词，或清空筛选');
  const n = Math.min(50, Math.max(1, S.rnd.times));
  const lo = Math.max(1, Math.min(S.rnd.min, S.rnd.max));
  const hi = Math.min(pool.length, Math.max(S.rnd.min, S.rnd.max));
  const wlo = Math.max(0.1, Math.min(S.rnd.wmin, S.rnd.wmax));
  const whi = Math.max(wlo + 0.05, S.rnd.wmax);
  const step = 1 / Math.pow(10, +S.fmt.dec || 1);
  const results = [];
  for (let i = 0; i < n; i++) {
    const k = randInt(lo, hi);
    const picked = [...pool].sort(() => Math.random() - .5).slice(0, k)
      .map(t => ({ t, w: Math.round(rand(wlo, whi) / step) * step }));
    results.push({ tags: picked, str: buildStr(picked) });
  }
  renderRand(results, { pool: pool.length, style: $('#rStyle').value, key: $('#rKey').value.trim() });
  if (S.rnd.auto) {
    const btn = $('#btnRandom'); btn.disabled = true;
    for (let i = 0; i < results.length; i++) {
      setRandItemStatus(i, '生成中…');
      try { await generateAndSave(fullPrompt(results[i].str), results[i].str); setRandItemStatus(i, '已生成并存入画串录'); }
      catch (err) { setRandItemStatus(i, '失败：' + err.message); }
    }
    btn.disabled = false;
  }
});
function catOf(t) { const a = S.artists.find(x => x.t === t); return (a && a.c) || ''; }
function renderRand(results, meta) {
  const tag = [];
  if (meta.style) tag.push('画风：' + meta.style);
  if (meta.key) tag.push('关键词：' + meta.key);
  $('#randOut').innerHTML = `<div class="rnum">来源池 ${meta.pool} 个画师串${tag.length ? ' · ' + esc(tag.join(' · ')) : ''}</div>` +
    results.map((r, i) => {
      const cats = [...new Set(r.tags.map(x => catOf(x.t)).filter(Boolean))].join(' + ');
      return `
    <div class="randitem" data-i="${i}">
      <div class="rnum">#${i + 1} · ${r.tags.length} 个画师串 · 权重 ${r.tags.map(x => fmtW(x.w)).join('/')}${cats ? ' · ' + esc(cats) : ''}</div>
      <pre class="codewrap">${esc(r.str)}</pre>
      <div class="rfoot">
        <button class="mini" data-rc="${i}">复制</button>
        <button class="mini" data-rsel="${i}">加入已选</button>
        <button class="mini" data-rgen="${i}">生成图片</button>
        <span class="status" data-rstatus="${i}"></span>
      </div>
    </div>`;
    }).join('');
  $('#randOut').dataset.results = JSON.stringify(results.map(r => ({ str: r.str, tags: r.tags })));
}
function getRand(i) { return JSON.parse($('#randOut').dataset.results)[i]; }
function setRandItemStatus(i, msg) { const el = $(`[data-rstatus="${i}"]`); if (el) el.textContent = msg; }
$('#randOut').addEventListener('click', async e => {
  const rc = e.target.closest('[data-rc]'), rs = e.target.closest('[data-rsel]'), rg = e.target.closest('[data-rgen]');
  if (rc) return copyText(getRand(+rc.dataset.rc).str);
  if (rs) { const tags = getRand(+rs.dataset.rsel).tags; S.sel = tags.map(x => ({ ...x })); persistSel(); renderMixer(); return toast('已替换为该组合'); }
  if (rg) {
    const i = +rg.dataset.rgen; const r = getRand(i);
    rg.disabled = true; setRandItemStatus(i, '生成中…');
    try { const rec = await generateAndSave(fullPrompt(r.str), r.str); setRandItemStatus(i, '完成'); setRandItemThumb(i, rec); }
    catch (err) { setRandItemStatus(i, '失败：' + err.message); }
    rg.disabled = false;
  }
});
function setRandItemThumb(i, rec) {
  if (!rec || !rec.img) return;
  const box = $(`.randitem[data-i="${i}"]`); if (!box) return;
  const img = document.createElement('img');
  img.src = rec.img instanceof Blob ? URL.createObjectURL(rec.img) : rec.img;
  img.onclick = () => openLightbox(img.src, getRand(i).str);
  box.appendChild(img);
}

/* ================= 生成图片 ================= */
function sizeWH() { const [w, h] = $('#inSize').value.split('x').map(Number); return { w, h }; }

async function postJSON(url, body, key, extraHeaders = {}) {
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  if (key) headers.Authorization = 'Bearer ' + key;
  let r;
  try { r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) }); }
  catch (e) { throw new Error('网络/CORS 失败：' + e.message + '（纯前端直连受跨域限制，请换支持 CORS 的中转站）'); }
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status}：${txt.slice(0, 260) || r.statusText}`);
  }
  return r;
}

/* 从 NovelAI 返回的 zip 中提取 PNG（本地文件头 → deflate-raw 解压） */
async function extractZipPng(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  for (let i = 0; i < u8.length - 30; i++) {
    if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x03 && u8[i + 3] === 0x04) {
      const method = dv.getUint16(i + 8, true);
      const compSize = dv.getUint32(i + 18, true);
      const nameLen = dv.getUint16(i + 26, true), extraLen = dv.getUint16(i + 28, true);
      const start = i + 30 + nameLen + extraLen;
      if (method === 0) return new Blob([u8.slice(start, start + compSize)], { type: 'image/png' });
      if (method === 8) {
        const ds = new DecompressionStream('deflate-raw');
        const stream = new Blob([u8.slice(start, start + compSize)]).stream().pipeThrough(ds);
        return new Blob([await new Response(stream).arrayBuffer()], { type: 'image/png' });
      }
      return null;
    }
  }
  return null;
}

async function genOpenAI(prompt, neg, w, h) {
  const st = S.settings;
  let base = (st.base || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('请先在「API 设置」填写中转站地址');
  if (!/^https?:\/\//.test(base)) throw new Error('地址需以 http(s):// 开头，当前为：' + base);
  if (!/\/v\d+$/.test(base)) base += '/v1';
  const body = { model: st.model || 'dall-e-3', prompt, n: 1, size: `${w}x${h}`, response_format: 'b64_json' };
  let r;
  try { r = await postJSON(base + '/images/generations', body, st.key); }
  catch (e) {
    if (String(e.message).includes('response_format')) {
      delete body.response_format; r = await postJSON(base + '/images/generations', body, st.key);
    } else throw e;
  }
  const j = await r.json();
  const item = j && j.data && j.data[0];
  if (item && item.b64_json) return { img: b64ToBlob(item.b64_json), model: body.model };
  if (item && item.url) {
    try { const b = await (await fetch(item.url)).blob(); return { img: b, model: body.model }; }
    catch (e) { return { img: item.url, model: body.model }; }
  }
  throw new Error('响应中没有图片数据');
}

async function genNai(prompt, neg, w, h) {
  const st = S.settings;
  const base = (st.base || 'https://image.novelai.net').trim().replace(/\/+$/, '');
  const model = st.model || 'nai-diffusion-3';
  const isV4 = /diffusion-4|nai-v4|v4/.test(model);
  const params = {
    width: w, height: h, scale: +st.scale || 6, sampler: st.sampler || 'k_euler_ana',
    steps: +st.steps || 28, n_samples: 1, ucPreset: 0, negative_prompt: neg
  };
  if (st.seed) params.seed = +st.seed;
  let body;
  if (isV4) {
    body = {
      input: prompt, model, action: 'generate',
      parameters: {
        ...params, params_version: 3,
        v4_prompt: { caption: { base_caption: prompt, use_coords: false, use_order: false, char_captions: [] } },
        v4_negative_prompt: { caption: { base_caption: neg, char_captions: [] } }
      }
    };
  } else body = { input: prompt, model, action: 'generate', parameters: params };
  const r = await postJSON(base + '/ai/generate-image', body, st.key);
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('json')) {
    const j = await r.json();
    const b64 = j.data || j.image || (j.images && j.images[0]);
    if (b64) return { img: b64ToBlob(b64), model };
    if (j.url) { try { return { img: await (await fetch(j.url)).blob(), model }; } catch (e) { return { img: j.url, model }; } }
    throw new Error('中转返回的 JSON 中没有图片字段');
  }
  const png = await extractZipPng(await r.arrayBuffer());
  if (!png) throw new Error('无法从返回的 zip 中提取图片');
  return { img: png, model };
}

async function genSD(prompt, neg, w, h) {
  const st = S.settings;
  const base = (st.base || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('请先在「API 设置」填写 SD WebUI 地址');
  const body = {
    prompt, negative_prompt: neg, width: w, height: h,
    steps: +st.steps || 25, cfg_scale: +st.scale || 7,
    sampler_name: st.sampler || 'DPM++ 2M', seed: st.seed ? +st.seed : -1
  };
  const r = await postJSON(base + '/sdapi/v1/txt2img', body, st.key);
  const j = await r.json();
  const b64 = j.images && j.images[0];
  if (!b64) throw new Error('响应中没有图片数据');
  return { img: b64ToBlob(b64), model: 'sd-webui' };
}

async function generateImage(prompt, neg) {
  const { w, h } = sizeWH();
  const neg2 = neg;
  if (S.settings.provider === 'nai') return await genNai(prompt, neg2, w, h);
  if (S.settings.provider === 'sd') return await genSD(prompt, neg2, w, h);
  return await genOpenAI(prompt, neg2, w, h);
}

/* 生成并按需存入画串录 */
async function generateAndSave(fullP, artistStr) {
  const r = await generateImage(fullP, S.negative);
  const { w, h } = sizeWH();
  const rec = {
    id: crypto.randomUUID(), ts: Date.now(), str: artistStr,
    prompt: fullP, negative: S.negative, provider: S.settings.provider,
    model: r.model || '', size: `${w}x${h}`, img: r.img
  };
  if (S.settings.autoSave) { await idbPut(rec); updateNav(); if ($('#page-records').classList.contains('on')) renderRecords(); }
  return rec;
}

$('#btnGen').addEventListener('click', async () => {
  if (!S.sel.length) return toast('请先在画师库加入画师串');
  savePromptState();
  const str = buildStr(S.sel), full = fullPrompt(str);
  const btn = $('#btnGen'); btn.disabled = true;
  $('#genStatus').innerHTML = '<span class="spin"></span>请求生成中…（取决于中转站速度）';
  const t0 = performance.now();
  try {
    const rec = await generateAndSave(full, str);
    showGenResult(rec, performance.now() - t0);
    $('#genStatus').textContent = '完成，已存入画串录';
  } catch (err) {
    $('#genStatus').textContent = '失败：' + err.message;
  }
  btn.disabled = false;
});
function showGenResult(rec, ms) {
  const url = rec.img instanceof Blob ? URL.createObjectURL(rec.img) : rec.img;
  $('#genResult').innerHTML = `<img src="${url}" alt=""><pre class="codewrap">${esc(rec.str)}</pre>`;
  $('#genResult img').onclick = () => openLightbox(url, rec.str);
}

$('#inPrompt').addEventListener('input', savePromptState);
$('#inNegative').addEventListener('input', savePromptState);
$('#inPrefix').addEventListener('input', () => { S.settings.prefix = $('#inPrefix').value; saveLS('asl_settings', S.settings); });
function savePromptState() { S.prompt = $('#inPrompt').value; S.negative = $('#inNegative').value; saveLS('asl_prompt', S.prompt); saveLS('asl_negative', S.negative); }

/* ================= 画串录 ================= */
async function renderRecords() {
  let list = await idbAll();
  list.sort((a, b) => b.ts - a.ts);
  const q = $('#recQ').value.trim().toLowerCase();
  if (q) list = list.filter(r => (r.str + ' ' + (r.prompt || '')).toLowerCase().includes(q));
  $('#recCount').textContent = `${list.length} 条`;
  $('#recEmpty').classList.toggle('hide', list.length > 0);
  const grid = $('#recGrid');
  for (const u of S.recUrls.values()) URL.revokeObjectURL(u);
  S.recUrls.clear();
  grid.innerHTML = '';
  for (const r of list) {
    const url = r.img instanceof Blob ? URL.createObjectURL(r.img) : r.img;
    if (r.img instanceof Blob) S.recUrls.set(r.id, url);
    const card = document.createElement('div');
    card.className = 'rcard';
    card.innerHTML = `
      <img src="${url}" alt="">
      <div class="rbody">
        <pre class="codewrap">${esc(r.str)}</pre>
        <div class="rmeta"><span>${esc(r.model || r.provider)} · ${esc(r.size || '')}</span><span>${new Date(r.ts).toLocaleString('zh-CN', { hour12: false })}</span></div>
        <div class="rfoot">
          <button class="mini" data-copy>复制画师串</button>
          <button class="mini" data-copyfull>复制完整提示词</button>
          <button class="mini danger" data-del>删除</button>
        </div>
      </div>`;
    card.querySelector('img').onclick = () => openLightbox(url, r.str);
    card.querySelector('[data-copy]').onclick = () => copyText(r.str);
    card.querySelector('[data-copyfull]').onclick = () => copyText(r.prompt || r.str);
    card.querySelector('[data-del]').onclick = async () => { await idbDel(r.id); renderRecords(); updateNav(); };
    grid.appendChild(card);
  }
}
$('#recQ').addEventListener('input', renderRecords);
$('#recClear').addEventListener('click', async () => {
  if (!confirm('确定清空全部画串录记录？此操作不可恢复。')) return;
  await idbClear(); renderRecords(); updateNav(); toast('已清空');
});

function openLightbox(url, str) {
  $('#lbImg').src = url; $('#lbStr').textContent = str || '';
  $('#lightbox').classList.remove('hide');
}
$('#lbClose').addEventListener('click', () => $('#lightbox').classList.add('hide'));
$('#lightbox').addEventListener('click', e => { if (e.target.id === 'lightbox') $('#lightbox').classList.add('hide'); });

/* ================= 设置 ================= */
function bindSettings() {
  const st = S.settings;
  $('#stProvider').value = st.provider; $('#stBase').value = st.base; $('#stKey').value = st.key;
  $('#stModel').value = st.model; $('#stSteps').value = st.steps; $('#stScale').value = st.scale;
  $('#stSampler').value = st.sampler; $('#stSeed').value = st.seed; $('#stAutoSave').checked = !!st.autoSave;
  $('#inPrefix').value = st.prefix || '';
  $('#inPrompt').value = S.prompt; $('#inNegative').value = S.negative;
}
['stProvider','stBase','stKey','stModel','stSteps','stScale','stSampler','stSeed','stAutoSave'].forEach(id => {
  $('#' + id).addEventListener('input', saveSettings);
  $('#' + id).addEventListener('change', saveSettings);
});
function saveSettings() {
  S.settings = {
    ...S.settings,
    provider: $('#stProvider').value, base: $('#stBase').value.trim(), key: $('#stKey').value.trim(),
    model: $('#stModel').value.trim(), steps: +$('#stSteps').value || 28, scale: +$('#stScale').value || 6,
    sampler: $('#stSampler').value.trim(), seed: $('#stSeed').value.trim(), autoSave: $('#stAutoSave').checked
  };
  saveLS('asl_settings', S.settings);
}
function endpointPreview() {
  const st = S.settings;
  if (st.provider === 'nai') return (st.base || 'https://image.novelai.net').replace(/\/+$/, '') + '/ai/generate-image';
  if (st.provider === 'sd') return (st.base || '(未填)').replace(/\/+$/, '') + '/sdapi/v1/txt2img';
  let base = (st.base || '(未填)').replace(/\/+$/, '');
  if (/^https?:\/\//.test(base) && !/\/v\d+$/.test(base)) base += '/v1';
  return base + '/images/generations';
}
$('#btnTest').addEventListener('click', async () => {
  saveSettings();
  const el = $('#testStatus');
  el.innerHTML = '<span class="spin"></span>测试 ' + esc(endpointPreview()) + ' …';
  try {
    const r = await generateImage('1girl, simple background, monochrome', '');
    const url = r.img instanceof Blob ? URL.createObjectURL(r.img) : r.img;
    el.innerHTML = `成功（${r.model || S.settings.provider}）<img src="${url}" style="max-width:160px;border:1px solid var(--line2);border-radius:8px;display:block;margin-top:6px">`;
  } catch (e) { el.textContent = '失败：' + e.message + '（当前地址：' + endpointPreview() + '）'; }
});

/* ================= 模型列表拉取 ================= */
const NAI_MODELS = ['nai-diffusion-4-5-full', 'nai-diffusion-4-5-curated', 'nai-diffusion-4-full', 'nai-diffusion-4-curated', 'nai-diffusion-3'];
async function getJSON(url, key) {
  const headers = {};
  if (key) headers.Authorization = 'Bearer ' + key;
  let r;
  try { r = await fetch(url, { headers }); }
  catch (e) { throw new Error('网络/CORS 失败：' + e.message + '（请确认中转站支持 /models 接口且允许跨域）'); }
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status}：${t.slice(0, 200) || r.statusText}`);
  }
  return r.json();
}
function showModelPicker(list) {
  const sel = $('#stModelSel'), inp = $('#stModel'), cur = inp.value.trim();
  let opts = '<option value="">— 手动输入 —</option>';
  if (cur && !list.includes(cur)) opts += `<option value="${esc(cur)}" selected>当前：${esc(cur)}</option>`;
  opts += list.map(m => `<option value="${esc(m)}"${m === cur ? ' selected' : ''}>${esc(m)}</option>`).join('');
  sel.innerHTML = opts;
  sel.classList.remove('hide'); inp.classList.add('hide');
}
$('#stModelSel').addEventListener('change', e => {
  const sel = e.target, inp = $('#stModel');
  if (!sel.value) { sel.classList.add('hide'); inp.classList.remove('hide'); return; }
  inp.value = sel.value; saveSettings();
});
$('#btnModels').addEventListener('click', async () => {
  saveSettings();
  const st = S.settings, el = $('#modelsStatus');
  el.innerHTML = '<span class="spin"></span>获取模型列表…';
  try {
    let list = [];
    if (st.provider === 'nai') {
      list = [...NAI_MODELS];
    } else if (st.provider === 'sd') {
      const base = (st.base || '').trim().replace(/\/+$/, '');
      if (!base) throw new Error('请先填写 SD WebUI 地址');
      const j = await getJSON(base + '/sdapi/v1/sd-models', st.key);
      list = (Array.isArray(j) ? j : []).map(m => m.title || m.model_name).filter(Boolean);
    } else {
      let base = (st.base || '').trim().replace(/\/+$/, '');
      if (!base) throw new Error('请先填写中转站地址');
      if (!/^https?:\/\//.test(base)) throw new Error('地址需以 http(s):// 开头，当前为：' + base);
      if (!/\/v\d+$/.test(base)) base += '/v1';
      const j = await getJSON(base + '/models', st.key);
      const arr = Array.isArray(j) ? j : (j.data || j.models || []);
      list = arr.map(m => typeof m === 'string' ? m : (m.id || m.name)).filter(Boolean);
    }
    list = [...new Set(list)];
    if (!list.length) throw new Error('接口未返回任何模型');
    showModelPicker(list);
    el.textContent = `获取成功，共 ${list.length} 个模型，已在下方下拉选择`;
  } catch (e) { el.textContent = '失败：' + e.message; }
});

/* ================= 导入 ================= */
$('#btnImport').addEventListener('click', () => $('#modal').classList.remove('hide'));
$('#modalClose').addEventListener('click', () => $('#modal').classList.add('hide'));
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') $('#modal').classList.add('hide'); });
$('#impFile').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  $('#impText').value = await f.text();
});
$('#impGo').addEventListener('click', () => {
  const raw = $('#impText').value.trim();
  if (!raw) return toast('请先粘贴内容或选择文件');
  const n = parseImport(raw);
  if (!n) return toast('没有解析出画师串');
  mergeArtists(); renderChips(); libShown = PAGE_SIZE; renderLibrary(); updateNav();
  $('#importStatus').textContent = `已导入 ${n} 条自定义画师串`;
  $('#impText').value = ''; $('#modal').classList.add('hide');
  toast(`导入成功：${n} 条`);
});
function parseImport(raw) {
  let list = [];
  try {
    const j = JSON.parse(raw);
    if (Array.isArray(j)) list = j.map(o => typeof o === 'string' ? { tag: o } : {
      tag: o.tag || o.name || o.t, cat: o.cat || o.category || o.c, desc: o.desc || o.description || o.d, n: o.n || o.post_count || o.count
    }).filter(x => x.tag);
  } catch (e) { /* 非 JSON，按行解析 */ }
  if (!list.length) {
    for (let line of raw.split(/\r?\n/)) {
      line = line.trim().replace(/\\\(/g, '(').replace(/\\\)/g, ')');
      if (!line || line.startsWith('#')) continue;
      const cols = line.split(',').map(s => s.trim());
      let tag = cols[0];
      if (!tag) continue;
      /* 兼容直接粘贴 novel 格式串：artist:tag:1.2 → tag */
      const m = tag.match(/^artist:\s*(.+?)(?::\s*\d+(?:\.\d+)?)?$/i);
      if (m) tag = m[1].trim();
      let cat = '', desc = '';
      if (cols.length >= 2 && (window.ARTIST_CATS || []).includes(cols[1])) { cat = cols[1]; desc = cols.slice(2).join(','); }
      else if (cols.length >= 2) desc = cols.slice(1).join(',');
      list.push({ tag, cat, desc });
    }
  }
  const map = new Map(S.custom.map(c => [c.t, c]));
  for (const it of list) {
    const t = String(it.tag).trim().replace(/\s+/g, ' ');
    if (!t) continue;
    const old = map.get(t) || { t };
    map.set(t, { t, c: it.cat || old.c, d: it.desc || old.d, n: it.n != null ? it.n : old.n });
  }
  S.custom = [...map.values()];
  saveLS('asl_custom', S.custom);
  return S.custom.length && list.length ? list.length : 0;
}
$('#btnPullDanbooru').addEventListener('click', async () => {
  const el = $('#importStatus'); el.innerHTML = '<span class="spin"></span>拉取中…';
  try {
    const r = await fetch('https://danbooru.donmai.us/tags.json?search[category]=1&search[order]=count&limit=1000&page=1');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const tags = await r.json();
    const map = new Map(S.custom.map(c => [c.t, c]));
    for (const t of tags) map.set(t.name, { t: t.name, n: t.post_count });
    S.custom = [...map.values()]; saveLS('asl_custom', S.custom);
    mergeArtists(); renderChips(); renderLibrary(); updateNav();
    el.textContent = `已拉取 ${tags.length} 个 Danbooru 画师串`;
  } catch (e) { el.textContent = '失败：' + e.message + '（浏览器跨域受限时可改用文件导入 data/danbooru-artists-33k.txt）'; }
});
$('#btnExport').addEventListener('click', () => copyText(JSON.stringify(S.custom)) );
$('#btnWipeCustom').addEventListener('click', () => {
  if (!confirm('清空全部自定义导入数据？内置画师库不受影响。')) return;
  S.custom = []; saveLS('asl_custom', S.custom); mergeArtists(); renderChips(); renderLibrary(); updateNav();
  $('#importStatus').textContent = '已清空自定义导入';
});

/* ================= 导航计数 ================= */
function updateNav() {
  $('#navLibCount').textContent = S.artists.length;
  $('#navSelCount').textContent = S.sel.length || '';
  idbAll().then(l => $('#navRecCount').textContent = l.length || '').catch(() => {});
}

/* ================= 调串台渲染 ================= */
function renderMixer() {
  $('#selN').textContent = S.sel.length ? `(${S.sel.length})` : '';
  $('#selList').innerHTML = S.sel.length ? S.sel.map(s => `
    <div class="selrow">
      <span class="stag">${esc(s.t)}</span>
      <input type="number" step="0.05" min="0.05" max="3" value="${s.w}" data-w="${encodeURIComponent(s.t)}">
      <button class="mini danger" data-del="${encodeURIComponent(s.t)}">×</button>
    </div>`).join('') : '<div class="faint" style="padding:8px 2px">还没有画师串 —— 去「画师库」点击「+ 加入调串」</div>';
  renderPreview();
  updateNav();
}

/* ================= 初始化 ================= */
mergeArtists();
$('#libCat').innerHTML = '<option value="">全部分类</option>' +
  (window.ARTIST_CATS || []).map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
renderChips();
$('#rStyle').innerHTML = '<option value="">不限</option>' +
  (window.ARTIST_CATS || []).map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
renderLibrary();
bindFmt(); bindRnd(); bindSettings();
renderMixer();
updateNav();
