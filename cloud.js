// Firebase 云端同步（compat SDK）：登录 + Firestore 实时监听 + 离线缓存 + 旧本地数据迁移
(function () {
  "use strict";

  const fbConfig = {
    apiKey: "AIzaSyCFhWCxItaYLXtwOl2Gh4uYH09CE6oH0ds",
    authDomain: "hiepphat-finance.firebaseapp.com",
    projectId: "hiepphat-finance",
    storageBucket: "hiepphat-finance.firebasestorage.app",
    messagingSenderId: "356400225813",
    appId: "1:356400225813:web:a418120a381607bcff781c",
  };

  firebase.initializeApp(fbConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
  // 离线缓存：多标签页同步；部分环境（如个别 WebView）不支持时忽略
  db.enablePersistence({ synchronizeTabs: true }).catch(() => {});

  const COLLECTIONS = ["batches", "invoices", "payments", "kv"];
  const cloud = {
    user: null, ready: false,
    data: { batches: [], invoices: [], payments: [], kv: [] },
    listeners: [],

    login(email, password) {
      return auth.signInWithEmailAndPassword(email, password);
    },
    logout() { return auth.signOut(); },

    upsert(cname, obj) {
      const id = String(obj.id != null ? obj.id : obj.key);
      return db.collection(cname).doc(id).set(JSON.parse(JSON.stringify(obj)));
    },
    remove(cname, id) {
      return db.collection(cname).doc(String(id)).delete();
    },

    onData(cb) { this.listeners.push(cb); },
    _emit() { this.listeners.forEach(cb => cb(this.data)); },

    start() {
      COLLECTIONS.forEach(cname => {
        db.collection(cname).onSnapshot(snap => {
          this.data[cname] = snap.docs.map(d => d.data());
          this.ready = true;
          this._emit();
          if (cname === "invoices") this._maybeMigrate();
        }, err => console.warn("sync", cname, err));
      });
    },

    /* 旧版 IndexedDB（ar-web-db）一次性迁移到云端，仅在云端无发票时执行 */
    _maybeMigrate() {
      if (this._migrated || this.data.invoices.length) { this._migrated = true; return; }
      this._migrated = true;
      const openOld = () => new Promise((resolve, reject) => {
        const r = indexedDB.open("ar-web-db", 2);
        r.onsuccess = e => resolve(e.target.result);
        r.onerror = reject;
      });
      const read = (old, store) => new Promise((resolve, reject) => {
        const q = old.transaction(store).objectStore(store).getAll();
        q.onsuccess = () => resolve(q.result);
        q.onerror = reject;
      });

      (async () => {
        try {
          const old = await openOld();
          const all = {};
          for (const s of COLLECTIONS) {
            try { all[s] = await read(old, s); } catch (e) { all[s] = []; }
          }
          const total = Object.values(all).reduce((n, a) => n + a.length, 0);
          if (!total) return;
          let batch = db.batch(), count = 0;
          for (const s of COLLECTIONS) {
            for (const obj of all[s] || []) {
              const id = String(obj.id != null ? obj.id : obj.key);
              batch.set(db.collection(s).doc(id), JSON.parse(JSON.stringify(obj)));
              if (++count % 400 === 0) { await batch.commit(); batch = db.batch(); }
            }
          }
          await batch.commit();
          console.log("本地旧数据已迁移到云端：" + count);
        } catch (e) { console.warn("旧数据迁移失败：", e); }
      })();
    },
  };

  auth.onAuthStateChanged(user => {
    cloud.user = user;
    if (user) {
      if (!cloud._started) { cloud._started = true; cloud.start(); }
      document.dispatchEvent(new CustomEvent("auth-changed", { detail: { user: true } }));
    } else {
      document.dispatchEvent(new CustomEvent("auth-changed", { detail: { user: false } }));
    }
  });

  window.Cloud = cloud;
})();
