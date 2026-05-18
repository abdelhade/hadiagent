# Hadi Agent — طباعة POS (Massar)

تطبيق **Electron** يعمل على جهاز الكاشير: يستقبل أوامر الطباعة من متصفح Massar ويطبع صامتاً على طابعات Windows (مطبخ حسب المجموعة + كاشير).

## التوثيق الكامل

**[docs/POS-PRINTING.md](docs/POS-PRINTING.md)** — اقرأه قبل أي تطوير:

- معمارية النظام وتدفق البيانات
- POSDB + `print_jobs`
- واجهات HTTP و Laravel API
- الإعداد (`.env`, Token, أسماء الطابعات)
- استكشاف الأخطاء

## المتطلبات

- Node.js 18+
- Windows 10/11
- Massar يعمل محلياً (مثال: `http://127.0.0.1:8080`)

## التشغيل السريع

```bash
cd hadi-agent
npm install
npm start
```

- يحرر المنافذ `5000–5010` ثم يشغّل Agent.
- افتح Massar: `/pos/restaurant` على نفس الجهاز.
- في Agent: ⚙ → رابط Massar + Token (من `HADI_AGENT_TOKEN` في `.env`).

## أوامر npm

| الأمر | الوصف |
|-------|--------|
| `npm start` | kill-port + تشغيل Agent |
| `npm run kill-port` | إيقاف عمليات على 5000–5010 |
| `npm run build` | بناء مثبّت Windows |

## هيكل المشروع (مختصر)

```
hadi-agent/
├── main.js                 # Electron + single instance
├── src/
│   ├── local-server.js     # HTTP sync/notify
│   ├── posdb-sync.js       # كاش من المتصفح
│   ├── print-worker.js     # print_jobs + kitchen/cashier
│   └── printer-adapter.js  # Electron silent print
├── renderer/               # واجهة تشخيص وإعدادات
└── docs/POS-PRINTING.md    # التوثيق التفصيلي
```

## متغيرات Massar (`.env`)

```env
HADI_AGENT_URL=http://127.0.0.1:5000
HADI_AGENT_TOKEN=your-secret
HADI_AGENT_PORT_MIN=5000
HADI_AGENT_PORT_MAX=5010
```

## بناء المثبّت

```bash
npm run build
```

انسخ الـ `.exe` إلى `public/modules/pos/downloads/` حسب إعدادات Massar.
