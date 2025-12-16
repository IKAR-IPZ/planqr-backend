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
    docker-compose up -d
    ```
    
    > **Uwaga:** Ta komenda uruchomi bazę danych Postgres (port 5432) oraz Backend (port 9099). Upewnij się, że porty są wolne.
    > Wymagane jest również wygenerowanie certyfikatów SSL dla Frontendu (szczegóły w dokumentacji Frontendu).

## ⚙️ Konfiguracja

## ⚙️ Konfiguracja

W tej konfiguracji (Docker), zmienne środowiskowe są zdefiniowane bezpośrednio w pliku `docker-compose.yml`.

**Domyślne ustawienia (zdefiniowane w `docker-compose.yml`):**

```properties
# Serwer
PORT=9099

# Baza danych
DATABASE_URL="postgresql://uzytkownik:haslo@127.0.0.1:1234/db_name?schema=public"
```

> **Ważne:** Aby zmienić hasła (zalecane na produkcji), edytuj sekcję `environment` w pliku `docker-compose.yml` dla serwisów `db` oraz `backend`. Pamiętaj, aby wartości były spójne w obu miejscach.

### Przykładowa konfiguracja (`docker-compose.yml`)

```yaml
version: '3.8'

services:
  db:
    image: postgres:15-alpine
    network_mode: "host"
    environment:
      POSTGRES_USER: uzytkownik
      POSTGRES_PASSWORD: haslo
      POSTGRES_DB: planqr_db
    volumes:
      - postgres_data:/var/lib/postgresql/data

  backend:
    build:
      context: ./planqr-backend
    network_mode: "host"
    environment:
      - DISABLE_HTTPS=true
      - PORT=9099
      - DATABASE_URL=postgresql://uzytkownik:haslo@localhost:5432/planqr_db?schema=public
      - LDAP_URL=ldap://ldap.zut.edu.pl
      - LDAP_DN=uid=%s,cn=users,cn=accounts,dc=zut,dc=edu,dc=pl
    volumes:
      - ./certs:/certs:ro
    depends_on:
      - db

volumes:
  postgres_data:
```

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