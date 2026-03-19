# PlanQR Backend

Backend dla systemu **PlanQR**, odpowiedzialny za logowanie (LDAP ZUT), obsługę planu zajęć, komunikację oraz zarządzanie urządzeniami w salach.

## 🚀 Instalacja i Uruchomienie

1. **Zainstaluj zależności:**
   ```bash
   npm install
   ```

2. **Baza danych:**
   Baza danych jest tworzona "w locie" przy użyciu komendy `db push` (nie używamy katalogu `migrations`).
   Aby zsynchronizować schemat z bazą danych:
   ```bash
   npx prisma db push
   npx prisma generate
   ```

3. **Uruchomienie (tryb deweloperski):**
   ```bash
   npm run dev
   ```
   Serwer uruchomi się na porcie `9099`. Dokumentacja API ukaże się pod adresem: `http://localhost:9099/api/docs`.

## ⚙️ Konfiguracja (Plik `.env` lub Docker)

Aby backend działał prawidłowo, skopiuj `.env.example` do `.env` lub ustaw zmienne środowiskowe, np. w `docker-compose.yml`.

### Ważne zmienne – LDAP ZUT

Logowanie jest zintegrowane z uczelnianym systemem LDAP. Aby działało, backend musi mieć dostęp do sieci uczelnianej (np. VPN).

```env
# LDAP ZUT
LDAP_URL="ldap://ldap.zut.edu.pl"
LDAP_DN="uid=%s,cn=users,cn=accounts,dc=zut,dc=edu,dc=pl"

# Baza Danych
DATABASE_URL="postgresql://admin:admin123@localhost:2137/planqr_db?schema=public"

# Ustawienia serwera
PORT=9099
```

## 🐳 Docker

Projekt można łatwo odpalić jako część całego systemu przy użyciu pliku `docker-compose.yml` (znajdującego się w głównym katalogu).
Baza to standardowy PostgreSQL. W razie problemów w trakcie developmentu wystarczy po usunięciu bazy wywołać `npx prisma db push`.

## 🔒 Certyfikaty SSL (HTTPS)

Wrzuć certyfikaty (`cert.pem`, `key.pem`) do wymaganego folderu `certs/` w głównym katalogu.
Folder ten jest ignorowany przez gita (poza plikiem `.gitkeep`), więc certyfikaty nie trafią do repozytorium.