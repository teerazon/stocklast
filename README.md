# StockFlow 📦
> ระบบจัดการสต็อกสินค้า Mobile-First PWA

## โครงสร้างไฟล์

```
stockflow/
├── index.html          ← App Shell + UI Layout
├── app.js              ← JavaScript Logic ทั้งหมด
├── manifest.json       ← PWA Manifest (Add to Home Screen)
├── sw.js               ← Service Worker (Offline Support)
├── vercel.json         ← Vercel Deployment Config
├── supabase-schema.sql ← SQL สำหรับสร้าง Supabase Tables
└── icons/
    ├── icon-192.png    ← PWA Icon (ต้องสร้างเอง)
    └── icon-512.png    ← PWA Icon (ต้องสร้างเอง)
```

---

## 🚀 วิธี Deploy บน Vercel

### 1. เตรียม Icons
สร้างหรือหา icon PNG 2 ขนาด แล้วใส่ใน `icons/`:
- `icon-192.png` (192×192px)
- `icon-512.png` (512×512px)

### 2. Push ไป GitHub
```bash
git init
git add .
git commit -m "initial: StockFlow PWA"
git remote add origin https://github.com/YOUR_USER/stockflow.git
git push -u origin main
```

### 3. Deploy บน Vercel
1. ไปที่ [vercel.com](https://vercel.com) → **New Project**
2. Import GitHub repository
3. Framework preset: **Other**
4. Build command: *(ว่างไว้)*
5. Output directory: `.` (root)
6. กด **Deploy**

---

## 🗄️ ตั้งค่า Supabase (ไม่บังคับ — ใช้ localStorage ก็ได้)

### 1. สร้าง Project ใหม่
ไปที่ [supabase.com](https://supabase.com) → New Project

### 2. รัน SQL Schema
ไปที่ **SQL Editor** แล้วรัน `supabase-schema.sql` ทั้งหมด

### 3. กรอก Keys ใน App
เปิดแอป → ⚙️ Settings → ใส่:
- **Supabase URL**: `https://xxxx.supabase.co`
- **Supabase Anon Key**: `eyJ...`

### 4. สร้าง Storage Bucket
**Storage** → **New Bucket** → ชื่อ `product-images`

---

## 📱 ติดตั้งเป็นแอป (PWA)

### iOS (Safari)
1. เปิดเว็บในแอป **Safari**
2. กด **Share** → **Add to Home Screen**
3. กด **Add**

### Android (Chrome)
1. เปิดเว็บใน **Chrome**
2. กด menu (⋮) → **Add to Home Screen**
3. หรือรอ banner "Install app" ปรากฏอัตโนมัติ

---

## ✨ Features

| Feature | สถานะ |
|---------|--------|
| Dashboard สินค้า + Stats | ✅ |
| ค้นหา + Debounce 320ms | ✅ |
| กรอง Category | ✅ |
| สแกน Barcode (Camera) | ✅ |
| เพิ่ม/แก้ไข/ลบสินค้า | ✅ |
| อัปโหลดรูปสินค้า | ✅ |
| Quick Update (±1, ±10) | ✅ |
| Low Stock Alert | ✅ |
| Shopping List | ✅ |
| Export PDF | ✅ |
| ประวัติการอัปเดต | ✅ |
| Offline Support (SW) | ✅ |
| PWA (Add to Home Screen) | ✅ |
| Supabase Integration | 🔧 ตั้งค่า Keys |

---

## 🔧 เพิ่ม Supabase Sync (Optional)

ใน `app.js` ฟังก์ชัน `DB.save()` และ `DB.load()` ปัจจุบันใช้ **localStorage**
หากต้องการ sync กับ Supabase ให้เพิ่ม API calls ด้านล่างนี้:

```js
async function syncToSupabase() {
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_KEY) return;
  const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/products`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': CONFIG.SUPABASE_KEY,
      'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`,
      'Prefer': 'resolution=merge-duplicates'
    },
    body: JSON.stringify(STATE.products)
  });
  return res.ok;
}
```

---

## 📞 Support
Built with ❤️ using HTML5 + Tailwind CSS + Vanilla JS
