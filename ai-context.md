# PlanQR Backend - Kontekst API i Architektura

Dokument przeznaczony dla AI / LLM jako szybki kontekst projektowy podczas developmentu.

## 🎯 Cel Projektu
Backend dla inżynierskiego projektu **PlanQR**. Główne zadania aplikacji to:
- Pobieranie i serwowanie planów zajęć ZUT (prowadzący, sale, studenci).
- Obsługa autoryzacji opartej o protokół LDAP ZUT.
- Zarządzanie komunikatami/wiadomościami dla konkretnych zajęć i grup (odwoływanie zajęć, ogłoszenia).
- Zarządzanie i walidacja urządzeń (tabletów/ekranów) wyświetlających plany przed salami, łącznie z WebSockets i handshake'ami.

## 🛠 Technologie
- **Node.js** + **TypeScript**
- **Express.js** + **Zod** (walidacja)
- **Prisma ORM** + **PostgreSQL** (Zarządzanie schematem lokalnym głównie przez `npx prisma db push`, zrezygnowano z migracji ze względu na charakterystykę deploymentu)
- **LDAPjs** (Logowanie)
- **Swagger** (Autogeneracja dokumentacji OpenAPI pod `/api/docs`)
- **Docker** + **Docker Compose**

## 📡 Endpoints (Ścieżki API)

### 1. Autoryzacja (`/api/auth`)
- `POST /api/auth/login` - Logowanie przez podanie `username` i `password` (sprawdzane przez LDAP, zwraca JWT i weryfikuje profil).
- `GET /api/auth/check-login` - Weryfikuje istnienie / ważność sesji (wymaga tokena / cookie).
- `POST /api/auth/logout` - Wylogowanie użytkownika.

### 2. Plan Zajęć (`/api/schedule`)
- `GET /api/schedule?id={X}&kind={room|worker|student}` - Główny endpoint serwujący plan zajęć w oparciu o scraper planu ZUT. Endpoint tłumaczy identyfikatory sal/prowadzących/studentów i zwraca gotowe bloki zajęciowe.

### 3. Wiadomości (`/api/messages`)
_Obsługa komunikatów/ogłoszeń per dany plan / sala._
- `GET /api/messages` - Pobiera listę wszystkich wiadomości.
- `GET /api/messages/:lessonId` - Wiadomości spięte z konkretną lekcją (lessonId z planu).
- `POST /api/messages` - Tworzenie wiadomości (`body`, `lecturer`, `login`, `room`, `lessonId`, `group`, `isRoomChange`, `newRoom`). Obsługuje m.in. priorytetowe komunikaty o zmianie sali (jeśli wysłano `isRoomChange: true`).
- `DELETE /api/messages/:id` - Usuwanie wiadomości.

### 4. Lekcje specyficzne (`/api/lesson`) - Starsze / Specyficzne?
- `GET /api/lesson/messages/list` - Alternatywne / globalne pobieranie.
- `GET /api/lesson/message/:roomId` - Pobranie info o wiadomości w danej sali.
- `DELETE /api/lesson/messages/clear` - Wyczyść całościowo.
- `DELETE /api/lesson/message/delete/:roomId` - Usuń wiadomość w sali.

### 5. Urządzenia - Zarządzanie (`/api/devices`)
_Zarządzanie panelami wyświetlającymi (ekrany e-ink / tablety) zainstalowanymi pod salami._
- `GET /api/devices` - Wykaz sparowanych urządzeń.
- `GET /api/devices/:id` - Szczegóły urządzenia.
- `POST /api/devices` - Rejestracja nowego urządzenia z poziomu panelu (Admin).
- `PUT /api/devices/:id` - Edycja nazwy / przypisanej sali.
- `DELETE /api/devices/:id` - Usunięcie.
- `GET /api/devices/validate?room={X}&secretUrl={Y}` - Autoryzacja / Walidacja z poziomu samego czytnika przy odpytywaniu o dane.

### 6. Registry / Handshake dla urządzeń (`/api/registry`)
_Endpointy kontrolujące "życie" i rejestrację nowych tabletów przypisywanych do systemu._
- `POST /api/registry/handshake` - Akcja inicjująca dla fabrycznie nowego urządzenia. Urządzenie zgłasza się tu i oczekuje akceptacji przez admina.
- `GET /api/registry/status/:deviceId` - Polling przez urządzenie czekające na akceptację, sprawdzające czy status przeszedł w ACTIVE.

### 7. Obecność / Attendance (`/api/v1/attendance`)
_Moduł integrujący system Kantech obsługujący zdarzenia z czytników pod salami (np. odbicie legitymacji studenckiej)._
- `POST /api/v1/attendance/scan` - Przyjmuje odbicie karty (`card_id`, `door_id`, `scanned_at`). Chroniony statycznym tokenem z `.env` (`WORKER_SECRET_TOKEN`). Obsługuje deduplikację po `card_id` + `scanned_at`.
- `GET /api/v1/attendance` - Pobieranie logów wejść (obsługuje np. filtr `?door_id=X` oraz `?limit=Y`).

## 🔐 Modele Danych (Prisma)
- **User** (`id`, `username`, `role`)
- **Message** (`id`, `body`, `lecturer`, `login`, `room`, `lessonId`, `group`, `validUntil`, `isRoomChange`, `newRoom`)
- **DeviceList** (`id`, `deviceName`, `deviceClassroom`, `deviceURL`, `deviceId`, `status`, `lastSeen` + telemetria: `ipAddress`, `deviceModel`, itp.)
- **AttendanceLog** (`id`, `cardId` (`card_id`), `doorId` (`door_id`), `scannedAt` (`scanned_at`), `createdAt`, `processed`) - Z indeksem dla kombo [doorId, scannedAt] i unikalnością [cardId, scannedAt].

