// WasteService.gs

function getCurrentWastePrice(wasteType) {
  const prices = getSheetData(CONFIG.SHEETS.WASTE_PRICES);
  // Get active price for specific type, descending by date (assume latest is active if status is AKTIF)
  const activePrices = prices.filter(p => p.waste_type.toUpperCase() === wasteType.toUpperCase() && p.status === 'AKTIF');
  
  if (activePrices.length === 0) return null;
  
  // Sort by effective_date descending
  activePrices.sort((a, b) => new Date(b.effective_date) - new Date(a.effective_date));
  return activePrices[0];
}

function setWastePrice(token, wasteType, unit, price) {
  try {
    const session = requireRole(token, [CONFIG.ROLES.MANAGER]);
    
    // Deactivate old prices for this type
    const sheet = getSheet(CONFIG.SHEETS.WASTE_PRICES);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const typeIdx = headers.indexOf('waste_type');
    const statusIdx = headers.indexOf('status');
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][typeIdx].toUpperCase() === wasteType.toUpperCase() && data[i][statusIdx] === 'AKTIF') {
        sheet.getRange(i + 1, statusIdx + 1).setValue('NONAKTIF');
      }
    }
    
    // Add new price
    appendRow(CONFIG.SHEETS.WASTE_PRICES, [
      wasteType.toUpperCase(), unit, price, new Date(), 'AKTIF'
    ]);
    
    auditLog(session.userId, session.role, 'UPDATE_WASTE_PRICE', wasteType, `Set harga ${wasteType} ke Rp${price}/${unit}`);
    return { success: true, message: 'Harga sampah berhasil diupdate' };
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}

function getAllWastePrices(token) {
  try {
    requireRole(token, [CONFIG.ROLES.MANAGER, CONFIG.ROLES.KASIR]);
    return { success: true, data: getSheetData(CONFIG.SHEETS.WASTE_PRICES) };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

function updateWastePriceEntry(token, effectiveDateStr, dataUpdate) {
  try {
    const session = requireRole(token, [CONFIG.ROLES.MANAGER]);
    const sheet = getSheet(CONFIG.SHEETS.WASTE_PRICES);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    for (let i = 1; i < data.length; i++) {
      const rowDateStr = new Date(data[i][headers.indexOf('effective_date')]).toISOString();
      if (rowDateStr === effectiveDateStr) {
        if (dataUpdate.price !== undefined) sheet.getRange(i + 1, headers.indexOf('price') + 1).setValue(parseFloat(dataUpdate.price));
        if (dataUpdate.status !== undefined) sheet.getRange(i + 1, headers.indexOf('status') + 1).setValue(dataUpdate.status);
        
        auditLog(session.userId, session.role, 'UPDATE_WASTE_PRICE', 'EDIT', `Edit harga sampah`);
        return { success: true, message: 'Data harga berhasil diupdate' };
      }
    }
    throw new Error('Data tidak ditemukan');
  } catch(e) {
    return { success: false, message: e.message };
  }
}

function deleteWastePriceEntry(token, effectiveDateStr) {
  try {
    const session = requireRole(token, [CONFIG.ROLES.MANAGER]);
    const sheet = getSheet(CONFIG.SHEETS.WASTE_PRICES);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    for (let i = 1; i < data.length; i++) {
      const rowDateStr = new Date(data[i][headers.indexOf('effective_date')]).toISOString();
      if (rowDateStr === effectiveDateStr) {
        sheet.deleteRow(i + 1);
        auditLog(session.userId, session.role, 'DELETE_WASTE_PRICE', 'DELETE', `Hapus harga sampah`);
        return { success: true, message: 'Data harga berhasil dihapus' };
      }
    }
    throw new Error('Data tidak ditemukan');
  } catch(e) {
    return { success: false, message: e.message };
  }
}
