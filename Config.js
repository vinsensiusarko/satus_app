// Config.gs
// Simpan Spreadsheet ID setelah generate di Setup.gs
const CONFIG = {
  // GANTI INI DENGAN SPREADSHEET ID YANG BARU DIBUAT OLEH Setup.gs
  SPREADSHEET_ID: '1vA-Gyx35b0M8ic4UwLTBA1b3irTotyQfbX_VBUQ1pZE', 
  
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
  }
};

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
  return `TRX-${date}-${seq}`;
}
