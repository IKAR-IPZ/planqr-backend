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
*   **Port 5432**: Musi być wolny na maszynie hosta (standardowy port PostgreSQL).

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

    **Zalecana metoda:** Projekt jest skonfigurowany jako część większego systemu (Docker Compose w katalogu nadrzędnym).
    
    W katalogu głównym całego projektu (jeden poziom wyżej):
    ```bash
    cp .env.example .env
    docker compose up -d --build
    ```
    
    > **Uwaga:** Backend korzysta teraz z jednego, wspólnego pliku `.env` w katalogu głównym projektu.
    > Wymagane jest również wygenerowanie certyfikatów SSL dla Frontendu (szczegóły w dokumentacji Frontendu).

## ⚙️ Konfiguracja

Źródłem prawdy dla konfiguracji jest teraz rootowy plik `.env` w katalogu głównym projektu.

Dostępne szablony:

- `.env.example`
- `.env.dev.example`
- `.env.prod.example`

Backend ładuje ten plik zarówno przy `docker compose`, jak i przy lokalnym `npm run dev`.

Najważniejsze zmienne backendu:

```properties
NODE_ENV=development
PORT=9099
DISABLE_HTTPS=true
BACKEND_PUBLIC_URL=http://localhost:9099
CORS_ORIGIN=https://localhost:3000,http://localhost:3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/planqr_db?schema=public
JWT_SECRET=change-me
LDAP_URL=ldap://ldap.zut.edu.pl
LDAP_DN=uid=%s,cn=users,cn=accounts,dc=zut,dc=edu,dc=pl
ZUT_SCHEDULE_STUDENT_URL=https://plan.zut.edu.pl/schedule_student.php
```

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

👉 `${BACKEND_PUBLIC_URL}/api/docs`

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
