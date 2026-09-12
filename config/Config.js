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
    VOID_REQUESTS: 'Void_Requests',
    APP_VERSION: 'App_Version'
  },
  
  // Konfigurasi Default Versi Mobile App (Fallback)
  APP_VERSION_DEFAULT: {
    config_key: 'ANDROID',
    latest_version: '1.0.0',
    latest_build_number: 1,
    min_required_version: '1.0.0',
    min_required_build_number: 1,
    is_required: false,
    update_title: 'Pembaruan SATUS Mobile Tersedia',
    release_notes: 'Pembaruan stabilitas dan peningkatan performa.',
    play_store_url: 'https://play.google.com/store/apps/details?id=com.satus.app',
    is_active: true
  },
  
  // Konfigurasi Notifikasi Firebase Cloud Messaging (FCM)
  FIREBASE: {
    ENABLED: true,
    PROJECT_ID: 'satus-mobile-mhsm1',
    CHANNELS: {
      TRANSAKSI: 'satus_transaksi_channel',
      APPROVAL: 'satus_approval_channel',
      INFO: 'satus_info_channel',
      CHAT: 'satus_chat_channel'
    }
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
  return u === 'admin-dev' || u === 'kasir-dev' || u === 'siswa-dev' ||
         u.startsWith('dev-') || u.endsWith('-dev') || u.includes('dev-') ||
         u === 'admindev' || u === 'kasirdev' || u === 'siswadev';
}

function isDevUserId(userId) {
  if (!userId) return false;
  const id = String(userId).trim().toUpperCase();
  return id.startsWith('DEV-') || id.startsWith('DEV_') || id.endsWith('-DEV') ||
         id === 'DEV' || id === 'DEV-SIS-001' || id === 'DEV-MGR-001' || id === 'DEV-KSR-001' ||
         id === 'SISWA-DEV' || id === 'ADMIN-DEV' || id === 'KASIR-DEV';
}

function isDevAccount(obj) {
  if (!obj) return false;
  if (typeof obj === 'string' || typeof obj === 'number') {
    const s = String(obj).trim().toLowerCase();
    return isDevUsername(s) || isDevUserId(s) || s.includes('siswa dev') || s.includes('siswa-dev') || s.includes('admin-dev') || s.includes('kasir-dev');
  }
  if (obj.isDev === true || obj.is_dev === true) return true;
  
  // 1. Cek username
  if (isDevUsername(obj.username)) return true;
  
  // 2. Cek user_id / member_id / qr_data
  const idCandidates = [obj.user_id, obj.userId, obj.member_id, obj.memberId, obj.id, obj.qr_data, obj.qrData];
  for (let i = 0; i < idCandidates.length; i++) {
    const val = idCandidates[i];
    if (val) {
      if (isDevUserId(val) || isDevUsername(val)) return true;
    }
  }

  // 3. Cek Nama Akun
  const nameCandidates = [obj.nama, obj.name, obj.full_name, obj.displayName];
  for (let i = 0; i < nameCandidates.length; i++) {
    const val = nameCandidates[i];
    if (val) {
      const n = String(val).trim().toLowerCase();
      if (n === 'siswa dev' || n === 'siswa-dev' || n === 'admin dev' || n === 'admin-dev' || n === 'kasir dev' || n === 'kasir-dev') return true;
      if (n.includes('siswa dev') || n.includes('siswa-dev') || n.includes('admin dev') || n.includes('admin-dev') || n.includes('kasir dev') || n.includes('kasir-dev') || n.includes('(testing)')) return true;
    }
  }

  // 4. Cek NIS & Kelas (khusus data member/siswa)
  if (obj.nis) {
    const nis = String(obj.nis).trim().toUpperCase();
    if (nis === 'DEV-001' || nis === 'DEV' || nis.startsWith('DEV-') || nis.includes('DEV')) return true;
  }
  if (obj.kelas) {
    const kelas = String(obj.kelas).trim().toUpperCase();
    if (kelas === 'DEV' || kelas.includes('DEV')) return true;
  }

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
