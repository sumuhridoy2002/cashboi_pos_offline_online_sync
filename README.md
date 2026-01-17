# Cashboi POS (Offline + Online Sync)

A lightweight Point of Sale (POS) system built for small businesses, shops, and kiosks.  
It works **offline first**, and automatically syncs **back to the server** whenever internet becomes available.

---

## 🚀 Features

- **Offline Sales**
  Make sales smoothly even without internet using IndexedDB/LocalStorage.

- **Automatic Sync**
  When you're back online, invoices, customers, and stock updates sync to the server.

- **Customer & Product Cache**
  Data loads instantly — no need to wait for API calls every time.

- **Background Queue System**
  Failed requests stay in queue until synced.

- **Fallback UI**
  App automatically detects network status and changes UI.

---

## 🛠️ Technology Stack

- HTML, CSS, JavaScript
- IndexedDB / LocalStorage
- REST API (CodeIgniter backend)
- AJAX / Fetch
- JSON Sync Layer