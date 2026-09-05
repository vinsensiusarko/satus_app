# 📱 SATUS Mobile Authentication API
**Sistem Aplikasi Tabungan Siswa & Sirkular Sampah (SATUS - Kantong Hijau)**  
*SMP Muhammadiyah 1 Magetan • INOTEK Award 2026*

API ini dirancang khusus untuk menghubungkan backend Google Apps Script dengan aplikasi Flutter **Satus Mobile** (`satus_mobile`). Seluruh request dapat dikirim via HTTP `POST` (rekomendasi) atau `GET`.

---

## 🌐 1. Base URL Endpoint
Endpoint API adalah URL Web App Deployment Google Apps Script:
```text
https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec
```

> **Tips:** Pastikan saat deploy di Google Apps Script:
> - **Execute as:** `Me (akun Google pemilik script)`
> - **Who has access:** `Anyone (Siapa saja)` agar aplikasi Flutter dapat mengakses tanpa hambatan CORS/Auth Google.

---

## 🔑 2. Fitur & Keamanan
1. **Role-Based Authentication**:
   - `MANAGER`: Pimpinan/Admin dengan hak akses monitoring dampak, persetujuan bibit, persetujuan pembatalan, dan kelola staf.
   - `KASIR`: Petugas transaksi koperasi, penimbangan sampah plastik & jelantah, setor/tarik tunai, dan penukaran ATK.
   - `SISWA`: Siswa dengan akses data ganda saldo (Tabungan Tunai & Saldo Hijau), target tabungan, dan QR Code identitas. Siswa dapat login menggunakan **Username**, **Member ID (KH-...)**, atau **NIS**.
2. **Stateless HMAC-SHA256 Token**:
   - Token tahan terhadap restart server, valid selama 14 hari.
   - Caching otomatis via `CacheService` untuk performa respons super cepat.
3. **Role Enforcement**:
   - Jika pengguna memilih login sebagai Manager namun memasukkan akun Siswa, API otomatis menolak dengan error `ROLE_MISMATCH` dan pesan yang ramah pengguna.
4. **Audit Trail**:
   - Setiap kali user login atau logout via mobile app, aktivitas otomatis tercatat di Google Sheets `Audit_Log`.

---

## 📋 3. Daftar Endpoint & Payload API

### A. Health Check / Ping
Memastikan server API aktif dan dapat dijangkau dari HP/Emulator.
- **Method:** `GET` atau `POST`
- **Request:**
  ```text
  GET https://script.google.com/macros/s/<ID>/exec?action=ping
  ```
  atau JSON body:
  ```json
  {
    "action": "ping"
  }
  ```
- **Response Sukses:**
  ```json
  {
    "success": true,
    "message": "SATUS Mobile API is online",
    "data": {
      "app": "SATUS - Kantong Hijau",
      "institution": "SMP Muhammadiyah 1 Magetan",
      "version": "1.0.0",
      "availableRoles": ["MANAGER", "KASIR", "SISWA"],
      "method": "POST",
      "serverTime": "2026-09-06T05:10:00.000Z"
    },
    "meta": {
      "timestamp": "2026-09-06T05:10:00.000Z",
      "apiVersion": "1.0.0",
      "system": "SATUS Mobile API"
    }
  }
  ```

---

### B. Login Berdasarkan Role (`login`)
Login fleksibel dengan validasi role sesuai tab login di Flutter.

#### 1. Login Role SISWA
Mendukung input **Username**, **Member ID** (contoh: `KH-2026-001`), atau **NIS**. Mengembalikan langsung saldo terkini (Tabungan & Hijau) serta target tabungan.
- **Method:** `POST`
- **Request Body:**
  ```json
  {
    "action": "login",
    "role": "SISWA",
    "username": "putri",
    "password": "password123"
  }
  ```
  *(Dapat juga menggunakan endpoint langsung: `action: "login_siswa"`)*
- **Response Sukses:**
  ```json
  {
    "success": true,
    "message": "Login berhasil sebagai SISWA. Selamat datang, Putri Lestari!",
    "data": {
      "userId": "KH-2026-001",
      "memberId": "KH-2026-001",
      "username": "putri",
      "nama": "Putri Lestari",
      "role": "SISWA",
      "status": "AKTIF",
      "photoUrl": "https://lh3.googleusercontent.com/d/...",
      "member": {
        "memberId": "KH-2026-001",
        "nis": "202601",
        "kelas": "8A",
        "registeredAt": "2026-09-01T08:00:00.000Z",
        "status": "AKTIF",
        "qrData": "KH-2026-001"
      },
      "balances": {
        "saldoTabungan": 75000,
        "saldoHijau": 35000,
        "totalSaldo": 110000,
        "formatted": {
          "saldoTabungan": "Rp 75.000",
          "saldoHijau": "Rp 35.000",
          "totalSaldo": "Rp 110.000"
        }
      },
      "target": {
        "targetId": "TGT-1788540000",
        "name": "Beli Sepatu Sekolah",
        "amount": 150000,
        "currentSaved": 75000,
        "progressPercent": 50,
        "isReached": false
      },
      "permissions": {
        "canViewBalance": true,
        "canViewHistory": true,
        "canRequestSeed": true,
        "canSetTarget": true,
        "canUseQrCode": true
      },
      "token": "eyJ1c2VySWQiOiJ...signature"
    }
  }
  ```

#### 2. Login Role KASIR
- **Method:** `POST`
- **Request Body:**
  ```json
  {
    "action": "login",
    "role": "KASIR",
    "username": "kasir1",
    "password": "password123"
  }
  ```
  *(Dapat juga menggunakan endpoint langsung: `action: "login_kasir"`)*
- **Response Sukses:**
  ```json
  {
    "success": true,
    "message": "Login berhasil sebagai KASIR. Selamat datang, Kasir Utama!",
    "data": {
      "userId": "STF-102938",
      "username": "kasir1",
      "nama": "Kasir Utama",
      "role": "KASIR",
      "status": "AKTIF",
      "photoUrl": "https://ui-avatars.com/api/?name=Kasir+Utama...",
      "permissions": {
        "canScanMember": true,
        "canProcessTransaction": true,
        "canWeighWaste": true,
        "canCashDepositWithdraw": true,
        "canShoppingKoperasi": true,
        "canExchangeAtk": true,
        "canFulfillSeed": true,
        "canRequestVoid": true,
        "canViewCashierHistory": true
      },
      "token": "eyJ1c2VySWQiOiJ...signature"
    }
  }
  ```

#### 3. Login Role MANAGER
- **Method:** `POST`
- **Request Body:**
  ```json
  {
    "action": "login",
    "role": "MANAGER",
    "username": "admin",
    "password": "password123"
  }
  ```
  *(Dapat juga menggunakan endpoint langsung: `action: "login_manager"`)*
- **Response Sukses:**
  ```json
  {
    "success": true,
    "message": "Login berhasil sebagai MANAGER. Selamat datang, Manager SATUS!",
    "data": {
      "userId": "STF-000001",
      "username": "admin",
      "nama": "Manager SATUS",
      "role": "MANAGER",
      "status": "AKTIF",
      "photoUrl": "https://ui-avatars.com/api/?name=Manager...",
      "permissions": {
        "canManageMembers": true,
        "canApproveMembers": true,
        "canApproveVoid": true,
        "canApproveSeed": true,
        "canManageSeeds": true,
        "canEditSeedTarget": true,
        "canManageStaff": true,
        "canManageWastePrices": true,
        "canManageProducts": true,
        "canViewFinancialReports": true,
        "canViewImpactReport": true,
        "canViewAuditLogs": true
      },
      "token": "eyJ1c2VySWQiOiJ...signature"
    }
  }
  ```

#### 4. Contoh Response Gagal (Validasi Role / Password)
- **Role Mismatch:**
  ```json
  {
    "success": false,
    "error_code": "ROLE_MISMATCH",
    "message": "Akun ini terdaftar sebagai KASIR, bukan MANAGER. Silakan gunakan menu login yang sesuai."
  }
  ```
- **Password Salah:**
  ```json
  {
    "success": false,
    "error_code": "INVALID_PASSWORD",
    "message": "Password yang Anda masukkan salah."
  }
  ```

---

### C. Verifikasi Token / Auto-Login Splash Screen (`verify_token`)
Dipanggil saat aplikasi Flutter dibuka pertama kali di Splash Screen untuk memeriksa apakah token di `SharedPreferences` masih aktif.
- **Method:** `POST`
- **Request Body:**
  ```json
  {
    "action": "verify_token",
    "token": "eyJ1c2VySWQiOiJ...signature",
    "role": "SISWA" // Opsional: pastikan token sesuai role yang diharapkan
  }
  ```
- **Response Sukses:** Mengembalikan profil data terbaru pengguna dan status akun.
- **Response Gagal:** Mengembalikan `error_code: "INVALID_TOKEN"` jika token kedaluwarsa, sehingga aplikasi otomatis mengarahkan ke halaman login.

---

### D. Ambil Profil Terbaru (`profile`)
Mengambil data profil dan saldo terkini saat pull-to-refresh di dashboard.
- **Method:** `POST`
- **Request Body:**
  ```json
  {
    "action": "profile",
    "token": "eyJ1c2VySWQiOiJ...signature"
  }
  ```

---

### E. Ganti Password (`change_password`)
- **Method:** `POST`
- **Request Body:**
  ```json
  {
    "action": "change_password",
    "token": "eyJ1c2VySWQiOiJ...signature",
    "old_password": "passwordLama",
    "new_password": "passwordBaru123"
  }
  ```

---

### F. Logout (`logout`)
- **Method:** `POST`
- **Request Body:**
  ```json
  {
    "action": "logout",
    "token": "eyJ1c2VySWQiOiJ...signature"
  }
  ```

---

## 🚀 4. Contoh Integrasi di Flutter (GetX + HTTP)

Berikut contoh implementasi service authentication yang siap disalin ke proyek `satus_mobile`:

### `lib/app/core/helper/auth_service.dart`
```dart
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AuthService {
  // Ganti URL ini dengan URL Web App Deployment Google Apps Script Anda
  static const String baseUrl = 'https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec';

  /// Login berdasarkan Role (MANAGER, KASIR, SISWA)
  static Future<Map<String, dynamic>> login({
    required String identifier,
    required String password,
    required String role,
  }) async {
    try {
      final response = await http.post(
        Uri.parse(baseUrl),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'action': 'login',
          'role': role,
          'identifier': identifier,
          'password': password,
        }),
      );

      final data = jsonDecode(response.body);
      if (data['success'] == true) {
        // Simpan token & role ke SharedPreferences
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('auth_token', data['data']['token'] ?? '');
        await prefs.setString('user_role', data['data']['role'] ?? role);
        await prefs.setString('user_nama', data['data']['nama'] ?? '');
      }
      return data;
    } catch (e) {
      return {
        'success': false,
        'message': 'Gagal terhubung ke server: $e',
      };
    }
  }

  /// Verifikasi sesi aktif di Splash Screen
  static Future<Map<String, dynamic>> verifyToken() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('auth_token');
      if (token == null || token.isEmpty) {
        return {'success': false, 'message': 'Belum ada sesi login'};
      }

      final response = await http.post(
        Uri.parse(baseUrl),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'action': 'verify_token',
          'token': token,
        }),
      );

      return jsonDecode(response.body);
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  /// Logout
  static Future<void> logout() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('auth_token');
      if (token != null && token.isNotEmpty) {
        await http.post(
          Uri.parse(baseUrl),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({
            'action': 'logout',
            'token': token,
          }),
        );
      }
      await prefs.clear();
    } catch (_) {}
  }
}
```

### Integrasi di `LoginController` GetX (`satus_mobile`)
```dart
import 'package:get/get.dart';
import 'package:fluttertoast/fluttertoast.dart';
import '../../core/helper/auth_service.dart';

class LoginController extends GetxController {
  var selectedRole = 'SISWA'.obs; // Default role
  var isLoading = false.obs;

  void changeRole(String role) {
    selectedRole.value = role;
  }

  Future<void> submitLogin(String identifier, String password) async {
    if (identifier.isEmpty || password.isEmpty) {
      Fluttertoast.showToast(msg: 'Username dan password wajib diisi');
      return;
    }

    isLoading.value = true;
    final result = await AuthService.login(
      identifier: identifier,
      password: password,
      role: selectedRole.value,
    );
    isLoading.value = false;

    if (result['success'] == true) {
      Fluttertoast.showToast(msg: result['message'] ?? 'Login berhasil');
      
      // Navigasi sesuai role
      final role = result['data']['role'];
      if (role == 'SISWA') {
        Get.offAllNamed('/home-siswa');
      } else if (role == 'KASIR') {
        Get.offAllNamed('/home-kasir');
      } else if (role == 'MANAGER') {
        Get.offAllNamed('/home-manager');
      }
    } else {
      Fluttertoast.showToast(msg: result['message'] ?? 'Login gagal');
    }
  }
}
```
