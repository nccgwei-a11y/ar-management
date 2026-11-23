// Firebase 云端同步：登录 + Firestore 实时监听 + 离线缓存 + 旧本地数据迁移
import { initializeApp } from "./lib/firebase/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  setPersistence, browserLocalPersistence,
} from "./lib/firebase/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, onSnapshot, doc, setDoc, deleteDoc, getDocs, writeBatch,
} from "./lib/firebase/firebase-firestore.js";

const fbConfig = {
  apiKey: "AIzaSyCFhWCxItaYLXtwOl2Gh4uYH09CE6oH0ds",
  authDomain: "hiepphat-finance.firebaseapp.com",
  projectId: "hiepphat-finance",
  storageBucket: "hiepphat-finance.firebasestorage.app",
  messagingSenderId: "356400225813",
  appId: "1:356400225813:web:a418120a381607bcff781c",
};

const app = initializeApp(fbConfig);
const auth = getAuth(app);
try { await setPersistence(auth, browserLocalPersistence); } catch (e) { /* 已登录态忽略 */ }
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

const COLLECTIONS = ["batches", "invoices", "payments", "kv"];
const cloud = {
  user: null, ready: false,
  data: { batches: [], invoices: [], payments: [], kv: [] },
  listeners: [],

  async login(email, password) {
    await signInWithEmailAndPassword(auth, email, password);
  },
  async logout() { await signOut(auth); },

  upsert(cname, obj) {
    return setDoc(doc(db, cname, String(obj.id ?? obj.key)), JSON.parse(JSON.stringify(obj)));
  },
  remove(cname, id) { return deleteDoc(doc(db, cname, String(id))); },

  onData(cb) { this.listeners.push(cb); },
  _emit() { this.listeners.forEach(cb => cb(this.data)); },

  start() {
    let loaded = 0;
    COLLECTIONS.forEach(cname => {
      onSnapshot(collection(db, cname), snap => {
        this.data[cname] = snap.docs.map(d => d.data());
        loaded++;
        this.ready = true;
        this._emit();
        if (cname === "invoices") this._maybeMigrate();
      }, err => console.warn("sync", cname, err));
    });
  },

  /* 旧版 IndexedDB（ar-web-db）一次性迁移到云端，仅在云端无发票时执行 */
  async _maybeMigrate() {
    if (this._migrated || this.data.invoices.length) { this._migrated = true; return; }
    this._migrated = true;
    try {
      const old = await new Promise((resolve, reject) => {
        const r = indexedDB.open("ar-web-db", 2);
        r.onsuccess = e => resolve(e.target.result);
        r.onerror = reject;
      });
      const read = store => new Promise((resolve, reject) => {
        const tx = old.transaction(store).objectStore(store).getAll();
        tx.onsuccess = () => resolve(tx.result);
        tx.onerror = reject;
      });
      const all = {};
      for (const s of ["batches", "invoices", "payments", "kv"]) {
        try { all[s] = await read(s); } catch (e) { all[s] = []; }
      }
      const total = Object.values(all).reduce((n, a) => n + a.length, 0);
      if (!total) return;
      let batch = writeBatch(db), count = 0;
      for (const s of COLLECTIONS) {
        for (const obj of all[s] || []) {
          const id = String(obj.id ?? obj.key);
          batch.set(doc(db, s, id), JSON.parse(JSON.stringify(obj)));
          if (++count % 400 === 0) { await batch.commit(); batch = writeBatch(db); }
        }
      }
      await batch.commit();
      console.log("本地旧数据已迁移到云端：", count);
    } catch (e) { console.warn("旧数据迁移失败：", e); }
  },
};

onAuthStateChanged(auth, user => {
  cloud.user = user;
  if (user) {
    if (!cloud._started) { cloud._started = true; cloud.start(); }
    document.dispatchEvent(new CustomEvent("auth-changed", { detail: { user: true } }));
  } else {
    document.dispatchEvent(new CustomEvent("auth-changed", { detail: { user: false } }));
  }
});

window.Cloud = cloud;
