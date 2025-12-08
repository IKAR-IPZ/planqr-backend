# PlanQR Backend

![Node.js](https://img.shields.io/badge/Node.js-v18+-green.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)
![Prisma](https://img.shields.io/badge/Prisma-ORM-rw.svg)
![License](https://img.shields.io/badge/license-ISC-lightgrey.svg)

Backend dla systemu **PlanQR**, odpowiedzialny za logowanie (LDAP ZUT), obsługę planu zajęć, komunikację oraz zarządzanie urządzeniami w salach. Przepisany i zmodernizowany z oryginalnej wersji C#.

## � Spis Treści

- [Wymagania](#-wymagania)
- [Instalacja](#-instalacja)
- [Konfiguracja](#-konfiguracja)
- [Uruchomienie](#-uruchomienie)
- [API i Dokumentacja](#-api-i-dokumentacja)
- [Struktura Projektu](#-struktura-projektu)

## �🛠 Wymagania

Aby uruchomić projekt lokalnie, potrzebujesz:

*   **Node.js**: Wersja 18 lub nowsza.
*   **PostgreSQL**: Baza danych (lokalna instancja lub Docker).
*   **Dostęp do sieci ZUT**: Wymagany do działania logowania LDAP (VPN lub sieć uczelniana).
*   **Port 2137**: Musi być wolny na maszynie hosta (używany przez bazę danych w trybie `host network`).

## 🚀 Instalacja

1.  **Sklonuj repozytorium:**
    ```bash
    git clone https://github.com/IKAR-IPZ/planqr-backend.git
    cd planqr-backend
    ```

2.  **Zainstaluj zależności:**
    ```bash
    npm install
    ```

3.  **Zainicjalizuj bazę danych (Prisma):**
    ```bash
    npx prisma generate
    npx prisma db push
    ```

4.  **Uruchom Docker (Baza Danych):**
    Projekt używa Docker Compose z trybem sieciowym `host` dla bazy danych.
    ```bash
    docker-compose up -d
    ```

## ⚙️ Konfiguracja

Utwórz plik `.env` w głównym katalogu projektu. Możesz skopiować przykładowy plik `.env.example`:

```bash
cp .env.example .env
```

**Wymagana zawartość `.env`:**

```properties
# Serwer
PORT=9099

# Baza danych
DATABASE_URL="postgresql://admin:admin123@localhost:2137/planqr_db?schema=public"

# LDAP ZUT
LDAP_URL="ldap://ldap.zut.edu.pl"
LDAP_DN="uid=%s,cn=users,cn=accounts,dc=zut,dc=edu,dc=pl"

# Security
JWT_SECRET="zmien_to_na_trudne_haslo"
NODE_ENV="development"
```

> **Uwaga:** Port `9099` jest domyślny dla tego projektu i kompatybilny z frontendem.

## ▶️ Uruchomienie

### Tryb Deweloperski
Uruchamia serwer z funkcją hot-reload (ts-node-dev).

```bash
npm run dev
```
Adres: `http://localhost:9099`

### Tryb Produkcyjny
Kompiluje kod TypeScript do JavaScript i uruchamia wersję zoptymalizowaną.

```bash
npm run build
npm start
```

## 📚 API i Dokumentacja

Projekt posiada wbudowaną dokumentację **Swagger UI**. Po uruchomieniu serwera jest ona dostępna pod adresem:

👉 **[http://localhost:9099/api/docs](http://localhost:9099/api/docs)**

### Główne moduły API:

| Moduł | Ścieżka bazowa | Opis |
| :--- | :--- | :--- |
| **Auth** | `/api/auth` | Logowanie LDAP, sprawdzanie sesji, wylogowywanie. |
| **Schedule** | `/api/schedule` | Pobieranie planu zajęć (wg sali, prowadzącego, studenta). |
| **Messages** | `/api/messages` | System wiadomości dla grup zajęciowych. |
| **Devices** | `/api/devices` | Panel administratora do zarządzania salami/urządzeniami. |

## 📂 Struktura Projektu

```text
src/
├── config/         # Konfiguracja Swaggera i innych narzędzi
├── controllers/    # Kontrolery (logika biznesowa endpointów)
├── routes/         # Definicje ścieżek (Express Router)
├── services/       # Serwisy zewnętrzne (LdapService, ZutService)
├── jobs/           # Zadania w tle (Cron)
├── middlewares/    # Middleware (Auth, walidacja)
└── server.ts       # Punkt wejścia aplikacji
```