/**
 * CondoKit Data Layer v1.0
 * Sistema di persistenza dati lato client per CondoKit.
 * Include: CondoKitSettings, CondoKitDB, CondoKitBackup, CondoKitUtils
 * 
 * USO: includi con <script src="condokit-data-layer.js"></script>
 * Aspetta l'evento 'condokit:ready' prima di leggere/scrivere dati.
 */

// ============================================================
// NAMESPACE 1: CondoKitSettings
// Wrapper localStorage per impostazioni e dati leggeri.
// Tutte le chiavi vengono prefissate con "condokit_".
// ============================================================
window.CondoKitSettings = {
  _prefix: 'condokit_',

  /**
   * Legge un valore dal localStorage.
   * @param {string} chiave
   * @returns {*} valore parsato o null se non esiste
   */
  get(chiave) {
    try {
      const raw = localStorage.getItem(this._prefix + chiave);
      return raw !== null ? JSON.parse(raw) : null;
    } catch (e) {
      console.error('CondoKitSettings.get errore:', e);
      return null;
    }
  },

  /**
   * Salva un valore nel localStorage.
   * @param {string} chiave
   * @param {*} valore - qualsiasi valore serializzabile in JSON
   */
  set(chiave, valore) {
    try {
      localStorage.setItem(this._prefix + chiave, JSON.stringify(valore));
    } catch (e) {
      console.error('CondoKitSettings.set errore (quota superata?):', e);
      alert('⚠️ Spazio di archiviazione esaurito. Esegui un backup ed elimina alcuni dati.');
    }
  },

  /**
   * Elimina una chiave dal localStorage.
   * @param {string} chiave
   */
  delete(chiave) {
    localStorage.removeItem(this._prefix + chiave);
  },

  /**
   * Restituisce tutte le chiavi/valori condokit_* come oggetto.
   * @returns {Object}
   */
  getAll() {
    const result = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(this._prefix)) {
        const chiavePulita = k.replace(this._prefix, '');
        result[chiavePulita] = this.get(chiavePulita);
      }
    }
    return result;
  },

  /**
   * Cancella SOLO le chiavi condokit_* (non tocca altro nel localStorage).
   */
  clear() {
    const daEliminare = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(this._prefix)) daEliminare.push(k);
    }
    daEliminare.forEach(k => localStorage.removeItem(k));
  }
};


// ============================================================
// NAMESPACE 2: CondoKitDB
// Wrapper IndexedDB per dati strutturati pesanti.
// ============================================================
window.CondoKitDB = {
  _db: null,
  _dbName: 'CondoKitDB',
  _version: 1,
  _stores: [
    { nome: 'condomini',    indici: ['cf', 'interno'] },
    { nome: 'spese',        indici: ['data', 'categoria', 'fornitore_id'] },
    { nome: 'fatture',      indici: ['numero', 'data', 'stato'] },
    { nome: 'verbali',      indici: ['data', 'tipo'] },
    { nome: 'ticket',       indici: ['stato', 'priorita', 'condomino_id', 'data'] },
    { nome: 'documenti',    indici: ['categoria', 'data'] },
    { nome: 'manutenzioni', indici: ['impianto_id', 'data_prossima'] },
    { nome: 'convocazioni', indici: ['data', 'tipo'] }
  ],

  /**
   * Apre (o crea) il database IndexedDB.
   * Va chiamato una volta all'avvio — lo fa automaticamente l'init in fondo al file.
   * @returns {Promise<IDBDatabase>}
   */
  init() {
    return new Promise((resolve, reject) => {
      if (this._db) { resolve(this._db); return; }

      const request = indexedDB.open(this._dbName, this._version);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        this._stores.forEach(({ nome, indici }) => {
          if (!db.objectStoreNames.contains(nome)) {
            const store = db.createObjectStore(nome, { keyPath: 'id' });
            indici.forEach(idx => {
              store.createIndex(idx, idx, { unique: false });
            });
          }
        });
      };

      request.onsuccess = (event) => {
        this._db = event.target.result;
        resolve(this._db);
      };

      request.onerror = (event) => {
        console.error('CondoKitDB.init errore:', event.target.error);
        reject(event.target.error);
      };
    });
  },

  /**
   * Salva o aggiorna un oggetto in uno store.
   * Se oggetto.id è assente, ne genera uno automaticamente.
   * Aggiunge createdAt e updatedAt automaticamente.
   * @param {string} store - nome dello store
   * @param {Object} oggetto
   * @returns {Promise<string>} id dell'oggetto salvato
   */
  save(store, oggetto) {
    return new Promise(async (resolve, reject) => {
      try {
        await this.init();
        const ora = new Date().toISOString();
        const record = { ...oggetto };
        if (!record.id) {
          record.id = CondoKitUtils.generateId();
          record.createdAt = ora;
        }
        record.updatedAt = ora;

        const tx = this._db.transaction(store, 'readwrite');
        const req = tx.objectStore(store).put(record);
        req.onsuccess = () => resolve(record.id);
        req.onerror = (e) => reject(e.target.error);
      } catch (e) {
        console.error(`CondoKitDB.save(${store}) errore:`, e);
        reject(e);
      }
    });
  },

  /**
   * Restituisce un singolo record per ID.
   * @param {string} store
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  getById(store, id) {
    return new Promise(async (resolve, reject) => {
      try {
        await this.init();
        const tx = this._db.transaction(store, 'readonly');
        const req = tx.objectStore(store).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = (e) => reject(e.target.error);
      } catch (e) {
        console.error(`CondoKitDB.getById(${store}) errore:`, e);
        reject(e);
      }
    });
  },

  /**
   * Restituisce tutti i record di uno store.
   * @param {string} store
   * @returns {Promise<Array>}
   */
  getAll(store) {
    return new Promise(async (resolve, reject) => {
      try {
        await this.init();
        const tx = this._db.transaction(store, 'readonly');
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = (e) => reject(e.target.error);
      } catch (e) {
        console.error(`CondoKitDB.getAll(${store}) errore:`, e);
        reject(e);
      }
    });
  },

  /**
   * Elimina un record per ID.
   * @param {string} store
   * @param {string} id
   * @returns {Promise<void>}
   */
  delete(store, id) {
    return new Promise(async (resolve, reject) => {
      try {
        await this.init();
        const tx = this._db.transaction(store, 'readwrite');
        const req = tx.objectStore(store).delete(id);
        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(e.target.error);
      } catch (e) {
        console.error(`CondoKitDB.delete(${store}) errore:`, e);
        reject(e);
      }
    });
  },

  /**
   * Cerca record in uno store usando un indice.
   * @param {string} store
   * @param {string} nomeIndice - deve corrispondere a un indice creato in _stores
   * @param {*} valore
   * @returns {Promise<Array>}
   */
  query(store, nomeIndice, valore) {
    return new Promise(async (resolve, reject) => {
      try {
        await this.init();
        const tx = this._db.transaction(store, 'readonly');
        const idx = tx.objectStore(store).index(nomeIndice);
        const req = idx.getAll(valore);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = (e) => reject(e.target.error);
      } catch (e) {
        console.error(`CondoKitDB.query(${store}, ${nomeIndice}) errore:`, e);
        reject(e);
      }
    });
  },

  /**
   * Conta i record in uno store.
   * @param {string} store
   * @returns {Promise<number>}
   */
  count(store) {
    return new Promise(async (resolve, reject) => {
      try {
        await this.init();
        const tx = this._db.transaction(store, 'readonly');
        const req = tx.objectStore(store).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e.target.error);
      } catch (e) {
        reject(e);
      }
    });
  },

  /**
   * Svuota completamente uno store.
   * @param {string} store
   * @returns {Promise<void>}
   */
  clear(store) {
    return new Promise(async (resolve, reject) => {
      try {
        await this.init();
        const tx = this._db.transaction(store, 'readwrite');
        const req = tx.objectStore(store).clear();
        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(e.target.error);
      } catch (e) {
        reject(e);
      }
    });
  }
};


// ============================================================
// NAMESPACE 3: CondoKitBackup
// Export/Import di tutti i dati come file JSON.
// ============================================================
window.CondoKitBackup = {

  /**
   * Esporta tutti i dati (localStorage + IndexedDB) in un file JSON.
   * Il file viene scaricato automaticamente nel browser.
   * @returns {Promise<void>}
   */
  async export() {
    try {
      const storeNames = CondoKitDB._stores.map(s => s.nome);
      const dbData = {};
      for (const store of storeNames) {
        dbData[store] = await CondoKitDB.getAll(store);
      }

      const backup = {
        metadata: {
          app: 'CondoKit',
          versione: '1.0.0',
          dataExport: new Date().toISOString(),
          browser: navigator.userAgent
        },
        settings: CondoKitSettings.getAll(),
        db: dbData
      };

      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `condokit-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Salva data ultimo backup
      CondoKitSettings.set('ultimoBackup', new Date().toISOString());
      console.log('✅ Backup esportato con successo');
    } catch (e) {
      console.error('CondoKitBackup.export errore:', e);
      alert('❌ Errore durante l\'export del backup. Riprova.');
    }
  },

  /**
   * Importa dati da un file JSON di backup.
   * @param {File} file - oggetto File dal file picker
   * @returns {Promise<{successo: boolean, recordImportati: number}>}
   */
  async import(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const backup = JSON.parse(e.target.result);

          // Validazione
          if (!backup.metadata || backup.metadata.app !== 'CondoKit') {
            alert('❌ File non valido. Seleziona un backup generato da CondoKit.');
            reject(new Error('File non valido'));
            return;
          }

          const conferma = confirm(
            `⚠️ ATTENZIONE\n\nStai per importare un backup del ${new Date(backup.metadata.dataExport).toLocaleDateString('it-IT')}.\n\nQuesta operazione sovrascriverà TUTTI i dati attuali.\n\nVuoi continuare?`
          );
          if (!conferma) { resolve({ successo: false, recordImportati: 0 }); return; }

          // Ripristina settings
          CondoKitSettings.clear();
          if (backup.settings) {
            Object.entries(backup.settings).forEach(([k, v]) => CondoKitSettings.set(k, v));
          }

          // Ripristina IndexedDB
          let totaleRecord = 0;
          if (backup.db) {
            for (const [store, records] of Object.entries(backup.db)) {
              await CondoKitDB.clear(store);
              for (const record of records) {
                await CondoKitDB.save(store, record);
                totaleRecord++;
              }
            }
          }

          console.log(`✅ Import completato: ${totaleRecord} record ripristinati`);
          resolve({ successo: true, recordImportati: totaleRecord });
        } catch (err) {
          console.error('CondoKitBackup.import errore:', err);
          alert('❌ Errore durante l\'import. Il file potrebbe essere corrotto.');
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('Impossibile leggere il file'));
      reader.readAsText(file);
    });
  }
};


// ============================================================
// NAMESPACE 4: CondoKitUtils
// Funzioni di utilità riutilizzabili in tutte le pagine.
// ============================================================
window.CondoKitUtils = {

  /**
   * Formatta un numero come valuta Euro italiana.
   * @param {number} numero
   * @returns {string} es: "€ 1.234,50"
   */
  formatEuro(numero) {
    return new Intl.NumberFormat('it-IT', {
      style: 'currency', currency: 'EUR'
    }).format(numero || 0);
  },

  /**
   * Formatta una data ISO in formato italiano lungo.
   * @param {string} dateString
   * @returns {string} es: "15 marzo 2025"
   */
  formatData(dateString) {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleDateString('it-IT', {
      day: 'numeric', month: 'long', year: 'numeric'
    });
  },

  /**
   * Formatta una data ISO in formato italiano breve.
   * @param {string} dateString
   * @returns {string} es: "15/03/2025"
   */
  formatDataBreve(dateString) {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleDateString('it-IT');
  },

  /**
   * Genera un ID univoco.
   * @returns {string} UUID v4
   */
  generateId() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    // Fallback per browser molto vecchi
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  },

  /**
   * Valida un codice fiscale italiano (algoritmo completo).
   * @param {string} cf
   * @returns {boolean}
   */
  validateCF(cf) {
    if (!cf || typeof cf !== 'string') return false;
    cf = cf.toUpperCase().trim();
    if (cf.length !== 16) return false;
    if (!/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST]{1}[0-9LMNPQRSTUV]{2}[A-Z]{1}[0-9LMNPQRSTUV]{3}[A-Z]{1}$/.test(cf)) return false;

    const valoriPari = { 0:0,1:1,2:2,3:3,4:4,5:5,6:6,7:7,8:8,9:9,
      A:0,B:1,C:2,D:3,E:4,F:5,G:6,H:7,I:8,J:9,K:10,L:11,M:12,
      N:13,O:14,P:15,Q:16,R:17,S:18,T:19,U:20,V:21,W:22,X:23,Y:24,Z:25 };
    const valoriDispari = { 0:1,1:0,2:5,3:7,4:9,5:13,6:15,7:17,8:19,9:21,
      A:1,B:0,C:5,D:7,E:9,F:13,G:15,H:17,I:19,J:21,K:2,L:4,M:18,
      N:20,O:11,P:3,Q:6,R:8,S:12,T:14,U:16,V:10,W:22,X:25,Y:24,Z:23 };

    let somma = 0;
    for (let i = 0; i < 15; i++) {
      somma += (i % 2 === 0) ? valoriDispari[cf[i]] : valoriPari[cf[i]];
    }
    return String.fromCharCode(65 + (somma % 26)) === cf[15];
  },

  /**
   * Valida un IBAN italiano.
   * @param {string} iban
   * @returns {boolean}
   */
  validateIBAN(iban) {
    if (!iban) return false;
    iban = iban.replace(/\s/g, '').toUpperCase();
    if (!/^IT\d{2}[A-Z0-9]{23}$/.test(iban)) return false;
    // Checksum mod97
    const rearranged = iban.slice(4) + iban.slice(0, 4);
    const numeric = rearranged.split('').map(c =>
      isNaN(c) ? (c.charCodeAt(0) - 55).toString() : c
    ).join('');
    let remainder = 0;
    for (let i = 0; i < numeric.length; i++) {
      remainder = (remainder * 10 + parseInt(numeric[i])) % 97;
    }
    return remainder === 1;
  },

  /**
   * Valida un indirizzo email.
   * @param {string} email
   * @returns {boolean}
   */
  validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '');
  },

  /**
   * Valida un numero di telefono italiano (fisso o mobile).
   * @param {string} tel
   * @returns {boolean}
   */
  validateTelefono(tel) {
    return /^(\+39)?[\s\-]?3\d{8,9}$|^(\+39)?[\s\-]?0\d{5,10}$/.test((tel || '').trim());
  },

  /**
   * Tronca un testo aggiungendo "..." se supera maxLength.
   * @param {string} testo
   * @param {number} maxLength
   * @returns {string}
   */
  truncateText(testo, maxLength) {
    if (!testo || testo.length <= maxLength) return testo || '';
    return testo.slice(0, maxLength) + '...';
  },

  /**
   * Crea una versione "debounced" di una funzione.
   * Utile per la ricerca live: evita chiamate ad ogni tasto.
   * @param {Function} fn
   * @param {number} ms - millisecondi di attesa
   * @returns {Function}
   */
  debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }
};


// ============================================================
// INIZIALIZZAZIONE AUTOMATICA
// Si esegue quando il DOM è pronto.
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Apri il database
    await CondoKitDB.init();

    // Imposta valori default al primo avvio
    if (!CondoKitSettings.get('versione')) {
      CondoKitSettings.set('versione', '1.0.0');
      CondoKitSettings.set('dataInstallazione', new Date().toISOString());
      CondoKitSettings.set('nomeCondominio', '');
      CondoKitSettings.set('codiceFiscale', '');
      CondoKitSettings.set('indirizzoCondominio', '');
      CondoKitSettings.set('amministratore', { nome: '', email: '', telefono: '', cf: '' });
      CondoKitSettings.set('logoBase64', null);
      console.log('🆕 CondoKit: primo avvio, impostazioni default create.');
    }

    console.log('✅ CondoKit Data Layer pronto.');

    // Segnala a tutte le pagine che il sistema è pronto
    document.dispatchEvent(new CustomEvent('condokit:ready'));

  } catch (e) {
    console.error('❌ CondoKit Data Layer: errore di inizializzazione:', e);
  }
});
