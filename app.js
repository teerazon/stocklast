/* ─────────────────────────────────────────────
   StockFlow — app.js  v2.0
   Real Supabase API integration (no price field)
   ─────────────────────────────────────────────*/

'use strict';

// ══════════════════════════════════════════════
// CONFIG & STATE
// ══════════════════════════════════════════════

const CONFIG = {
  LOW_STOCK_DEFAULT: 5,
  DEBOUNCE_MS: 320,
  SUPABASE_URL: 'https://fbluqgovecrdacmnhzch.supabase.co',
  SUPABASE_KEY: 'sb_publishable_xIQf4XXDdvy6tZ5kKM7yjg_8I0j2JnD',
};

const STATE = {
  currentPage: 'dashboard',
  products: [],
  shoppingList: [],
  history: [],
  scannerMode: 'stock',
  editingProduct: null,
  detailProduct: null,
  quickUpdateProduct: null,
  html5QrCode: null,
  scannerOpen: false,
  searchQuery: '',
  filteredProducts: [],
  isOnline: navigator.onLine,
  syncPending: [],
};

// ══════════════════════════════════════════════
// SUPABASE API LAYER
// ══════════════════════════════════════════════

const SB = {
  ready() {
    return !!(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_KEY);
  },

  headers() {
    return {
      'Content-Type': 'application/json',
      'apikey': CONFIG.SUPABASE_KEY,
      'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`,
      'Prefer': 'return=representation',
    };
  },

  // ── GET: โหลดสินค้าทั้งหมด ──
  async getProducts() {
    const res = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/products?select=*&order=created_at.asc`,
      { headers: SB.headers() }
    );
    if (!res.ok) throw new Error(`GET products ${res.status}`);
    return (await res.json()).map(SB._fromDb);
  },

  // ── GET: โหลด shopping list พร้อม join product ──
  async getShoppingList() {
    const res = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/shopping_list?select=*,products(name,barcode,unit,image_data)&order=created_at.asc`,
      { headers: SB.headers() }
    );
    if (!res.ok) throw new Error(`GET shopping_list ${res.status}`);
    return (await res.json()).map(row => ({
      id: row.product_id,
      shoppingId: row.id,
      qty: row.qty,
      name: row.products?.name || '',
      barcode: row.products?.barcode || '',
      unit: row.products?.unit || 'ชิ้น',
      imageData: row.products?.image_data || null,
    }));
  },

  // ── GET: โหลดประวัติ ──
  async getHistory() {
    const res = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/stock_history?select=*&order=timestamp.desc&limit=200`,
      { headers: SB.headers() }
    );
    if (!res.ok) throw new Error(`GET history ${res.status}`);
    return (await res.json()).map(row => ({
      id: row.id,
      productId: row.product_id,
      productName: row.product_name,
      oldQty: row.old_qty,
      newQty: row.new_qty,
      delta: row.delta,
      type: row.type,
      timestamp: new Date(row.timestamp).getTime(),
    }));
  },

  // ── INSERT: เพิ่มสินค้าใหม่ ──
  async insertProduct(product) {
    const res = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/products`,
      { method: 'POST', headers: SB.headers(), body: JSON.stringify(SB._toDb(product)) }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (err.code === '23505') throw new Error('BARCODE_DUPLICATE');
      throw new Error(`INSERT product ${res.status}`);
    }
    const [row] = await res.json();
    return SB._fromDb(row);
  },

  // ── UPDATE: แก้ไขสินค้า ──
  async updateProduct(id, fields) {
    const body = { updated_at: new Date().toISOString() };
    if ('name' in fields)         body.name          = fields.name;
    if ('category' in fields)     body.category      = fields.category;
    if ('qty' in fields)          body.qty           = fields.qty;
    if ('lowThreshold' in fields) body.low_threshold = fields.lowThreshold;
    if ('unit' in fields)         body.unit          = fields.unit;
    if ('barcode' in fields)      body.barcode       = fields.barcode;
    if ('note' in fields)         body.note          = fields.note;
    if ('imageData' in fields)    body.image_data    = fields.imageData;
    const res = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/products?id=eq.${id}`,
      { method: 'PATCH', headers: SB.headers(), body: JSON.stringify(body) }
    );
    if (!res.ok) throw new Error(`UPDATE product ${res.status}`);
    const [row] = await res.json();
    return SB._fromDb(row);
  },

  // ── UPDATE qty เร็วๆ ──
  async updateQty(id, newQty) {
    return SB.updateProduct(id, { qty: newQty });
  },

  // ── DELETE: ลบสินค้า ──
  async deleteProduct(id) {
    const res = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/products?id=eq.${id}`,
      { method: 'DELETE', headers: SB.headers() }
    );
    if (!res.ok) throw new Error(`DELETE product ${res.status}`);
  },

  // ── Shopping: เพิ่ม/อัปเดต (upsert) ──
  async addToShoppingList(productId, qty = 1) {
    const res = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/shopping_list`,
      {
        method: 'POST',
        headers: { ...SB.headers(), 'Prefer': 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({ product_id: productId, qty }),
      }
    );
    if (!res.ok) throw new Error(`INSERT shopping_list ${res.status}`);
  },

  async updateShoppingQty(productId, qty) {
    const res = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/shopping_list?product_id=eq.${productId}`,
      { method: 'PATCH', headers: SB.headers(), body: JSON.stringify({ qty }) }
    );
    if (!res.ok) throw new Error(`UPDATE shopping_list ${res.status}`);
  },

  async removeFromShoppingList(productId) {
    const res = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/shopping_list?product_id=eq.${productId}`,
      { method: 'DELETE', headers: SB.headers() }
    );
    if (!res.ok) throw new Error(`DELETE shopping_list ${res.status}`);
  },

  async clearShoppingList() {
    const res = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/shopping_list?qty=gte.0`,
      { method: 'DELETE', headers: SB.headers() }
    );
    if (!res.ok) throw new Error(`CLEAR shopping_list ${res.status}`);
  },

  // ── History: บันทึก ──
  async insertHistory(entry) {
    const res = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/stock_history`,
      {
        method: 'POST',
        headers: { ...SB.headers(), 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          product_id:   entry.productId,
          product_name: entry.productName,
          old_qty:      entry.oldQty ?? null,
          new_qty:      entry.newQty,
          delta:        entry.delta,
          type:         entry.type || 'update',
          timestamp:    new Date().toISOString(),
        }),
      }
    );
    if (!res.ok) throw new Error(`INSERT history ${res.status}`);
  },

  async clearHistory() {
    const res = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/stock_history?delta=gte.-99999`,
      { method: 'DELETE', headers: SB.headers() }
    );
    if (!res.ok) throw new Error(`CLEAR history ${res.status}`);
  },

  // ── Realtime WebSocket subscribe ──
  subscribeProducts(onEvent) {
    if (!SB.ready()) return null;
    const wsUrl = CONFIG.SUPABASE_URL.replace('https://', 'wss://')
      + '/realtime/v1/websocket?apikey=' + CONFIG.SUPABASE_KEY + '&vsn=1.0.0';
    try {
      const ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        ws.send(JSON.stringify({
          topic: 'realtime:public:products',
          event: 'phx_join',
          payload: {
            config: {
              broadcast: { self: false },
              presence: { key: '' },
              postgres_changes: [{ event: '*', schema: 'public', table: 'products' }],
            },
          },
          ref: '1',
        }));
      };
      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (data.event === 'postgres_changes' && data.payload?.data) {
            onEvent(data.payload.data);
          }
        } catch(e) {}
      };
      ws.onerror = () => {};
      return ws;
    } catch(e) { return null; }
  },

  // ── snake_case DB → camelCase app ──
  _fromDb(row) {
    return {
      id:           row.id,
      name:         row.name,
      category:     row.category   || '',
      qty:          row.qty        ?? 0,
      lowThreshold: row.low_threshold ?? CONFIG.LOW_STOCK_DEFAULT,
      unit:         row.unit       || 'ชิ้น',
      barcode:      row.barcode    || '',
      note:         row.note       || '',
      imageData:    row.image_data || null,
      createdAt:    new Date(row.created_at).getTime(),
      updatedAt:    new Date(row.updated_at).getTime(),
    };
  },

  // ── camelCase app → snake_case DB ──
  _toDb(p) {
    return {
      id:            p.id,
      name:          p.name,
      category:      p.category     || null,
      qty:           p.qty          ?? 0,
      low_threshold: p.lowThreshold ?? CONFIG.LOW_STOCK_DEFAULT,
      unit:          p.unit         || 'ชิ้น',
      barcode:       p.barcode      || null,
      note:          p.note         || null,
      image_data:    p.imageData    || null,
    };
  },
};

// ══════════════════════════════════════════════
// LOCAL STORAGE (Offline Cache)
// ══════════════════════════════════════════════

const LOCAL = {
  save() {
    localStorage.setItem('sf_products',  JSON.stringify(STATE.products));
    localStorage.setItem('sf_shopping',  JSON.stringify(STATE.shoppingList));
    localStorage.setItem('sf_history',   JSON.stringify(STATE.history.slice(0, 200)));
    localStorage.setItem('sf_pending',   JSON.stringify(STATE.syncPending));
  },
  load() {
    STATE.products     = JSON.parse(localStorage.getItem('sf_products')  || '[]');
    STATE.shoppingList = JSON.parse(localStorage.getItem('sf_shopping')  || '[]');
    STATE.history      = JSON.parse(localStorage.getItem('sf_history')   || '[]');
    STATE.syncPending  = JSON.parse(localStorage.getItem('sf_pending')   || '[]');
  },
  loadSettings() {
    const s = JSON.parse(localStorage.getItem('sf_settings') || '{}');
    if (s.url) CONFIG.SUPABASE_URL = s.url;
    if (s.key) CONFIG.SUPABASE_KEY = s.key;
    if (s.low) CONFIG.LOW_STOCK_DEFAULT = parseInt(s.low);
    const f = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    f('setting-supabase-url', s.url);
    f('setting-supabase-key', s.key);
    f('setting-low-threshold', s.low || '5');
  },
};

// ══════════════════════════════════════════════
// UNIFIED DB: Supabase-first, localStorage fallback
// ══════════════════════════════════════════════

const DB = {
  async init() {
    LOCAL.load();
    if (!SB.ready()) { showSyncStatus('offline'); return; }
    showSyncStatus('syncing');
    try {
      const [products, shopping, history] = await Promise.all([
        SB.getProducts(),
        SB.getShoppingList(),
        SB.getHistory(),
      ]);
      STATE.products     = products;
      STATE.shoppingList = shopping;
      STATE.history      = history;
      LOCAL.save();
      showSyncStatus('synced');
      SB.subscribeProducts((change) => DB._onRealtimeChange(change));
    } catch (err) {
      console.warn('[DB.init] Supabase ไม่สามารถเชื่อมต่อได้ ใช้ local cache:', err);
      showSyncStatus('error');
    }
  },

  _onRealtimeChange(change) {
    const { eventType, new: n, old: o } = change;
    if (eventType === 'INSERT') {
      if (!STATE.products.find(p => p.id === n.id)) STATE.products.push(SB._fromDb(n));
    } else if (eventType === 'UPDATE') {
      const i = STATE.products.findIndex(p => p.id === n.id);
      if (i >= 0) STATE.products[i] = SB._fromDb(n);
    } else if (eventType === 'DELETE') {
      STATE.products = STATE.products.filter(p => p.id !== o.id);
    }
    LOCAL.save();
    renderPage(STATE.currentPage);
  },

  async insertProduct(product) {
    LOCAL.save();
    if (!SB.ready() || !STATE.isOnline) {
      STATE.syncPending.push({ op: 'insertProduct', data: product });
      LOCAL.save();
      return product;
    }
    try {
      const created = await SB.insertProduct(product);
      const idx = STATE.products.findIndex(p => p.id === product.id);
      if (idx >= 0) STATE.products[idx] = created;
      LOCAL.save();
      return created;
    } catch (err) {
      if (err.message === 'BARCODE_DUPLICATE') throw err;
      STATE.syncPending.push({ op: 'insertProduct', data: product });
      LOCAL.save();
      showToast('บันทึก offline — จะ sync เมื่อ online', 'warning');
      return product;
    }
  },

  async updateProduct(id, fields) {
    LOCAL.save();
    if (!SB.ready() || !STATE.isOnline) {
      STATE.syncPending.push({ op: 'updateProduct', id, data: fields });
      LOCAL.save(); return;
    }
    try { await SB.updateProduct(id, fields); }
    catch (err) {
      STATE.syncPending.push({ op: 'updateProduct', id, data: fields });
      LOCAL.save();
      showToast('บันทึก offline — จะ sync เมื่อ online', 'warning');
    }
  },

  async updateQty(id, newQty) {
    LOCAL.save();
    if (!SB.ready() || !STATE.isOnline) {
      STATE.syncPending.push({ op: 'updateQty', id, qty: newQty });
      LOCAL.save(); return;
    }
    try { await SB.updateQty(id, newQty); }
    catch (err) { STATE.syncPending.push({ op: 'updateQty', id, qty: newQty }); LOCAL.save(); }
  },

  async deleteProduct(id) {
    LOCAL.save();
    if (!SB.ready() || !STATE.isOnline) {
      STATE.syncPending.push({ op: 'deleteProduct', id });
      LOCAL.save(); return;
    }
    try { await SB.deleteProduct(id); }
    catch (err) { STATE.syncPending.push({ op: 'deleteProduct', id }); LOCAL.save(); }
  },

  async addToShopping(productId, qty) {
    LOCAL.save();
    if (!SB.ready() || !STATE.isOnline) return;
    try { await SB.addToShoppingList(productId, qty); } catch(e) {}
  },

  async updateShoppingQty(productId, qty) {
    LOCAL.save();
    if (!SB.ready() || !STATE.isOnline) return;
    try { await SB.updateShoppingQty(productId, qty); } catch(e) {}
  },

  async removeFromShopping(productId) {
    LOCAL.save();
    if (!SB.ready() || !STATE.isOnline) return;
    try { await SB.removeFromShoppingList(productId); } catch(e) {}
  },

  async clearShopping() {
    LOCAL.save();
    if (!SB.ready() || !STATE.isOnline) return;
    try { await SB.clearShoppingList(); } catch(e) {}
  },

  async insertHistory(entry) {
    STATE.history.unshift({ ...entry, id: genId(), timestamp: Date.now() });
    LOCAL.save();
    if (!SB.ready() || !STATE.isOnline) return;
    try { await SB.insertHistory(entry); } catch(e) {}
  },

  async clearHistory() {
    LOCAL.save();
    if (!SB.ready() || !STATE.isOnline) return;
    try { await SB.clearHistory(); } catch(e) {}
  },

  // Flush operations ที่ค้างอยู่เมื่อกลับมา online
  async flushPending() {
    if (!SB.ready() || STATE.syncPending.length === 0) return;
    showSyncStatus('syncing');
    const pending = [...STATE.syncPending];
    STATE.syncPending = [];
    LOCAL.save();
    let failed = 0;
    for (const op of pending) {
      try {
        if      (op.op === 'insertProduct') await SB.insertProduct(op.data);
        else if (op.op === 'updateProduct') await SB.updateProduct(op.id, op.data);
        else if (op.op === 'updateQty')     await SB.updateQty(op.id, op.qty);
        else if (op.op === 'deleteProduct') await SB.deleteProduct(op.id);
      } catch(err) {
        failed++;
        STATE.syncPending.push(op);
        LOCAL.save();
      }
    }
    showSyncStatus(failed === 0 ? 'synced' : 'error');
    if (failed === 0) showToast(`Sync สำเร็จ ${pending.length} รายการ`, 'success');
    else showToast(`Sync ล้มเหลว ${failed} รายการ`, 'error');
  },
};

// ══════════════════════════════════════════════
// SYNC STATUS DOT
// ══════════════════════════════════════════════

function showSyncStatus(status) {
  const el = document.getElementById('sync-dot');
  if (!el) return;
  const map = {
    synced:  'w-2 h-2 rounded-full bg-green-400',
    syncing: 'w-2 h-2 rounded-full bg-amber-400 animate-pulse',
    offline: 'w-2 h-2 rounded-full bg-slate-500',
    error:   'w-2 h-2 rounded-full bg-red-400',
  };
  el.className = map[status] || map.offline;
  const titles = { synced: 'Synced', syncing: 'Syncing…', offline: 'Offline', error: 'Sync Error' };
  el.title = titles[status] || '';
}

// ══════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════

function navigate(page) {
  STATE.currentPage = page;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`tab-${page}`)?.classList.add('active');
  document.getElementById('search-bar').style.display  = page === 'dashboard' ? '' : 'none';
  document.getElementById('fab').style.display         = page === 'dashboard' ? '' : 'none';
  renderPage(page);
}

function renderPage(page) {
  document.getElementById('page-content').innerHTML = '';
  if      (page === 'dashboard') renderDashboard();
  else if (page === 'shopping')  renderShopping();
  else if (page === 'history')   renderHistory();
  lucide.createIcons();
}

// ══════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════

function renderDashboard() {
  const content  = document.getElementById('page-content');
  const products = STATE.searchQuery ? STATE.filteredProducts : STATE.products;
  const lowCount = STATE.products.filter(p => p.qty <= (p.lowThreshold ?? CONFIG.LOW_STOCK_DEFAULT)).length;

  const badge = document.getElementById('notif-badge');
  if (lowCount > 0) { badge.textContent = lowCount; badge.classList.remove('hidden'); }
  else badge.classList.add('hidden');

  let html = `<div class="p-4 space-y-4">`;

  if (!STATE.searchQuery) {
    html += `
    <div class="grid grid-cols-3 gap-2">
      <div class="bg-surface-800 rounded-xl p-3 text-center">
        <p class="text-2xl font-bold font-mono">${STATE.products.length}</p>
        <p class="text-[10px] text-slate-400 mt-0.5">รายการทั้งหมด</p>
      </div>
      <div class="bg-surface-800 rounded-xl p-3 text-center">
        <p class="text-2xl font-bold font-mono text-brand-400">${STATE.products.reduce((s,p)=>s+p.qty,0)}</p>
        <p class="text-[10px] text-slate-400 mt-0.5">จำนวนรวม</p>
      </div>
      <div class="bg-surface-800 rounded-xl p-3 text-center">
        <p class="text-2xl font-bold font-mono ${lowCount > 0 ? 'text-red-400' : 'text-green-400'}">${lowCount}</p>
        <p class="text-[10px] text-slate-400 mt-0.5">สต็อกต่ำ</p>
      </div>
    </div>`;

    if (lowCount > 0) {
      html += `
      <button onclick="navigate('shopping')" class="w-full bg-red-500/10 border border-red-500/30 rounded-xl p-3 flex items-center gap-3 text-left active:bg-red-500/20">
        <div class="w-8 h-8 bg-red-500/20 rounded-lg flex items-center justify-center flex-none">
          <i data-lucide="alert-triangle" class="w-4 h-4 text-red-400"></i>
        </div>
        <div class="min-w-0">
          <p class="text-sm font-medium text-red-300">${lowCount} รายการสต็อกต่ำ</p>
          <p class="text-xs text-slate-400">แตะเพื่อดูรายการที่ต้องสั่งซื้อ</p>
        </div>
        <i data-lucide="chevron-right" class="w-4 h-4 text-slate-500 flex-none ml-auto"></i>
      </button>`;
    }

    const cats = [...new Set(STATE.products.map(p => p.category).filter(Boolean))];
    if (cats.length > 0) {
      html += `
      <div class="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4" style="scrollbar-width:none;">
        <button onclick="filterCategory('')" class="flex-none px-3 py-1.5 bg-brand-600 text-white rounded-full text-xs font-medium whitespace-nowrap">ทั้งหมด</button>
        ${cats.map(c => `<button onclick="filterCategory('${escHtml(c)}')" class="flex-none px-3 py-1.5 bg-surface-800 text-slate-300 rounded-full text-xs font-medium whitespace-nowrap border border-surface-700">${escHtml(c)}</button>`).join('')}
      </div>`;
    }
  }

  const label = STATE.searchQuery ? `ผลการค้นหา "${STATE.searchQuery}" (${products.length})` : `สินค้าทั้งหมด (${products.length})`;
  html += `<h3 class="text-sm font-semibold text-slate-300">${label}</h3>`;

  if (products.length === 0) {
    html += `
    <div class="flex flex-col items-center justify-center py-16 text-center">
      <div class="w-16 h-16 bg-surface-800 rounded-2xl flex items-center justify-center mb-4">
        <i data-lucide="package-open" class="w-8 h-8 text-slate-500"></i>
      </div>
      <p class="font-medium text-slate-400">${STATE.searchQuery ? 'ไม่พบสินค้า' : 'ยังไม่มีสินค้า'}</p>
      <p class="text-xs text-slate-500 mt-1">${STATE.searchQuery ? 'ลองคำอื่น' : 'กด + เพื่อเพิ่มสินค้า'}</p>
    </div>`;
  } else {
    html += `<div class="grid grid-cols-2 gap-2.5">`;
    products.forEach(p => { html += renderProductCard(p); });
    html += `</div>`;
  }

  html += `</div>`;
  content.innerHTML = html;
}

function renderProductCard(p) {
  const low      = p.qty <= (p.lowThreshold ?? CONFIG.LOW_STOCK_DEFAULT);
  const qtyColor = p.qty === 0 ? 'text-red-400' : low ? 'text-amber-400' : 'text-green-400';
  const imgHtml  = p.imageData ? `<img src="${p.imageData}" class="w-full h-full object-cover" />` : `<i data-lucide="package" class="w-6 h-6 text-slate-500"></i>`;
  const lowBadge = low ? `<span class="absolute top-2 left-2 bg-red-500/80 backdrop-blur-sm text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5"><span class="low-stock-dot w-1.5 h-1.5 bg-white rounded-full"></span>${p.qty === 0 ? 'หมด' : 'ต่ำ'}</span>` : '';
  return `
  <div class="stock-card bg-surface-800 rounded-2xl overflow-hidden cursor-pointer border border-surface-700" onclick="openDetail('${p.id}')">
    <div class="relative bg-surface-900 flex items-center justify-center" style="aspect-ratio:1/1;">
      ${imgHtml}${lowBadge}
      <button onclick="event.stopPropagation();openQuickUpdate('${p.id}')" class="absolute bottom-2 right-2 w-7 h-7 bg-brand-600/90 backdrop-blur-sm rounded-lg flex items-center justify-center">
        <i data-lucide="zap" class="w-3.5 h-3.5 text-white"></i>
      </button>
    </div>
    <div class="p-2.5">
      <p class="text-xs font-semibold leading-tight line-clamp-2 mb-1.5">${escHtml(p.name)}</p>
      <div class="flex items-end justify-between">
        <div><span class="qty-badge ${qtyColor} text-sm font-bold">${p.qty}</span><span class="text-[10px] text-slate-500 ml-0.5">${escHtml(p.unit||'ชิ้น')}</span></div>
      </div>
      ${p.barcode ? `<p class="text-[9px] text-slate-600 font-mono mt-1 truncate">${escHtml(p.barcode)}</p>` : ''}
    </div>
  </div>`;
}

// ══════════════════════════════════════════════
// SHOPPING PAGE
// ══════════════════════════════════════════════

function renderShopping() {
  const content     = document.getElementById('page-content');
  const lowProducts = STATE.products.filter(p => p.qty <= (p.lowThreshold ?? CONFIG.LOW_STOCK_DEFAULT));
  let html = `<div class="p-4 space-y-4">`;

  html += `
  <div class="grid grid-cols-2 gap-2">
    <button onclick="openScanner('shopping')" class="h-11 bg-surface-800 rounded-xl text-sm font-medium flex items-center justify-center gap-2 border border-surface-700 active:bg-surface-700">
      <i data-lucide="scan-barcode" class="w-4 h-4 text-brand-400"></i> สแกนเพิ่ม
    </button>
    <button onclick="exportShoppingPDF()" class="h-11 bg-brand-600 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 active:bg-brand-700">
      <i data-lucide="download" class="w-4 h-4"></i> Export PDF
    </button>
  </div>`;

  if (lowProducts.length > 0) {
    html += `
    <div class="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
      <div class="flex items-center gap-2 mb-2">
        <i data-lucide="alert-triangle" class="w-4 h-4 text-amber-400"></i>
        <span class="text-sm font-medium text-amber-300">แนะนำให้สั่งซื้อ (${lowProducts.length})</span>
        <button onclick="addAllLowToShopping()" class="ml-auto text-xs text-brand-400 font-medium">เพิ่มทั้งหมด</button>
      </div>
      <div class="space-y-1.5">
        ${lowProducts.slice(0,3).map(p => `
        <div class="flex items-center gap-2">
          <span class="flex-1 text-xs text-slate-300 truncate">${escHtml(p.name)}</span>
          <span class="text-xs font-mono ${p.qty===0?'text-red-400':'text-amber-400'}">${p.qty} ${escHtml(p.unit||'ชิ้น')}</span>
          <button onclick="toggleShoppingItem('${p.id}')" class="w-6 h-6 rounded-lg flex items-center justify-center ${STATE.shoppingList.find(s=>s.id===p.id)?'bg-brand-600':'bg-surface-700 border border-surface-600'}">
            <i data-lucide="${STATE.shoppingList.find(s=>s.id===p.id)?'check':'plus'}" class="w-3 h-3"></i>
          </button>
        </div>`).join('')}
        ${lowProducts.length > 3 ? `<p class="text-xs text-slate-500 text-center">และอีก ${lowProducts.length-3} รายการ</p>` : ''}
      </div>
    </div>`;
  }

  html += `<div class="flex items-center justify-between">
    <h3 class="text-sm font-semibold text-slate-300">รายการสั่งซื้อ (${STATE.shoppingList.length})</h3>
    ${STATE.shoppingList.length > 0 ? `<button onclick="clearShoppingList()" class="text-xs text-red-400">ล้างรายการ</button>` : ''}
  </div>`;

  if (STATE.shoppingList.length === 0) {
    html += `
    <div class="flex flex-col items-center justify-center py-12 text-center">
      <div class="w-14 h-14 bg-surface-800 rounded-2xl flex items-center justify-center mb-3">
        <i data-lucide="shopping-cart" class="w-7 h-7 text-slate-500"></i>
      </div>
      <p class="text-sm font-medium text-slate-400">รายการว่างเปล่า</p>
      <p class="text-xs text-slate-500 mt-1">สแกน Barcode หรือเลือกจากสินค้าต่ำ</p>
    </div>`;
  } else {
    html += `<div class="space-y-2">`;
    STATE.shoppingList.forEach(item => {
      const p = STATE.products.find(x => x.id === item.id);
      html += `
      <div class="bg-surface-800 rounded-xl p-3 flex items-center gap-3 border border-surface-700">
        <div class="w-10 h-10 rounded-lg bg-surface-900 flex items-center justify-center overflow-hidden flex-none">
          ${p?.imageData ? `<img src="${p.imageData}" class="w-full h-full object-cover"/>` : `<i data-lucide="package" class="w-5 h-5 text-slate-500"></i>`}
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium truncate">${escHtml(item.name)}</p>
          ${item.barcode ? `<p class="text-[10px] text-slate-500 font-mono">${escHtml(item.barcode)}</p>` : ''}
        </div>
        <div class="flex items-center gap-1 flex-none">
          <button onclick="changeShoppingQty('${item.id}',-1)" class="w-7 h-7 bg-surface-700 rounded-lg flex items-center justify-center"><i data-lucide="minus" class="w-3 h-3"></i></button>
          <span class="w-8 text-center font-mono font-bold text-sm">${item.qty||1}</span>
          <button onclick="changeShoppingQty('${item.id}',1)" class="w-7 h-7 bg-surface-700 rounded-lg flex items-center justify-center"><i data-lucide="plus" class="w-3 h-3"></i></button>
          <button onclick="removeFromShopping('${item.id}')" class="w-7 h-7 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center justify-center ml-1">
            <i data-lucide="trash-2" class="w-3 h-3 text-red-400"></i>
          </button>
        </div>
      </div>`;
    });
    html += `</div>`;
    const notInList = STATE.products.filter(p => !STATE.shoppingList.find(s => s.id === p.id));
    if (notInList.length > 0) {
      html += `
      <h4 class="text-xs font-medium text-slate-400">เพิ่มสินค้าอื่น</h4>
      <div class="space-y-1.5">
        ${notInList.slice(0,5).map(p => `
        <button onclick="toggleShoppingItem('${p.id}')" class="w-full bg-surface-800 rounded-xl p-2.5 flex items-center gap-2 border border-surface-700 active:bg-surface-700 text-left">
          <div class="w-8 h-8 rounded-lg bg-surface-900 flex items-center justify-center overflow-hidden flex-none">
            ${p.imageData ? `<img src="${p.imageData}" class="w-full h-full object-cover"/>` : `<i data-lucide="package" class="w-4 h-4 text-slate-500"></i>`}
          </div>
          <span class="flex-1 text-sm truncate">${escHtml(p.name)}</span>
          <i data-lucide="plus" class="w-4 h-4 text-brand-400 flex-none"></i>
        </button>`).join('')}
      </div>`;
    }
  }
  html += `</div>`;
  content.innerHTML = html;
}

// ══════════════════════════════════════════════
// HISTORY PAGE
// ══════════════════════════════════════════════

function renderHistory() {
  const content = document.getElementById('page-content');
  let html = `<div class="p-4 space-y-4">`;
  html += `<div class="flex items-center justify-between">
    <h3 class="text-sm font-semibold text-slate-300">ประวัติการอัปเดต</h3>
    ${STATE.history.length > 0 ? `<button onclick="clearHistory()" class="text-xs text-red-400">ล้างประวัติ</button>` : ''}
  </div>`;

  if (STATE.history.length === 0) {
    html += `
    <div class="flex flex-col items-center justify-center py-16 text-center">
      <div class="w-14 h-14 bg-surface-800 rounded-2xl flex items-center justify-center mb-3">
        <i data-lucide="clock" class="w-7 h-7 text-slate-500"></i>
      </div>
      <p class="text-sm text-slate-400">ยังไม่มีประวัติ</p>
    </div>`;
  } else {
    html += `<div class="space-y-1.5">`;
    STATE.history.slice(0, 50).forEach(h => {
      const isNew   = h.type === 'new';
      const isAdd   = h.delta > 0;
      const color   = isNew ? 'text-brand-400' : isAdd ? 'text-green-400' : 'text-red-400';
      const icon    = isNew ? 'package-plus' : isAdd ? 'trending-up' : 'trending-down';
      const delta   = isNew ? 'เพิ่มใหม่' : `${isAdd?'+':''}${h.delta}`;
      html += `
      <div class="bg-surface-800 rounded-xl p-3 flex items-center gap-3 border border-surface-700">
        <div class="w-8 h-8 rounded-lg ${isNew?'bg-brand-600/20':isAdd?'bg-green-500/10':'bg-red-500/10'} flex items-center justify-center flex-none">
          <i data-lucide="${icon}" class="w-4 h-4 ${color}"></i>
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium truncate">${escHtml(h.productName)}</p>
          <p class="text-[10px] text-slate-500">${formatDate(h.timestamp)}</p>
        </div>
        <div class="text-right flex-none">
          <p class="text-sm font-bold font-mono ${color}">${delta}</p>
          <p class="text-[10px] text-slate-500 font-mono">${h.oldQty??'—'} → ${h.newQty}</p>
        </div>
      </div>`;
    });
    html += `</div>`;
  }
  html += `</div>`;
  content.innerHTML = html;
}

// ══════════════════════════════════════════════
// SCANNER
// ══════════════════════════════════════════════

function openScanner(mode) {
  STATE.scannerMode = mode;
  const labels = {
    'stock':        ['สแกน — อัปเดตสต็อก',  'สแกน Barcode เพื่ออัปเดตจำนวน'],
    'shopping':     ['สแกน — รายการซื้อ',    'สแกน Barcode เพื่อเพิ่มในรายการสั่งซื้อ'],
    'fill-barcode': ['สแกน Barcode',         'สแกนเพื่อกรอกรหัส Barcode'],
  };
  const [t, s] = labels[mode] || labels['stock'];
  document.getElementById('scanner-title').textContent = t;
  document.getElementById('scanner-subtitle').textContent = s;
  document.getElementById('scanner-sheet').classList.remove('hidden');
  setTimeout(() => startScanner(), 300);
}

function startScanner() {
  if (STATE.html5QrCode) { try { STATE.html5QrCode.stop(); } catch(e) {} }
  const qr = new Html5Qrcode('qr-reader');
  STATE.html5QrCode = qr;
  STATE.scannerOpen = true;
  qr.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: { width: 220, height: 120 }, aspectRatio: 1.0 },
    (decoded) => { vibrate([50,30,50]); handleBarcodeScan(decoded); },
    () => {}
  ).catch(() => showToast('ไม่สามารถเข้าถึงกล้องได้', 'error'));
}

function closeScanner() {
  STATE.scannerOpen = false;
  if (STATE.html5QrCode) { STATE.html5QrCode.stop().catch(()=>{}); STATE.html5QrCode = null; }
  document.getElementById('scanner-sheet').classList.add('hidden');
  document.getElementById('manual-barcode').value = '';
}

function submitManualBarcode() {
  const val = document.getElementById('manual-barcode').value.trim();
  if (val) handleBarcodeScan(val);
}

function handleBarcodeScan(barcode) {
  closeScanner();
  barcode = barcode.trim();
  if (STATE.scannerMode === 'fill-barcode') {
    document.getElementById('product-barcode').value = barcode;
    showToast(`รหัส: ${barcode}`, 'success'); return;
  }
  if (STATE.scannerMode === 'shopping') {
    const p = STATE.products.find(x => x.barcode === barcode);
    if (p) { toggleShoppingItem(p.id); showToast(`เพิ่ม "${p.name}" แล้ว`, 'success'); }
    else showToast(`ไม่พบ Barcode: ${barcode}`, 'warning'); return;
  }
  const p = STATE.products.find(x => x.barcode === barcode);
  if (p) openQuickUpdate(p.id);
  else { showToast('ไม่พบ Barcode — เพิ่มสินค้าใหม่', 'info'); setTimeout(()=>openProductSheet(null, barcode), 400); }
}

// ══════════════════════════════════════════════
// PRODUCT CRUD
// ══════════════════════════════════════════════

function addNewProduct() { openProductSheet(null, ''); }

function openProductSheet(product, prefill = '') {
  STATE.editingProduct = product || null;
  const isEdit = !!product;
  document.getElementById('product-sheet-title').textContent = isEdit ? 'แก้ไขสินค้า' : 'เพิ่มสินค้าใหม่';
  document.getElementById('save-btn-text').textContent       = isEdit ? 'บันทึกการแก้ไข' : 'บันทึกสินค้า';
  document.getElementById('product-id').value       = product?.id      || '';
  document.getElementById('product-name').value     = product?.name    || '';
  document.getElementById('product-category').value = product?.category|| '';
  document.getElementById('product-qty').value      = product?.qty     ?? '';
  document.getElementById('product-low').value      = product?.lowThreshold ?? '';
  document.getElementById('product-unit').value     = product?.unit    || '';
  document.getElementById('product-barcode').value  = product?.barcode || prefill;
  document.getElementById('product-note').value     = product?.note    || '';
  document.getElementById('product-img-data').value = product?.imageData || '';
  updateImgPreview(product?.imageData || null);
  document.getElementById('product-sheet').classList.remove('hidden');
  lucide.createIcons();
}

function closeProductSheet() {
  document.getElementById('product-sheet').classList.add('hidden');
  STATE.editingProduct = null;
}

async function saveProduct() {
  const name = document.getElementById('product-name').value.trim();
  if (!name) { showToast('กรุณาใส่ชื่อสินค้า', 'error'); return; }
  const btn = document.getElementById('save-btn-text');
  btn.textContent = 'กำลังบันทึก…';

  const productData = {
    id:           STATE.editingProduct?.id || genId(),
    name,
    category:     document.getElementById('product-category').value.trim(),
    qty:          parseInt(document.getElementById('product-qty').value) || 0,
    lowThreshold: parseInt(document.getElementById('product-low').value) || CONFIG.LOW_STOCK_DEFAULT,
    unit:         document.getElementById('product-unit').value.trim() || 'ชิ้น',
    barcode:      document.getElementById('product-barcode').value.trim(),
    note:         document.getElementById('product-note').value.trim(),
    imageData:    document.getElementById('product-img-data').value || null,
    createdAt:    STATE.editingProduct?.createdAt || Date.now(),
    updatedAt:    Date.now(),
  };

  try {
    if (STATE.editingProduct) {
      const idx = STATE.products.findIndex(p => p.id === STATE.editingProduct.id);
      if (idx >= 0) STATE.products[idx] = productData;
      await DB.updateProduct(productData.id, productData);
      await DB.insertHistory({ productId: productData.id, productName: productData.name, oldQty: STATE.editingProduct.qty, newQty: productData.qty, delta: productData.qty - STATE.editingProduct.qty, type: 'edit' });
      showToast('บันทึกการแก้ไขแล้ว', 'success');
    } else {
      STATE.products.push(productData);
      await DB.insertProduct(productData);
      await DB.insertHistory({ productId: productData.id, productName: productData.name, oldQty: null, newQty: productData.qty, delta: productData.qty, type: 'new' });
      showToast(`เพิ่ม "${productData.name}" แล้ว`, 'success');
    }
  } catch (err) {
    if (err.message === 'BARCODE_DUPLICATE') {
      showToast('Barcode นี้มีอยู่แล้วในระบบ', 'error');
      btn.textContent = STATE.editingProduct ? 'บันทึกการแก้ไข' : 'บันทึกสินค้า';
      return;
    }
    showToast('เกิดข้อผิดพลาด', 'error');
  }
  closeProductSheet();
  renderPage(STATE.currentPage);
}

function deleteProduct(id) {
  openConfirm('ยืนยันการลบ', 'ต้องการลบสินค้านี้ออกจากระบบ?', async () => {
    STATE.products     = STATE.products.filter(p => p.id !== id);
    STATE.shoppingList = STATE.shoppingList.filter(s => s.id !== id);
    await DB.deleteProduct(id);
    closeDetailSheet();
    renderPage(STATE.currentPage);
    showToast('ลบสินค้าแล้ว', 'success');
  });
}

// ══════════════════════════════════════════════
// QUICK UPDATE
// ══════════════════════════════════════════════

function openQuickUpdate(id) {
  const p = STATE.products.find(x => x.id === id);
  if (!p) return;
  STATE.quickUpdateProduct = p;
  document.getElementById('qu-name').textContent    = p.name;
  document.getElementById('qu-barcode').textContent = p.barcode || '';
  document.getElementById('qu-current').textContent = p.qty;
  document.getElementById('qu-unit').textContent    = p.unit || '';
  document.getElementById('qu-new-qty').value       = p.qty;
  const imgEl = document.getElementById('qu-img-el');
  const icon  = document.getElementById('qu-img-icon');
  if (p.imageData) { imgEl.src = p.imageData; imgEl.classList.remove('hidden'); icon.classList.add('hidden'); }
  else { imgEl.classList.add('hidden'); icon.classList.remove('hidden'); }
  document.getElementById('quick-update-sheet').classList.remove('hidden');
  lucide.createIcons();
}

function closeQuickUpdate() {
  document.getElementById('quick-update-sheet').classList.add('hidden');
  STATE.quickUpdateProduct = null;
}

function quickAdjust(delta) {
  const input = document.getElementById('qu-new-qty');
  input.value = Math.max(0, (parseInt(input.value) || 0) + delta);
}

async function confirmQuickUpdate() {
  const p = STATE.quickUpdateProduct;
  if (!p) return;
  const newQty = Math.max(0, parseInt(document.getElementById('qu-new-qty').value) || 0);
  const delta  = newQty - p.qty;
  const oldQty = p.qty;
  const idx    = STATE.products.findIndex(x => x.id === p.id);
  if (idx >= 0) { STATE.products[idx].qty = newQty; STATE.products[idx].updatedAt = Date.now(); }
  closeQuickUpdate();
  await DB.updateQty(p.id, newQty);
  await DB.insertHistory({ productId: p.id, productName: p.name, oldQty, newQty, delta, type: 'update' });
  const changeText = delta === 0 ? 'ไม่เปลี่ยน' : delta > 0 ? `+${delta}` : `${delta}`;
  showToast(`${p.name}: ${changeText} → ${newQty} ${p.unit||'ชิ้น'}`, 'success');
  renderPage(STATE.currentPage);
}

// ══════════════════════════════════════════════
// DETAIL SHEET
// ══════════════════════════════════════════════

function openDetail(id) {
  const p = STATE.products.find(x => x.id === id);
  if (!p) return;
  STATE.detailProduct = p;
  const low      = p.qty <= (p.lowThreshold ?? CONFIG.LOW_STOCK_DEFAULT);
  const qtyColor = p.qty === 0 ? 'text-red-400' : low ? 'text-amber-400' : 'text-green-400';
  document.getElementById('detail-content').innerHTML = `
  <div class="flex gap-4 items-start">
    <div class="w-20 h-20 rounded-xl bg-surface-900 flex items-center justify-center overflow-hidden flex-none">
      ${p.imageData ? `<img src="${p.imageData}" class="w-full h-full object-cover"/>` : `<i data-lucide="package" class="w-8 h-8 text-slate-500"></i>`}
    </div>
    <div class="flex-1 min-w-0">
      <h3 class="font-bold text-base leading-tight">${escHtml(p.name)}</h3>
      ${p.category ? `<span class="inline-block bg-brand-600/20 text-brand-300 text-xs px-2 py-0.5 rounded-full mt-1">${escHtml(p.category)}</span>` : ''}
      <div class="flex items-end gap-1 mt-2">
        <span class="text-3xl font-bold font-mono ${qtyColor}">${p.qty}</span>
        <span class="text-sm text-slate-400 pb-1">${escHtml(p.unit||'ชิ้น')}</span>
      </div>
      ${low ? `<p class="text-xs text-${p.qty===0?'red':'amber'}-400 mt-0.5">${p.qty===0?'⚠ หมดสต็อก':'⚠ สต็อกต่ำ'}</p>` : ''}
    </div>
    <button onclick="deleteProduct('${p.id}')" class="w-8 h-8 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center justify-center flex-none">
      <i data-lucide="trash-2" class="w-4 h-4 text-red-400"></i>
    </button>
  </div>
  <div class="grid grid-cols-2 gap-2 text-sm">
    ${p.barcode ? `<div class="bg-surface-800 rounded-xl p-3 col-span-2"><p class="text-[10px] text-slate-400 mb-1">Barcode</p><p class="font-mono font-medium">${escHtml(p.barcode)}</p></div>` : ''}
    <div class="bg-surface-800 rounded-xl p-3"><p class="text-[10px] text-slate-400 mb-1">แจ้งเตือนที่</p><p class="font-medium">${p.lowThreshold??CONFIG.LOW_STOCK_DEFAULT} ${escHtml(p.unit||'ชิ้น')}</p></div>
    ${p.note ? `<div class="bg-surface-800 rounded-xl p-3 col-span-2"><p class="text-[10px] text-slate-400 mb-1">หมายเหตุ</p><p class="text-sm">${escHtml(p.note)}</p></div>` : ''}
    <div class="bg-surface-800 rounded-xl p-3 col-span-2"><p class="text-[10px] text-slate-400 mb-1">อัปเดตล่าสุด</p><p class="text-xs">${formatDate(p.updatedAt)}</p></div>
  </div>`;
  document.getElementById('detail-sheet').classList.remove('hidden');
  lucide.createIcons();
}

function closeDetailSheet()       { document.getElementById('detail-sheet').classList.add('hidden'); STATE.detailProduct = null; }
function editFromDetail()         { if (!STATE.detailProduct) return; const p = STATE.detailProduct; closeDetailSheet(); openProductSheet(p); }
function addToShoppingFromDetail(){ if (!STATE.detailProduct) return; toggleShoppingItem(STATE.detailProduct.id); closeDetailSheet(); navigate('shopping'); }
function quickUpdateFromDetail()  { if (!STATE.detailProduct) return; const id = STATE.detailProduct.id; closeDetailSheet(); setTimeout(()=>openQuickUpdate(id),100); }

// ══════════════════════════════════════════════
// SHOPPING LIST
// ══════════════════════════════════════════════

async function toggleShoppingItem(id) {
  const product = STATE.products.find(p => p.id === id);
  if (!product) return;
  const idx = STATE.shoppingList.findIndex(s => s.id === id);
  if (idx >= 0) {
    STATE.shoppingList.splice(idx, 1);
    await DB.removeFromShopping(id);
  } else {
    STATE.shoppingList.push({ id: product.id, name: product.name, barcode: product.barcode, unit: product.unit, qty: 1 });
    await DB.addToShopping(id, 1);
  }
  renderPage(STATE.currentPage);
}

async function changeShoppingQty(id, delta) {
  const item = STATE.shoppingList.find(s => s.id === id);
  if (!item) return;
  item.qty = Math.max(1, (item.qty || 1) + delta);
  await DB.updateShoppingQty(id, item.qty);
  renderPage(STATE.currentPage);
}

async function removeFromShopping(id) {
  STATE.shoppingList = STATE.shoppingList.filter(s => s.id !== id);
  await DB.removeFromShopping(id);
  renderPage(STATE.currentPage);
}

function clearShoppingList() {
  openConfirm('ล้างรายการ', 'ต้องการล้างรายการสั่งซื้อทั้งหมด?', async () => {
    STATE.shoppingList = [];
    await DB.clearShopping();
    renderPage(STATE.currentPage);
  });
}

async function addAllLowToShopping() {
  const low = STATE.products.filter(p => p.qty <= (p.lowThreshold ?? CONFIG.LOW_STOCK_DEFAULT));
  for (const p of low) {
    if (!STATE.shoppingList.find(s => s.id === p.id)) {
      STATE.shoppingList.push({ id: p.id, name: p.name, barcode: p.barcode, unit: p.unit, qty: 1 });
      await DB.addToShopping(p.id, 1);
    }
  }
  renderPage(STATE.currentPage);
  showToast(`เพิ่ม ${low.length} รายการแล้ว`, 'success');
}

// ══════════════════════════════════════════════
// EXPORT PDF
// ══════════════════════════════════════════════

function exportShoppingPDF() {
  if (STATE.shoppingList.length === 0) { showToast('ไม่มีรายการที่จะ Export', 'warning'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  doc.setFillColor(37,99,235); doc.rect(0,0,210,28,'F');
  doc.setTextColor(255,255,255); doc.setFontSize(18); doc.setFont('helvetica','bold');
  doc.text('StockFlow — Shopping List', 14, 12);
  doc.setFontSize(9); doc.setFont('helvetica','normal');
  doc.text(`Generated: ${new Date().toLocaleString('th-TH')}`, 14, 20);
  doc.text(`Total: ${STATE.shoppingList.length} items`, 14, 25);
  const rows = STATE.shoppingList.map((item,i) => {
    const p = STATE.products.find(x => x.id === item.id);
    return [i+1, item.name, item.barcode||'-', p ? `${p.qty} ${p.unit||'ชิ้น'}` : '-', item.qty, '☐'];
  });
  doc.autoTable({
    startY: 34,
    head: [['#','ชื่อสินค้า','Barcode','สต็อกปัจจุบัน','จำนวนสั่ง','ซื้อแล้ว']],
    body: rows,
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [30,64,175], textColor: 255 },
    alternateRowStyles: { fillColor: [248,250,252] },
    columnStyles: { 0: { cellWidth: 8 }, 5: { cellWidth: 16, halign: 'center' } },
  });
  doc.save(`shopping-list-${Date.now()}.pdf`);
  showToast('Export PDF แล้ว', 'success');
}

// ══════════════════════════════════════════════
// SEARCH
// ══════════════════════════════════════════════

let searchTimer;
function debounceSearch(query) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    STATE.searchQuery = query.trim().toLowerCase();
    STATE.filteredProducts = STATE.searchQuery
      ? STATE.products.filter(p =>
          p.name.toLowerCase().includes(STATE.searchQuery) ||
          (p.barcode && p.barcode.toLowerCase().includes(STATE.searchQuery)) ||
          (p.category && p.category.toLowerCase().includes(STATE.searchQuery))
        )
      : [];
    document.getElementById('search-clear').classList.toggle('hidden', !STATE.searchQuery);
    if (STATE.currentPage === 'dashboard') renderDashboard();
  }, CONFIG.DEBOUNCE_MS);
}

function clearSearch() {
  document.getElementById('search-input').value = '';
  STATE.searchQuery = '';
  STATE.filteredProducts = [];
  document.getElementById('search-clear').classList.add('hidden');
  if (STATE.currentPage === 'dashboard') renderDashboard();
}

function filterCategory(cat) {
  if (!cat) { clearSearch(); return; }
  STATE.searchQuery = cat.toLowerCase();
  STATE.filteredProducts = STATE.products.filter(p => (p.category||'').toLowerCase() === cat.toLowerCase());
  renderDashboard();
}

// ══════════════════════════════════════════════
// IMAGE (resize + base64)
// ══════════════════════════════════════════════

function triggerImageUpload() { document.getElementById('img-file-input').click(); }

function handleImageSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  const canvas = document.createElement('canvas');
  const ctx    = canvas.getContext('2d');
  const img    = new Image();
  const url    = URL.createObjectURL(file);
  img.onload = () => {
    const MAX = 400;
    let w = img.width, h = img.height;
    if (w > MAX || h > MAX) {
      if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
      else       { w = Math.round(w * MAX / h); h = MAX; }
    }
    canvas.width = w; canvas.height = h;
    ctx.drawImage(img, 0, 0, w, h);
    const data = canvas.toDataURL('image/jpeg', 0.75);
    document.getElementById('product-img-data').value = data;
    updateImgPreview(data);
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

function updateImgPreview(data) {
  const imgEl = document.getElementById('product-img-el');
  const icon  = document.getElementById('cam-icon');
  if (data) { imgEl.src = data; imgEl.classList.remove('hidden'); icon.classList.add('hidden'); }
  else { imgEl.classList.add('hidden'); icon.classList.remove('hidden'); }
}

// ══════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════

function openSettings() {
  document.getElementById('settings-sheet').classList.remove('hidden');
  LOCAL.loadSettings();
  lucide.createIcons();
}
function closeSettings() { document.getElementById('settings-sheet').classList.add('hidden'); }

async function saveSettings() {
  const s = {
    url: document.getElementById('setting-supabase-url').value.trim(),
    key: document.getElementById('setting-supabase-key').value.trim(),
    low: document.getElementById('setting-low-threshold').value,
  };
  localStorage.setItem('sf_settings', JSON.stringify(s));
  CONFIG.SUPABASE_URL = s.url;
  CONFIG.SUPABASE_KEY = s.key;
  if (s.low) CONFIG.LOW_STOCK_DEFAULT = parseInt(s.low);
  closeSettings();
  showToast('บันทึกแล้ว — กำลัง sync…', 'success');
  await DB.init();
  renderPage(STATE.currentPage);
}

function clearAllData() {
  openConfirm('ล้างข้อมูลทั้งหมด', 'ต้องการลบสินค้าและประวัติทั้งหมดออกจากอุปกรณ์?', () => {
    STATE.products = []; STATE.shoppingList = []; STATE.history = [];
    LOCAL.save(); closeSettings(); renderPage(STATE.currentPage);
    showToast('ล้างข้อมูลแล้ว', 'success');
  });
}

function openNotifications() {
  const low = STATE.products.filter(p => p.qty <= (p.lowThreshold ?? CONFIG.LOW_STOCK_DEFAULT));
  if (low.length === 0) { showToast('ไม่มีการแจ้งเตือน', 'info'); return; }
  navigate('shopping');
}

async function clearHistory() {
  openConfirm('ล้างประวัติ', 'ต้องการล้างประวัติทั้งหมด?', async () => {
    STATE.history = [];
    await DB.clearHistory();
    renderPage(STATE.currentPage);
  });
}

// ══════════════════════════════════════════════
// CONFIRM MODAL
// ══════════════════════════════════════════════

function openConfirm(title, msg, onOk) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-msg').textContent   = msg;
  const m = document.getElementById('confirm-modal');
  m.classList.remove('hidden'); m.classList.add('flex');
  document.getElementById('confirm-ok-btn').onclick = () => { closeConfirmModal(); onOk(); };
}
function closeConfirmModal() {
  const m = document.getElementById('confirm-modal');
  m.classList.add('hidden'); m.classList.remove('flex');
}

// ══════════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════════

function showToast(message, type = 'info') {
  const c = document.getElementById('toast-container');
  const icons  = { success:'check-circle', error:'x-circle', warning:'alert-triangle', info:'info' };
  const colors = { success:'bg-green-900/90 border-green-700', error:'bg-red-900/90 border-red-700', warning:'bg-amber-900/90 border-amber-700', info:'bg-surface-800/90 border-surface-700' };
  const texts  = { success:'text-green-200', error:'text-red-200', warning:'text-amber-200', info:'text-slate-200' };
  const el = document.createElement('div');
  el.className = `${colors[type]} ${texts[type]} border rounded-xl px-3 py-2.5 flex items-center gap-2.5 text-sm font-medium shadow-lg backdrop-blur-md pointer-events-auto fade-in`;
  el.innerHTML = `<i data-lucide="${icons[type]}" class="w-4 h-4 flex-none"></i><span>${escHtml(message)}</span>`;
  c.appendChild(el);
  lucide.createIcons({ nodes: [el] });
  setTimeout(() => { el.style.opacity='0'; el.style.transition='opacity 0.3s'; setTimeout(()=>el.remove(),300); }, 2800);
}

// ══════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════

function genId()     { return Math.random().toString(36).substr(2,9)+Date.now().toString(36); }
function escHtml(s)  { if(!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function formatDate(ts){ if(!ts) return ''; return new Date(ts).toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'}); }
function vibrate(p)  { try { navigator.vibrate?.(p); } catch(e){} }

// ══════════════════════════════════════════════
// ONLINE / OFFLINE
// ══════════════════════════════════════════════

window.addEventListener('online',  async () => { STATE.isOnline = true;  showToast('กลับมา Online แล้ว','success'); await DB.flushPending(); });
window.addEventListener('offline', ()      => { STATE.isOnline = false; showSyncStatus('offline'); showToast('ออฟไลน์ — บันทึกเฉพาะในอุปกรณ์','warning'); });

// ══════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════

async function init() {
  LOCAL.loadSettings();
  await DB.init();
  navigate('dashboard');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeScanner(); closeProductSheet(); closeQuickUpdate();
      closeDetailSheet(); closeSettings(); closeConfirmModal();
    }
  });
}

document.addEventListener('DOMContentLoaded', init);