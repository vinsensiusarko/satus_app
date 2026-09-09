// ProductService.gs

function addProduct(token, data) {
  try {
    const session = requireRole(token, [CONFIG.ROLES.MANAGER]);
    const productId = 'PRD-' + Date.now().toString().slice(-6);
    const price = parseFloat(data.price);
    const greenPrice = data.green_price !== undefined && data.green_price !== '' ? parseFloat(data.green_price) : price;
    
    appendRow(CONFIG.SHEETS.PRODUCTS, [
      productId, data.name, data.category, price, greenPrice, parseInt(data.stock, 10), 'AKTIF'
    ]);
    
    auditLog(session.userId, session.role, 'ADD_PRODUCT', productId, `Tambah produk: ${data.name}`);
    return { success: true, message: 'Produk berhasil ditambahkan' };
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}

function updateProduct(token, productId, dataUpdate) {
  try {
    const session = requireRole(token, [CONFIG.ROLES.MANAGER]);
    const sheet = getSheet(CONFIG.SHEETS.PRODUCTS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][headers.indexOf('product_id')] === productId) {
        if (dataUpdate.name !== undefined) sheet.getRange(i + 1, headers.indexOf('product_name') + 1).setValue(dataUpdate.name);
        if (dataUpdate.category !== undefined) sheet.getRange(i + 1, headers.indexOf('category') + 1).setValue(dataUpdate.category);
        if (dataUpdate.price !== undefined) sheet.getRange(i + 1, headers.indexOf('price') + 1).setValue(parseFloat(dataUpdate.price));
        if (dataUpdate.green_price !== undefined) sheet.getRange(i + 1, headers.indexOf('green_price') + 1).setValue(parseFloat(dataUpdate.green_price));
        if (dataUpdate.stock !== undefined) sheet.getRange(i + 1, headers.indexOf('stock') + 1).setValue(parseInt(dataUpdate.stock, 10));
        
        delete cachedSheetData[CONFIG.SHEETS.PRODUCTS];
        auditLog(session.userId, session.role, 'UPDATE_PRODUCT', productId, `Update produk: ${dataUpdate.name || productId}`);
        return { success: true, message: 'Produk berhasil diupdate' };
      }
    }
    throw new Error('Produk tidak ditemukan');
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}

function getProductList(token) {
  try {
    requireRole(token, [CONFIG.ROLES.MANAGER, CONFIG.ROLES.KASIR, CONFIG.ROLES.SISWA]);
    const products = getSheetData(CONFIG.SHEETS.PRODUCTS).filter(p => p.status === 'AKTIF');
    return { success: true, data: products };
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}

function createBelanja(token, memberId, items, walletType) {
  // items = [{productId, qty}]
  // walletType = 'TABUNGAN' | 'HIJAU' (defaults to 'TABUNGAN')
  return withScriptLock(function() {
    try {
      const session = requireRole(token, [CONFIG.ROLES.KASIR]);
      const member = getMemberById(memberId);
      if (!member || member.status !== CONFIG.MEMBER_STATUS.AKTIF) throw new Error('Anggota tidak aktif');
      
      const selectedWallet = walletType === CONFIG.WALLET_TYPES.HIJAU ? CONFIG.WALLET_TYPES.HIJAU : CONFIG.WALLET_TYPES.TABUNGAN;
      const products = getSheetData(CONFIG.SHEETS.PRODUCTS);
      let totalAmount = 0;
      const validatedItems = [];
      
      // Validation
      for (let item of items) {
        const prod = products.find(p => p.product_id === item.productId && p.status === 'AKTIF');
        if (!prod) throw new Error(`Produk ${item.productId} tidak ditemukan atau tidak aktif`);
        if (prod.stock < item.qty) throw new Error(`Stok ${prod.product_name} tidak mencukupi (sisa ${prod.stock})`);
        
        const itemPrice = selectedWallet === CONFIG.WALLET_TYPES.HIJAU 
          ? (parseFloat(prod.green_price) || parseFloat(prod.price) || 0)
          : (parseFloat(prod.price) || 0);

        totalAmount += (itemPrice * item.qty);
        validatedItems.push({ ...prod, itemPrice: itemPrice, qty: item.qty });
      }
      
      // Validasi Saldo sesuai wallet yang dipilih
      if (selectedWallet === CONFIG.WALLET_TYPES.HIJAU) {
        const balanceCheck = validateHijau(memberId, totalAmount);
        if (!balanceCheck.valid) throw new Error(balanceCheck.message);
      } else {
        const balanceCheck = validateTabungan(memberId, totalAmount);
        if (!balanceCheck.valid) throw new Error(balanceCheck.message);
      }
      
      // Execute
      const txId = generateTransactionId();
      const now = new Date();
      
      const descDetails = validatedItems.map(item => `${item.product_name} (${item.qty}x)`).join(', ');
      const txType = selectedWallet === CONFIG.WALLET_TYPES.HIJAU 
        ? CONFIG.TRANSACTION_TYPES.TUKAR_HIJAU_ATK 
        : CONFIG.TRANSACTION_TYPES.BELANJA_TABUNGAN;

      const finalDesc = `${selectedWallet === CONFIG.WALLET_TYPES.HIJAU ? 'Tukar ATK Hijau' : 'Belanja Koperasi'}: ${descDetails}`;
      
      appendRow(CONFIG.SHEETS.TRANSACTIONS, [
        txId, now, memberId, txType, selectedWallet,
        0, totalAmount, totalAmount, session.userId,
        finalDesc, 'COMPLETED'
      ]);
      
      // Update stock
      const sheet = getSheet(CONFIG.SHEETS.PRODUCTS);
      const data = sheet.getDataRange().getValues();
      const headers = data[0];
      const idIdx = headers.indexOf('product_id');
      const stockIdx = headers.indexOf('stock');
      
      for (let item of validatedItems) {
        for (let i = 1; i < data.length; i++) {
          if (data[i][idIdx] === item.product_id) {
            const newStock = data[i][stockIdx] - item.qty;
            sheet.getRange(i + 1, stockIdx + 1).setValue(newStock);
            break;
          }
        }
      }
      
      delete cachedSheetData[CONFIG.SHEETS.PRODUCTS];
      
      auditLog(session.userId, session.role, 'CREATE_TRANSACTION', txId, `${txType} Rp${totalAmount} oleh ${memberId} (${selectedWallet})`);
      
      const dualBalance = calculateDualBalance(memberId);
      return { 
        success: true, 
        message: `${selectedWallet === CONFIG.WALLET_TYPES.HIJAU ? 'Tukar ATK' : 'Belanja'} berhasil`, 
        transactionId: txId, 
        walletType: selectedWallet,
        totalAmount: totalAmount,
        dualBalance: dualBalance,
        newBalance: selectedWallet === CONFIG.WALLET_TYPES.HIJAU ? dualBalance.hijau : dualBalance.tabungan 
      };
    } catch (error) {
      if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
    }
  });
}

