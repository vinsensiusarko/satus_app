// Config.gs
// Simpan Spreadsheet ID setelah generate di Setup.gs
const CONFIG = {
  // GANTI INI DENGAN SPREADSHEET ID YANG BARU DIBUAT OLEH Setup.gs
  SPREADSHEET_ID: '1vA-Gyx35b0M8ic4UwLTBA1b3irTotyQfbX_VBUQ1pZE', 
  
  // Konfigurasi Concurrency & Mutex Script Lock
  LOCK_CONFIG: {
    ENABLED: true,
    TIMEOUT_MS: 30000,
    MODE: 'MUTATION_ONLY' // 'MUTATION_ONLY' (rekomendasi) atau 'ALL_POST'
  },
  
  SHEETS: {
    USERS: 'Users',
    MEMBERS: 'Members',
    TRANSACTIONS: 'Transactions',
    WASTE_TRANSACTIONS: 'Waste_Transactions',
    PRODUCTS: 'Products',
    WASTE_PRICES: 'Waste_Prices',
    TARGETS: 'Targets',
    AUDIT_LOG: 'Audit_Log',
    SEEDS: 'Seeds',
    SEED_REQUESTS: 'Seed_Requests',
    VOID_REQUESTS: 'Void_Requests'
  },
  
  ROLES: {
    MANAGER: 'MANAGER',
    KASIR: 'KASIR',
    SISWA: 'SISWA'
  },
  
  MEMBER_STATUS: {
    MENUNGGU: 'MENUNGGU',
    AKTIF: 'AKTIF',
    NONAKTIF: 'NONAKTIF'
  },
  
  WALLET_TYPES: {
    TABUNGAN: 'TABUNGAN',
    HIJAU: 'HIJAU'
  },

  VOID_STATUS: {
    PENDING: 'PENDING',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED'
  },
  
  SEED_REQUEST_STATUS: {
    PENDING: 'PENDING',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED',
    FULFILLED: 'FULFILLED'
  },
  
  TRANSACTION_TYPES: {
    SETOR_TUNAI: 'SETOR_TUNAI',
    SETOR_PLASTIK: 'SETOR_PLASTIK',
    SETOR_JELANTAH: 'SETOR_JELANTAH',
    TARIK_TUNAI: 'TARIK_TUNAI',
    BELANJA_TABUNGAN: 'BELANJA_TABUNGAN',
    BELANJA_KOPERASI: 'BELANJA_TABUNGAN',
    TUKAR_HIJAU_ATK: 'TUKAR_HIJAU_ATK',
    AJUKAN_BIBIT: 'AJUKAN_BIBIT',
    SETUJUI_BIBIT: 'SETUJUI_BIBIT',
    TOLAK_BIBIT: 'TOLAK_BIBIT',
    REALISASI_BIBIT: 'REALISASI_BIBIT',
    KOREKSI: 'KOREKSI',
    REVERSAL: 'REVERSAL',
    REFUND: 'REFUND'
  },

  // Kredensial Khusus Lingkungan Dev/Testing (Terisolasi dari Database Produksi)
  DEV_CONFIG: {
    ENABLED: true,
    ACCOUNTS: {
      'admin-dev': {
        username: 'admin-dev',
        password: 'manager123',
        role: 'MANAGER',
        nama: 'Admin Dev (Testing)',
        userId: 'DEV-MGR-001',
        status: 'AKTIF',
        isDev: true,
        photoUrl: 'https://ui-avatars.com/api/?name=Admin+Dev&background=7c3aed&color=fff&bold=true'
      },
      'kasir-dev': {
        username: 'kasir-dev',
        password: 'kasir123',
        role: 'KASIR',
        nama: 'Kasir Dev (Testing)',
        userId: 'DEV-KSR-001',
        status: 'AKTIF',
        isDev: true,
        photoUrl: 'https://ui-avatars.com/api/?name=Kasir+Dev&background=0284c7&color=fff&bold=true'
      },
      'siswa-dev': {
        username: 'siswa-dev',
        password: 'siswa123',
        role: 'SISWA',
        nama: 'Siswa Dev (Testing)',
        userId: 'DEV-SIS-001',
        memberId: 'DEV-SIS-001',
        nis: 'DEV-001',
        kelas: 'DEV',
        status: 'AKTIF',
        isDev: true,
        photoUrl: 'https://ui-avatars.com/api/?name=Siswa+Dev&background=10b981&color=fff&bold=true'
      }
    }
  }
};

function isDevUsername(username) {
  if (!username) return false;
  const u = String(username).trim().toLowerCase();
  return u === 'admin-dev' || u === 'kasir-dev' || u === 'siswa-dev' || u.startsWith('dev-');
}

function isDevUserId(userId) {
  if (!userId) return false;
  const id = String(userId).trim().toUpperCase();
  return id.startsWith('DEV-');
}

function isDevAccount(obj) {
  if (!obj) return false;
  if (obj.isDev) return true;
  if (isDevUsername(obj.username)) return true;
  if (isDevUserId(obj.user_id) || isDevUserId(obj.userId) || isDevUserId(obj.member_id) || isDevUserId(obj.memberId)) return true;
  return false;
}

function generateMemberId() {
  const year = new Date().getFullYear();
  const sheet = getSheet(CONFIG.SHEETS.MEMBERS);
  const lastRow = sheet.getLastRow();
  // Simple sequence generation for MVP
  const seq = String(lastRow > 0 ? lastRow : 1).padStart(3, '0');
  return `KH-${year}-${seq}`;
}

function generateTransactionId() {
  const now = new Date();
  const date = Utilities.formatDate(now, 'Asia/Jakarta', 'yyyyMMdd');
  const sheet = getSheet(CONFIG.SHEETS.TRANSACTIONS);
  const lastRow = sheet.getLastRow();
  const seq = String(lastRow > 0 ? lastRow : 1).padStart(4, '0');
  const rand = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `TRX-${date}-${seq}-${rand}`;
}
