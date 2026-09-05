// BalanceService.gs

function isTabunganTx(t) {
  if (t.wallet_type) return t.wallet_type === CONFIG.WALLET_TYPES.TABUNGAN;
  return t.type === 'SETOR_TUNAI' || t.type === 'TARIK_TUNAI' || t.type === 'BELANJA_KOPERASI' || t.type === 'BELANJA_TABUNGAN';
}

function isHijauTx(t) {
  if (t.wallet_type) return t.wallet_type === CONFIG.WALLET_TYPES.HIJAU;
  return t.type === 'SETOR_PLASTIK' || t.type === 'SETOR_JELANTAH' || t.type === 'TUKAR_HIJAU_ATK' || t.type === 'SETUJUI_BIBIT';
}

function calculateTabungan(memberId) {
  const transactions = getSheetData(CONFIG.SHEETS.TRANSACTIONS)
    .filter(t => t.member_id === memberId && t.status === 'COMPLETED' && isTabunganTx(t));

  const totalCredit = transactions.reduce((sum, t) => sum + (parseFloat(t.credit) || 0), 0);
  const totalDebit = transactions.reduce((sum, t) => sum + (parseFloat(t.debit) || 0), 0);

  return totalCredit - totalDebit;
}

function calculateHijau(memberId) {
  const transactions = getSheetData(CONFIG.SHEETS.TRANSACTIONS)
    .filter(t => t.member_id === memberId && t.status === 'COMPLETED' && isHijauTx(t));

  const totalCredit = transactions.reduce((sum, t) => sum + (parseFloat(t.credit) || 0), 0);
  const totalDebit = transactions.reduce((sum, t) => sum + (parseFloat(t.debit) || 0), 0);

  return totalCredit - totalDebit;
}

function calculateDualBalance(memberId) {
  const tabungan = calculateTabungan(memberId);
  const hijau = calculateHijau(memberId);
  return {
    tabungan: tabungan,
    hijau: hijau,
    total: tabungan + hijau
  };
}

// Legacy alias to calculateTabungan
function calculateBalance(memberId) {
  return calculateTabungan(memberId);
}

function validateTabungan(memberId, amount) {
  const balance = calculateTabungan(memberId);
  if (balance < amount) {
    return {
      valid: false,
      balance: balance,
      walletType: 'TABUNGAN',
      message: `TRANSAKSI DITOLAK\nSaldo Tabungan tidak mencukupi.\n\nSaldo Tabungan tersedia:\nRp${balance.toLocaleString('id-ID')}`
    };
  }
  return { valid: true, balance: balance, walletType: 'TABUNGAN' };
}

function validateHijau(memberId, amount) {
  const balance = calculateHijau(memberId);
  if (balance < amount) {
    return {
      valid: false,
      balance: balance,
      walletType: 'HIJAU',
      message: `TRANSAKSI DITOLAK\nSaldo Hijau tidak mencukupi.\n\nSaldo Hijau tersedia:\nRp${balance.toLocaleString('id-ID')}`
    };
  }
  return { valid: true, balance: balance, walletType: 'HIJAU' };
}

function validateSufficientBalance(memberId, amount, walletType) {
  if (walletType === CONFIG.WALLET_TYPES.HIJAU) {
    return validateHijau(memberId, amount);
  }
  return validateTabungan(memberId, amount);
}

