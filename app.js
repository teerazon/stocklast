/* ─────────────────────────────────────────────
   StockFlow — app.js
   Supabase-ready Stock Management System
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
  scannerMode: 'stock', // 'stock' | 'shopping' | 'fill-barcode'
  editingProduct: null,
  detailProduct: null,
  quickUpdateProduct: null,
  html5QrCode: null,
  scannerOpen: false,
  searchQuery: '',
  filteredProducts: [],
};

// ══════════════════════════════════════════════
// STORAGE HELPERS (localStorage fallback + Supabase)
// ══════════════════════════════════════════════

const DB = {
  save() {
    localStorage.setItem('sf_products', JSON.stringify(STATE.products));
    localStorage.setItem('sf_shopping', JSON.stringify(STATE.shoppingList));
    localStorage.setItem('sf_history', JSON.stringify(STATE.history.slice(0, 200)));
  },
  load() {
    STATE.products = JSON.parse(localStorage.getItem('sf_products') || '[]');
    STATE.shoppingList = JSON.parse(localStorage.getItem('sf_shopping') || '[]');
    STATE.history = JSON.parse(localStorage.getItem('sf_history') || '[]');
  },
  loadSettings() {
    const s = JSON.parse(localStorage.getItem('sf_settings') || '{}');
    if (s.url) CONFIG.SUPABASE_URL = s.url;
    if (s.key) CONFIG.SUPABASE_KEY = s.key;
    if (s.low) CONFIG.LOW_STOCK_DEFAULT = parseInt(s.low);
    const urlEl = document.getElementById('setting-supabase-url');
    const keyEl = document.getElementById('setting-supabase-key');
    const lowEl = document.getElementById('setting-low-threshold');
    if (urlEl) urlEl.value = s.url || '';
    if (keyEl) keyEl.value = s.key || '';
    if (lowEl) lowEl.value = s.low || '5';
  }
};

// ══════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════

function navigate(page) {
  STATE.currentPage = page;
  // Update tabs
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.remove('active');
    b.querySelector('.tab-icon-bg')?.classList.remove('bg-brand-600');
  });
  const activeTab = document.getElementById(`tab-${page}`);
  if (activeTab) activeTab.classList.add('active');

  // Show/hide search bar
  const searchBar = document.getElementById('search-bar');
  searchBar.style.display = page === 'dashboard' ? '' : 'none';

  // FAB visibility
  const fab = document.getElementById('fab');
  fab.style.display = page === 'dashboard' ? '' : 'none';

  renderPage(page);
}

function renderPage(page) {
  const content = document.getElementById('page-content');
  content.innerHTML = '';
  if (page === 'dashboard') renderDashboard();
  else if (page === 'shopping') renderShopping();
  else if (page === 'history') renderHistory();
  lucide.createIcons();
}

// ══════════════════════════════════════════════
// DASHBOARD PAGE
// ══════════════════════════════════════════════

function renderDashboard() {
  const content = document.getElementById('page-content');
  const products = STATE.searchQuery
    ? STATE.filteredProducts
    : STATE.products;

  const lowStockCount = STATE.products.filter(p => p.qty <= (p.lowThreshold ?? CONFIG.LOW_STOCK_DEFAULT)).length;

  // Update notification badge
  const badge = document.getElementById('notif-badge');
  if (lowStockCount > 0) {
    badge.textContent = lowStockCount;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }

  let html = `<div class="p-4 space-y-4">`;

  // Stats row
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
        <p class="text-2xl font-bold font-mono ${lowStockCount > 0 ? 'text-red-400' : 'text-green-400'}">${lowStockCount}</p>
        <p class="text-[10px] text-slate-400 mt-0.5">สต็อกต่ำ</p>
      </div>
    </div>`;

    // Low stock alert banner
    if (lowStockCount > 0) {
      html += `
      <button onclick="navigate('shopping')" class="w-full bg-red-500/10 border border-red-500/30 rounded-xl p-3 flex items-center gap-3 text-left active:bg-red-500/20">
        <div class="w-8 h-8 bg-red-500/20 rounded-lg flex items-center justify-center flex-none">
          <i data-lucide="alert-triangle" class="w-4 h-4 text-red-400"></i>
        </div>
        <div class="min-w-0">
          <p class="text-sm font-medium text-red-300">${lowStockCount} รายการสต็อกต่ำ</p>
          <p class="text-xs text-slate-400 truncate">แตะเพื่อดูรายการที่ต้องสั่งซื้อ</p>
        </div>
        <i data-lucide="chevron-right" class="w-4 h-4 text-slate-500 flex-none ml-auto"></i>
      </button>`;
    }
  }

  // Category filter chips
  const categories = [...new Set(STATE.products.map(p => p.category).filter(Boolean))];
  if (categories.length > 0 && !STATE.searchQuery) {
    html += `
    <div class="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-hide" style="scrollbar-width:none;">
      <button onclick="filterCategory('')" id="cat-all" class="flex-none px-3 py-1.5 bg-brand-600 text-white rounded-full text-xs font-medium whitespace-nowrap">ทั้งหมด</button>
      ${categories.map(c => `<button onclick="filterCategory('${c}')" class="cat-chip flex-none px-3 py-1.5 bg-surface-800 text-slate-300 rounded-full text-xs font-medium whitespace-nowrap border border-surface-700">${c}</button>`).join('')}
    </div>`;
  }

  // Product list header
  const label = STATE.searchQuery
    ? `ผลการค้นหา "${STATE.searchQuery}" (${products.length})`
    : `สินค้าทั้งหมด (${products.length})`;
  html += `<div class="flex items-center justify-between">
    <h3 class="text-sm font-semibold text-slate-300">${label}</h3>
    <button onclick="toggleView()" id="view-toggle" class="w-8 h-8 flex items-center justify-center text-slate-400">
      <i data-lucide="layout-list" class="w-4 h-4"></i>
    </button>
  </div>`;

  // Products grid
  if (products.length === 0) {
    html += `
    <div class="flex flex-col items-center justify-center py-16 text-center">
      <div class="w-16 h-16 bg-surface-800 rounded-2xl flex items-center justify-center mb-4">
        <i data-lucide="package-open" class="w-8 h-8 text-slate-500"></i>
      </div>
      <p class="font-medium text-slate-400">${STATE.searchQuery ? 'ไม่พบสินค้า' : 'ยังไม่มีสินค้า'}</p>
      <p class="text-xs text-slate-500 mt-1">${STATE.searchQuery ? 'ลองค้นหาด้วยคำอื่น' : 'กด + เพื่อเพิ่มสินค้าใหม่'}</p>
    </div>`;
  } else {
    html += `<div class="grid grid-cols-2 gap-2.5" id="products-grid">`;
    products.forEach(p => {
      html += renderProductCard(p);
    });
    html += `</div>`;
  }

  html += `</div>`;
  content.innerHTML = html;
}

function renderProductCard(p) {
  const low = p.qty <= (p.lowThreshold ?? CONFIG.LOW_STOCK_DEFAULT);
  const qtyColor = p.qty === 0 ? 'text-red-400' : low ? 'text-amber-400' : 'text-green-400';
  const imgContent = p.imageData
    ? `<img src="${p.imageData}" class="w-full h-full object-cover" />`
    : `<i data-lucide="package" class="w-6 h-6 text-slate-500"></i>`;
  const lowBadge = low ? `<span class="absolute top-2 left-2 bg-red-500/80 backdrop-blur-sm text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5"><span class="low-stock-dot w-1.5 h-1.5 bg-white rounded-full"></span>${p.qty === 0 ? 'หมด' : 'ต่ำ'}</span>` : '';

  return `
  <div class="stock-card bg-surface-800 rounded-2xl overflow-hidden cursor-pointer border border-surface-700 hover:border-surface-600"
    onclick="openDetail('${p.id}')">
    <div class="relative bg-surface-900 flex items-center justify-center" style="aspect-ratio:1/1;">
      ${imgContent}
      ${lowBadge}
      <button onclick="event.stopPropagation(); openQuickUpdate('${p.id}')"
        class="absolute bottom-2 right-2 w-7 h-7 bg-brand-600/90 backdrop-blur-sm rounded-lg flex items-center justify-center">
        <i data-lucide="zap" class="w-3.5 h-3.5 text-white"></i>
      </button>
    </div>
    <div class="p-2.5">
      <p class="text-xs font-semibold leading-tight line-clamp-2 mb-1.5">${escHtml(p.name)}</p>
      <div class="flex items-end justify-between">
        <div>
          <span class="qty-badge ${qtyColor} text-sm font-bold">${p.qty}</span>
          <span class="text-[10px] text-slate-500 ml-0.5">${escHtml(p.unit || 'ชิ้น')}</span>
        </div>
        ${p.price ? `<span class="text-[10px] text-slate-400">฿${Number(p.price).toLocaleString()}</span>` : ''}
      </div>
      ${p.barcode ? `<p class="text-[9px] text-slate-600 font-mono mt-1 truncate">${escHtml(p.barcode)}</p>` : ''}
    </div>
  </div>`;
}

// ══════════════════════════════════════════════
// SHOPPING LIST PAGE
// ══════════════════════════════════════════════

function renderShopping() {
  const content = document.getElementById('page-content');
  const lowProducts = STATE.products.filter(p => p.qty <= (p.lowThreshold ?? CONFIG.LOW_STOCK_DEFAULT));

  let html = `<div class="p-4 space-y-4">`;

  // Action buttons
  html += `
  <div class="grid grid-cols-2 gap-2">
    <button onclick="openScanner('shopping')" class="h-11 bg-surface-800 rounded-xl text-sm font-medium flex items-center justify-center gap-2 border border-surface-700 active:bg-surface-700">
      <i data-lucide="scan-barcode" class="w-4 h-4 text-brand-400"></i> สแกนเพิ่ม
    </button>
    <button onclick="exportShoppingPDF()" class="h-11 bg-brand-600 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 active:bg-brand-700">
      <i data-lucide="download" class="w-4 h-4"></i> Export PDF
    </button>
  </div>`;

  // Low stock auto-suggest
  if (lowProducts.length > 0) {
    html += `
    <div class="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
      <div class="flex items-center gap-2 mb-2">
        <i data-lucide="alert-triangle" class="w-4 h-4 text-amber-400"></i>
        <span class="text-sm font-medium text-amber-300">แนะนำให้สั่งซื้อ (${lowProducts.length} รายการ)</span>
        <button onclick="addAllLowToShopping()" class="ml-auto text-xs text-brand-400 font-medium">เพิ่มทั้งหมด</button>
      </div>
      <div class="space-y-1.5">
        ${lowProducts.slice(0,3).map(p => `
          <div class="flex items-center gap-2">
            <span class="flex-1 text-xs text-slate-300 truncate">${escHtml(p.name)}</span>
            <span class="text-xs font-mono ${p.qty === 0 ? 'text-red-400' : 'text-amber-400'}">${p.qty} ${escHtml(p.unit||'ชิ้น')}</span>
            <button onclick="toggleShoppingItem('${p.id}')" class="w-6 h-6 rounded-lg flex items-center justify-center ${STATE.shoppingList.find(s=>s.id===p.id) ? 'bg-brand-600' : 'bg-surface-700 border border-surface-600'}">
              <i data-lucide="${STATE.shoppingList.find(s=>s.id===p.id) ? 'check' : 'plus'}" class="w-3 h-3"></i>
            </button>
          </div>`).join('')}
        ${lowProducts.length > 3 ? `<p class="text-xs text-slate-500 text-center">และอีก ${lowProducts.length - 3} รายการ</p>` : ''}
      </div>
    </div>`;
  }

  // Shopping list
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
          ${p?.imageData ? `<img src="${p.imageData}" class="w-full h-full object-cover" />` : `<i data-lucide="package" class="w-5 h-5 text-slate-500"></i>`}
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium truncate">${escHtml(item.name)}</p>
          ${item.barcode ? `<p class="text-[10px] text-slate-500 font-mono">${escHtml(item.barcode)}</p>` : ''}
        </div>
        <div class="flex items-center gap-1 flex-none">
          <button onclick="changeShoppingQty('${item.id}', -1)" class="w-7 h-7 bg-surface-700 rounded-lg flex items-center justify-center">
            <i data-lucide="minus" class="w-3 h-3"></i>
          </button>
          <span class="w-8 text-center font-mono font-bold text-sm">${item.qty || 1}</span>
          <button onclick="changeShoppingQty('${item.id}', 1)" class="w-7 h-7 bg-surface-700 rounded-lg flex items-center justify-center">
            <i data-lucide="plus" class="w-3 h-3"></i>
          </button>
          <button onclick="removeFromShopping('${item.id}')" class="w-7 h-7 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center justify-center ml-1">
            <i data-lucide="trash-2" class="w-3 h-3 text-red-400"></i>
          </button>
        </div>
      </div>`;
    });
    html += `</div>`;

    // Select products not in list
    const notInList = STATE.products.filter(p => !STATE.shoppingList.find(s => s.id === p.id));
    if (notInList.length > 0) {
      html += `
      <div class="mt-2">
        <h4 class="text-xs font-medium text-slate-400 mb-2">เพิ่มสินค้าอื่น</h4>
        <div class="space-y-1.5">
          ${notInList.slice(0,5).map(p => `
          <button onclick="toggleShoppingItem('${p.id}')" class="w-full bg-surface-800 rounded-xl p-2.5 flex items-center gap-2 border border-surface-700 active:bg-surface-700 text-left">
            <div class="w-8 h-8 rounded-lg bg-surface-900 flex items-center justify-center overflow-hidden flex-none">
              ${p.imageData ? `<img src="${p.imageData}" class="w-full h-full object-cover" />` : `<i data-lucide="package" class="w-4 h-4 text-slate-500"></i>`}
            </div>
            <span class="flex-1 text-sm truncate">${escHtml(p.name)}</span>
            <i data-lucide="plus" class="w-4 h-4 text-brand-400 flex-none"></i>
          </button>`).join('')}
        </div>
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
  const history = [...STATE.history].reverse();

  let html = `<div class="p-4 space-y-4">`;
  html += `<div class="flex items-center justify-between">
    <h3 class="text-sm font-semibold text-slate-300">ประวัติการอัปเดต</h3>
    ${history.length > 0 ? `<button onclick="clearHistory()" class="text-xs text-red-400">ล้างประวัติ</button>` : ''}
  </div>`;

  if (history.length === 0) {
    html += `
    <div class="flex flex-col items-center justify-center py-16 text-center">
      <div class="w-14 h-14 bg-surface-800 rounded-2xl flex items-center justify-center mb-3">
        <i data-lucide="clock" class="w-7 h-7 text-slate-500"></i>
      </div>
      <p class="text-sm text-slate-400">ยังไม่มีประวัติ</p>
    </div>`;
  } else {
    html += `<div class="space-y-1.5">`;
    history.slice(0, 50).forEach(h => {
      const isAdd = h.delta > 0;
      const isNew = h.type === 'new';
      const color = isNew ? 'text-brand-400' : isAdd ? 'text-green-400' : 'text-red-400';
      const icon = isNew ? 'package-plus' : isAdd ? 'trending-up' : 'trending-down';
      const delta = isNew ? 'เพิ่มใหม่' : `${isAdd ? '+' : ''}${h.delta}`;
      html += `
      <div class="bg-surface-800 rounded-xl p-3 flex items-center gap-3 border border-surface-700">
        <div class="w-8 h-8 rounded-lg ${isNew ? 'bg-brand-600/20' : isAdd ? 'bg-green-500/10' : 'bg-red-500/10'} flex items-center justify-center flex-none">
          <i data-lucide="${icon}" class="w-4 h-4 ${color}"></i>
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium truncate">${escHtml(h.productName)}</p>
          <p class="text-[10px] text-slate-500">${formatDate(h.timestamp)}</p>
        </div>
        <div class="text-right flex-none">
          <p class="text-sm font-bold font-mono ${color}">${delta}</p>
          <p class="text-[10px] text-slate-500 font-mono">${h.oldQty ?? '—'} → ${h.newQty}</p>
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
  const sheet = document.getElementById('scanner-sheet');
  const title = document.getElementById('scanner-title');
  const sub = document.getElementById('scanner-subtitle');

  const labels = {
    'stock': ['สแกน — อัปเดตสต็อก', 'สแกน Barcode เพื่ออัปเดตจำนวน'],
    'shopping': ['สแกน — รายการซื้อ', 'สแกน Barcode เพื่อเพิ่มในรายการสั่งซื้อ'],
    'fill-barcode': ['สแกน Barcode', 'สแกนเพื่อกรอกรหัส Barcode'],
  };
  [title.textContent, sub.textContent] = labels[mode] || labels['stock'];

  sheet.classList.remove('hidden');
  sheet.style.display = 'block';

  setTimeout(() => startScanner(), 300);
}

function startScanner() {
  if (STATE.html5QrCode) {
    try { STATE.html5QrCode.stop(); } catch(e) {}
  }
  const qr = new Html5Qrcode('qr-reader');
  STATE.html5QrCode = qr;
  STATE.scannerOpen = true;

  qr.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: { width: 220, height: 120 }, aspectRatio: 1.0 },
    (decodedText) => {
      vibrate([50, 30, 50]);
      handleBarcodeScan(decodedText);
    },
    () => {}
  ).catch(err => {
    showToast('ไม่สามารถเข้าถึงกล้องได้', 'error');
    console.warn('Camera error:', err);
  });
}

function closeScanner() {
  STATE.scannerOpen = false;
  if (STATE.html5QrCode) {
    STATE.html5QrCode.stop().catch(() => {});
    STATE.html5QrCode = null;
  }
  document.getElementById('scanner-sheet').classList.add('hidden');
  document.getElementById('manual-barcode').value = '';
}

function submitManualBarcode() {
  const val = document.getElementById('manual-barcode').value.trim();
  if (!val) return;
  handleBarcodeScan(val);
}

function handleBarcodeScan(barcode) {
  closeScanner();
  barcode = barcode.trim();

  if (STATE.scannerMode === 'fill-barcode') {
    document.getElementById('product-barcode').value = barcode;
    showToast(`รหัส: ${barcode}`, 'success');
    return;
  }

  if (STATE.scannerMode === 'shopping') {
    const product = STATE.products.find(p => p.barcode === barcode);
    if (product) {
      toggleShoppingItem(product.id);
      renderPage(STATE.currentPage);
      showToast(`เพิ่ม "${product.name}" ในรายการแล้ว`, 'success');
    } else {
      showToast(`ไม่พบ Barcode: ${barcode}`, 'warning');
    }
    return;
  }

  // mode === 'stock'
  const product = STATE.products.find(p => p.barcode === barcode);
  if (product) {
    openQuickUpdate(product.id);
  } else {
    // New product
    showToast(`ไม่พบ Barcode — เพิ่มสินค้าใหม่`, 'info');
    setTimeout(() => {
      openProductSheet(null, barcode);
    }, 400);
  }
}

// ══════════════════════════════════════════════
// PRODUCT CRUD
// ══════════════════════════════════════════════

function addNewProduct() {
  openProductSheet(null, '');
}

function openProductSheet(product, prefillBarcode = '') {
  STATE.editingProduct = product || null;
  const sheet = document.getElementById('product-sheet');
  const title = document.getElementById('product-sheet-title');
  const saveBtn = document.getElementById('save-btn-text');

  if (product) {
    title.textContent = 'แก้ไขสินค้า';
    saveBtn.textContent = 'บันทึกการแก้ไข';
    document.getElementById('product-id').value = product.id;
    document.getElementById('product-name').value = product.name || '';
    document.getElementById('product-category').value = product.category || '';
    document.getElementById('product-qty').value = product.qty ?? '';
    document.getElementById('product-low').value = product.lowThreshold ?? '';
    document.getElementById('product-price').value = product.price ?? '';
    document.getElementById('product-unit').value = product.unit || '';
    document.getElementById('product-barcode').value = product.barcode || '';
    document.getElementById('product-note').value = product.note || '';
    document.getElementById('product-img-data').value = product.imageData || '';
    updateImgPreview(product.imageData);
  } else {
    title.textContent = 'เพิ่มสินค้าใหม่';
    saveBtn.textContent = 'บันทึกสินค้า';
    document.getElementById('product-id').value = '';
    document.getElementById('product-name').value = '';
    document.getElementById('product-category').value = '';
    document.getElementById('product-qty').value = '';
    document.getElementById('product-low').value = '';
    document.getElementById('product-price').value = '';
    document.getElementById('product-unit').value = '';
    document.getElementById('product-barcode').value = prefillBarcode;
    document.getElementById('product-note').value = '';
    document.getElementById('product-img-data').value = '';
    updateImgPreview(null);
  }

  sheet.classList.remove('hidden');
  lucide.createIcons();
}

function closeProductSheet() {
  document.getElementById('product-sheet').classList.add('hidden');
  STATE.editingProduct = null;
}

function saveProduct() {
  const name = document.getElementById('product-name').value.trim();
  if (!name) { showToast('กรุณาใส่ชื่อสินค้า', 'error'); return; }
  const qty = parseInt(document.getElementById('product-qty').value) || 0;

  const productData = {
    id: STATE.editingProduct?.id || genId(),
    name,
    category: document.getElementById('product-category').value.trim(),
    qty,
    lowThreshold: parseInt(document.getElementById('product-low').value) || CONFIG.LOW_STOCK_DEFAULT,
    price: parseFloat(document.getElementById('product-price').value) || null,
    unit: document.getElementById('product-unit').value.trim() || 'ชิ้น',
    barcode: document.getElementById('product-barcode').value.trim(),
    note: document.getElementById('product-note').value.trim(),
    imageData: document.getElementById('product-img-data').value || null,
    createdAt: STATE.editingProduct?.createdAt || Date.now(),
    updatedAt: Date.now(),
  };

  if (STATE.editingProduct) {
    const idx = STATE.products.findIndex(p => p.id === STATE.editingProduct.id);
    if (idx >= 0) STATE.products[idx] = productData;
    logHistory(productData, 0, productData.qty, 'edit');
    showToast('บันทึกการแก้ไขแล้ว', 'success');
  } else {
    STATE.products.push(productData);
    logHistory(productData, null, productData.qty, 'new');
    showToast(`เพิ่ม "${productData.name}" แล้ว`, 'success');
  }

  DB.save();
  closeProductSheet();
  if (STATE.detailProduct?.id === productData.id) {
    STATE.detailProduct = productData;
  }
  renderPage(STATE.currentPage);
}

function deleteProduct(id) {
  openConfirm('ยืนยันการลบ', 'ต้องการลบสินค้านี้ออกจากระบบ?', () => {
    STATE.products = STATE.products.filter(p => p.id !== id);
    STATE.shoppingList = STATE.shoppingList.filter(s => s.id !== id);
    DB.save();
    closeDetailSheet();
    renderPage(STATE.currentPage);
    showToast('ลบสินค้าแล้ว', 'success');
  });
}

// ══════════════════════════════════════════════
// QUICK UPDATE
// ══════════════════════════════════════════════

function openQuickUpdate(id) {
  const product = STATE.products.find(p => p.id === id);
  if (!product) return;
  STATE.quickUpdateProduct = product;

  document.getElementById('qu-name').textContent = product.name;
  document.getElementById('qu-barcode').textContent = product.barcode || '';
  document.getElementById('qu-current').textContent = product.qty;
  document.getElementById('qu-unit').textContent = product.unit || '';
  document.getElementById('qu-new-qty').value = product.qty;

  const imgEl = document.getElementById('qu-img-el');
  const icon = document.getElementById('qu-img-icon');
  if (product.imageData) {
    imgEl.src = product.imageData;
    imgEl.classList.remove('hidden');
    icon.classList.add('hidden');
  } else {
    imgEl.classList.add('hidden');
    icon.classList.remove('hidden');
  }

  document.getElementById('quick-update-sheet').classList.remove('hidden');
  lucide.createIcons();
}

function closeQuickUpdate() {
  document.getElementById('quick-update-sheet').classList.add('hidden');
  STATE.quickUpdateProduct = null;
}

function quickAdjust(delta) {
  const input = document.getElementById('qu-new-qty');
  const current = parseInt(input.value) || 0;
  input.value = Math.max(0, current + delta);
}

function confirmQuickUpdate() {
  const product = STATE.quickUpdateProduct;
  if (!product) return;
  const newQty = Math.max(0, parseInt(document.getElementById('qu-new-qty').value) || 0);
  const delta = newQty - product.qty;

  const idx = STATE.products.findIndex(p => p.id === product.id);
  if (idx >= 0) {
    const old = STATE.products[idx].qty;
    STATE.products[idx].qty = newQty;
    STATE.products[idx].updatedAt = Date.now();
    logHistory(product, old, newQty, 'update');
  }

  DB.save();
  closeQuickUpdate();

  const changeText = delta === 0 ? 'ไม่เปลี่ยน' : delta > 0 ? `+${delta}` : `${delta}`;
  showToast(`${product.name}: ${changeText} → ${newQty} ${product.unit || 'ชิ้น'}`, 'success');
  renderPage(STATE.currentPage);
}

// ══════════════════════════════════════════════
// DETAIL SHEET
// ══════════════════════════════════════════════

function openDetail(id) {
  const product = STATE.products.find(p => p.id === id);
  if (!product) return;
  STATE.detailProduct = product;

  const low = product.qty <= (product.lowThreshold ?? CONFIG.LOW_STOCK_DEFAULT);
  const qtyColor = product.qty === 0 ? 'text-red-400' : low ? 'text-amber-400' : 'text-green-400';

  const html = `
  <div class="flex gap-4 items-start">
    <div class="w-20 h-20 rounded-xl bg-surface-900 flex items-center justify-center overflow-hidden flex-none">
      ${product.imageData ? `<img src="${product.imageData}" class="w-full h-full object-cover" />` : `<i data-lucide="package" class="w-8 h-8 text-slate-500"></i>`}
    </div>
    <div class="flex-1 min-w-0">
      <h3 class="font-bold text-base leading-tight">${escHtml(product.name)}</h3>
      ${product.category ? `<span class="inline-block bg-brand-600/20 text-brand-300 text-xs px-2 py-0.5 rounded-full mt-1">${escHtml(product.category)}</span>` : ''}
      <div class="flex items-end gap-1 mt-2">
        <span class="text-3xl font-bold font-mono ${qtyColor}">${product.qty}</span>
        <span class="text-sm text-slate-400 pb-1">${escHtml(product.unit || 'ชิ้น')}</span>
      </div>
      ${low ? `<p class="text-xs text-${product.qty === 0 ? 'red' : 'amber'}-400 mt-0.5">${product.qty === 0 ? '⚠ หมดสต็อก' : '⚠ สต็อกต่ำ'}</p>` : ''}
    </div>
    <button onclick="deleteProduct('${product.id}')" class="w-8 h-8 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center justify-center flex-none">
      <i data-lucide="trash-2" class="w-4 h-4 text-red-400"></i>
    </button>
  </div>
  
  <div class="grid grid-cols-2 gap-2 text-sm">
    ${product.barcode ? `<div class="bg-surface-800 rounded-xl p-3 col-span-2"><p class="text-[10px] text-slate-400 mb-1">Barcode</p><p class="font-mono font-medium">${escHtml(product.barcode)}</p></div>` : ''}
    ${product.price ? `<div class="bg-surface-800 rounded-xl p-3"><p class="text-[10px] text-slate-400 mb-1">ราคา</p><p class="font-mono font-medium">฿${Number(product.price).toLocaleString()}</p></div>` : ''}
    <div class="bg-surface-800 rounded-xl p-3"><p class="text-[10px] text-slate-400 mb-1">แจ้งเตือนที่</p><p class="font-medium">${product.lowThreshold ?? CONFIG.LOW_STOCK_DEFAULT} ${escHtml(product.unit||'ชิ้น')}</p></div>
    ${product.note ? `<div class="bg-surface-800 rounded-xl p-3 col-span-2"><p class="text-[10px] text-slate-400 mb-1">หมายเหตุ</p><p class="text-sm">${escHtml(product.note)}</p></div>` : ''}
    <div class="bg-surface-800 rounded-xl p-3 col-span-2"><p class="text-[10px] text-slate-400 mb-1">อัปเดตล่าสุด</p><p class="text-xs">${formatDate(product.updatedAt)}</p></div>
  </div>`;

  document.getElementById('detail-content').innerHTML = html;
  document.getElementById('detail-sheet').classList.remove('hidden');
  lucide.createIcons();
}

function closeDetailSheet() {
  document.getElementById('detail-sheet').classList.add('hidden');
  STATE.detailProduct = null;
}

function editFromDetail() {
  if (!STATE.detailProduct) return;
  const p = STATE.detailProduct;
  closeDetailSheet();
  openProductSheet(p);
}

function addToShoppingFromDetail() {
  if (!STATE.detailProduct) return;
  toggleShoppingItem(STATE.detailProduct.id);
  closeDetailSheet();
  navigate('shopping');
}

function quickUpdateFromDetail() {
  if (!STATE.detailProduct) return;
  const id = STATE.detailProduct.id;
  closeDetailSheet();
  setTimeout(() => openQuickUpdate(id), 100);
}

// ══════════════════════════════════════════════
// SHOPPING LIST HELPERS
// ══════════════════════════════════════════════

function toggleShoppingItem(id) {
  const product = STATE.products.find(p => p.id === id);
  if (!product) return;
  const idx = STATE.shoppingList.findIndex(s => s.id === id);
  if (idx >= 0) {
    STATE.shoppingList.splice(idx, 1);
  } else {
    STATE.shoppingList.push({ id: product.id, name: product.name, barcode: product.barcode, qty: 1 });
  }
  DB.save();
  renderPage(STATE.currentPage);
}

function changeShoppingQty(id, delta) {
  const item = STATE.shoppingList.find(s => s.id === id);
  if (!item) return;
  item.qty = Math.max(1, (item.qty || 1) + delta);
  DB.save();
  renderPage(STATE.currentPage);
}

function removeFromShopping(id) {
  STATE.shoppingList = STATE.shoppingList.filter(s => s.id !== id);
  DB.save();
  renderPage(STATE.currentPage);
}

function clearShoppingList() {
  openConfirm('ล้างรายการ', 'ต้องการล้างรายการสั่งซื้อทั้งหมด?', () => {
    STATE.shoppingList = [];
    DB.save();
    renderPage(STATE.currentPage);
  });
}

function addAllLowToShopping() {
  const lowProducts = STATE.products.filter(p => p.qty <= (p.lowThreshold ?? CONFIG.LOW_STOCK_DEFAULT));
  lowProducts.forEach(p => {
    if (!STATE.shoppingList.find(s => s.id === p.id)) {
      STATE.shoppingList.push({ id: p.id, name: p.name, barcode: p.barcode, qty: 1 });
    }
  });
  DB.save();
  renderPage(STATE.currentPage);
  showToast(`เพิ่ม ${lowProducts.length} รายการแล้ว`, 'success');
}

// ══════════════════════════════════════════════
// EXPORT PDF
// ══════════════════════════════════════════════

function exportShoppingPDF() {
  if (STATE.shoppingList.length === 0) {
    showToast('ไม่มีรายการที่จะ Export', 'warning');
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // Header
  doc.setFillColor(37, 99, 235);
  doc.rect(0, 0, 210, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('StockFlow — Shopping List', 14, 12);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Generated: ${new Date().toLocaleString('th-TH')}`, 14, 20);
  doc.text(`Total: ${STATE.shoppingList.length} items`, 14, 25);

  // Table
  const rows = STATE.shoppingList.map((item, i) => {
    const product = STATE.products.find(p => p.id === item.id);
    return [
      i + 1,
      item.name,
      item.barcode || '-',
      product ? `${product.qty} ${product.unit || 'ชิ้น'}` : '-',
      item.qty,
      '☐',
    ];
  });

  doc.autoTable({
    startY: 34,
    head: [['#', 'ชื่อสินค้า', 'Barcode', 'สต็อกปัจจุบัน', 'จำนวนสั่ง', 'ซื้อแล้ว']],
    body: rows,
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [30, 64, 175], textColor: 255 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
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
    if (STATE.searchQuery) {
      STATE.filteredProducts = STATE.products.filter(p =>
        p.name.toLowerCase().includes(STATE.searchQuery) ||
        (p.barcode && p.barcode.toLowerCase().includes(STATE.searchQuery)) ||
        (p.category && p.category.toLowerCase().includes(STATE.searchQuery))
      );
    } else {
      STATE.filteredProducts = [];
    }
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
  if (!cat) {
    STATE.searchQuery = '';
    STATE.filteredProducts = [];
    document.getElementById('search-input').value = '';
    renderDashboard();
    return;
  }
  STATE.searchQuery = cat.toLowerCase();
  STATE.filteredProducts = STATE.products.filter(p =>
    (p.category || '').toLowerCase() === cat.toLowerCase()
  );
  renderDashboard();
}

// ══════════════════════════════════════════════
// IMAGE HANDLING
// ══════════════════════════════════════════════

function triggerImageUpload() {
  document.getElementById('img-file-input').click();
}

function handleImageSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const data = e.target.result;
    document.getElementById('product-img-data').value = data;
    updateImgPreview(data);
  };
  reader.readAsDataURL(file);
}

function updateImgPreview(data) {
  const imgEl = document.getElementById('product-img-el');
  const icon = document.getElementById('cam-icon');
  if (data) {
    imgEl.src = data;
    imgEl.classList.remove('hidden');
    icon.classList.add('hidden');
  } else {
    imgEl.classList.add('hidden');
    icon.classList.remove('hidden');
  }
}

// ══════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════

function openSettings() {
  document.getElementById('settings-sheet').classList.remove('hidden');
  DB.loadSettings();
  lucide.createIcons();
}

function closeSettings() {
  document.getElementById('settings-sheet').classList.add('hidden');
}

function saveSettings() {
  const s = {
    url: document.getElementById('setting-supabase-url').value.trim(),
    key: document.getElementById('setting-supabase-key').value.trim(),
    low: document.getElementById('setting-low-threshold').value,
  };
  localStorage.setItem('sf_settings', JSON.stringify(s));
  if (s.url) CONFIG.SUPABASE_URL = s.url;
  if (s.key) CONFIG.SUPABASE_KEY = s.key;
  if (s.low) CONFIG.LOW_STOCK_DEFAULT = parseInt(s.low);
  closeSettings();
  showToast('บันทึกการตั้งค่าแล้ว', 'success');
}

function clearAllData() {
  openConfirm('ล้างข้อมูลทั้งหมด', 'ต้องการลบสินค้าและประวัติทั้งหมดออกจากอุปกรณ์?', () => {
    STATE.products = [];
    STATE.shoppingList = [];
    STATE.history = [];
    DB.save();
    closeSettings();
    renderPage(STATE.currentPage);
    showToast('ล้างข้อมูลแล้ว', 'success');
  });
}

function openNotifications() {
  const lowProducts = STATE.products.filter(p => p.qty <= (p.lowThreshold ?? CONFIG.LOW_STOCK_DEFAULT));
  if (lowProducts.length === 0) {
    showToast('ไม่มีการแจ้งเตือน', 'info');
    return;
  }
  navigate('shopping');
}

// ══════════════════════════════════════════════
// CONFIRM MODAL
// ══════════════════════════════════════════════

let confirmCallback = null;
function openConfirm(title, msg, onOk) {
  confirmCallback = onOk;
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-msg').textContent = msg;
  const modal = document.getElementById('confirm-modal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  document.getElementById('confirm-ok-btn').onclick = () => {
    closeConfirmModal();
    if (confirmCallback) confirmCallback();
  };
}

function closeConfirmModal() {
  const modal = document.getElementById('confirm-modal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

// ══════════════════════════════════════════════
// TOAST NOTIFICATIONS
// ══════════════════════════════════════════════

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const icons = { success: 'check-circle', error: 'x-circle', warning: 'alert-triangle', info: 'info' };
  const colors = { success: 'bg-green-900/90 border-green-700', error: 'bg-red-900/90 border-red-700', warning: 'bg-amber-900/90 border-amber-700', info: 'bg-surface-800/90 border-surface-700' };
  const textColors = { success: 'text-green-200', error: 'text-red-200', warning: 'text-amber-200', info: 'text-slate-200' };

  const el = document.createElement('div');
  el.className = `${colors[type]} ${textColors[type]} border rounded-xl px-3 py-2.5 flex items-center gap-2.5 text-sm font-medium shadow-lg backdrop-blur-md pointer-events-auto fade-in`;
  el.innerHTML = `<i data-lucide="${icons[type]}" class="w-4 h-4 flex-none"></i><span>${escHtml(message)}</span>`;
  container.appendChild(el);
  lucide.createIcons({ nodes: [el] });

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 300);
  }, 2800);
}

// ══════════════════════════════════════════════
// HISTORY
// ══════════════════════════════════════════════

function logHistory(product, oldQty, newQty, type = 'update') {
  STATE.history.push({
    id: genId(),
    productId: product.id,
    productName: product.name,
    oldQty,
    newQty,
    delta: newQty - (oldQty ?? 0),
    type,
    timestamp: Date.now(),
  });
}

function clearHistory() {
  openConfirm('ล้างประวัติ', 'ต้องการล้างประวัติทั้งหมด?', () => {
    STATE.history = [];
    DB.save();
    renderPage(STATE.currentPage);
  });
}

// ══════════════════════════════════════════════
// SEED DATA (demo)
// ══════════════════════════════════════════════

function seedDemoData() {
  if (STATE.products.length > 0) return;
  const demo = [
    { id: genId(), name: 'น้ำดื่ม Crystal 600ml', category: 'เครื่องดื่ม', qty: 24, lowThreshold: 12, price: 7, unit: 'ขวด', barcode: '8850006001234', note: '', imageData: null, createdAt: Date.now(), updatedAt: Date.now() },
    { id: genId(), name: 'บะหมี่กึ่งสำเร็จรูป MAMA', category: 'อาหาร', qty: 3, lowThreshold: 10, price: 6, unit: 'ซอง', barcode: '8850987001234', note: '', imageData: null, createdAt: Date.now(), updatedAt: Date.now() },
    { id: genId(), name: 'น้ำมันพืช ตราปทุม 1L', category: 'อาหาร', qty: 5, lowThreshold: 3, price: 55, unit: 'ขวด', barcode: '8851234560001', note: '', imageData: null, createdAt: Date.now(), updatedAt: Date.now() },
    { id: genId(), name: 'สบู่ Dove 75g', category: 'ของใช้', qty: 0, lowThreshold: 5, price: 35, unit: 'ก้อน', barcode: '8690632001234', note: 'สั่งเพิ่ม', imageData: null, createdAt: Date.now(), updatedAt: Date.now() },
    { id: genId(), name: 'ทิชชู่เปียก WET WIPES', category: 'ของใช้', qty: 8, lowThreshold: 5, price: 25, unit: 'ห่อ', barcode: '8850001009876', note: '', imageData: null, createdAt: Date.now(), updatedAt: Date.now() },
    { id: genId(), name: 'นมข้นหวาน ตรามะลิ', category: 'เครื่องดื่ม', qty: 2, lowThreshold: 6, price: 18, unit: 'กระป๋อง', barcode: '8851000009999', note: '', imageData: null, createdAt: Date.now(), updatedAt: Date.now() },
  ];
  STATE.products = demo;
  DB.save();
}

// ══════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════

function genId() {
  return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
}

function vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch(e) {}
}

// ══════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════

function init() {
  DB.load();
  DB.loadSettings();
  seedDemoData();
  navigate('dashboard');

  // Register SW
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  
  // Back button handling
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeScanner();
      closeProductSheet();
      closeQuickUpdate();
      closeDetailSheet();
      closeSettings();
      closeConfirmModal();
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
