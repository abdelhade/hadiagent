# POS Printer Config — Desktop Agent

برنامج Electron يعمل في الخلفية على جهاز الكاشير، يتيح تعيين طابعة مخصصة لكل مجموعة أصناف.

## المتطلبات

- Node.js 18+
- Windows 10/11

## التثبيت والتشغيل

```bash
cd Modules/POS/print-agent
npm install
npm start
```

## بناء المثبّت (.exe)

1. استبدل `assets/tray-icon.png` و `assets/tray-icon.ico` بأيقونة حقيقية (16×16 PNG / ICO)
2. شغّل:

```bash
npm run build
```

3. ستجد الملف الناتج في `build/pos-printer-config Setup 1.0.0.exe`
4. انسخ الملف إلى `Modules/POS/public/downloads/pos-printer-config-setup.exe`

## متغيرات البيئة

| المتغير | الوصف | الافتراضي |
|---------|-------|-----------|
| `POS_API_URL` | رابط API المجموعات | `http://localhost/pos/api/categories` |

## هيكل الملفات

```
print-agent/
  main.js          # العملية الرئيسية (Electron main)
  preload.js       # جسر IPC
  src/
    ipc-handlers.js      # معالجات IPC
    indexeddb-reader.js  # قراءة المجموعات من IndexedDB
    printer-service.js   # جلب الطابعات من Windows
    assignment-store.js  # حفظ/تحميل إعدادات الطابعات
  renderer/
    index.html     # واجهة المستخدم
    renderer.js    # منطق الواجهة
    style.css      # تنسيق RTL
  assets/
    tray-icon.png  # أيقونة شريط المهام
```
