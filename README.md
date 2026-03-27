# PlanQR Backend

Backend API projektu PlanQR oparty na `Express`, `TypeScript` i `Prisma`.

Serwis:
- wystawia API pod prefiksem `/api`
- udostępnia Swagger pod `/api/docs`
- korzysta z PostgreSQL przez `DATABASE_URL`
- obsługuje logowanie LDAP
- czyta konfigurację ze wspólnego pliku `../.env`
- może działać lokalnie przez `npm`, jako osobny kontener albo razem z frontendem przez rootowy `docker compose`

## Gdzie backend bierze konfigurację

Backend ładuje zmienne środowiskowe w tej kolejności:
1. z pliku `../.env`
2. z lokalnego środowiska procesu

To oznacza, że z perspektywy katalogu `planqr-backend` ważne są pliki w katalogu nadrzędnym repo:
- `../.env`
- `../.env.dev.example`
- `../.env.prod.example`
- `../.env.example`
- `../certs/cert.pem`
- `../certs/cert.key`

Najprostszy wybór:
- lokalnie: `cp .env.dev.example .env`
- na serwerze / w środowisku produkcyjnym: `cp .env.prod.example .env`

## Wymagania

- Node.js 20.x i npm 10+, jeśli uruchamiasz backend bez Dockera
- Docker i Docker Compose v2, jeśli uruchamiasz backend w kontenerze
- działająca baza PostgreSQL dostępna z backendu
- opcjonalnie katalog `../certs`, jeśli backend ma działać po HTTPS
- opcjonalnie dostęp do LDAP / sieci uczelni / VPN, jeśli chcesz testować logowanie LDAP

## Wymagane zmienne `env`

Backend wymaga tych zmiennych:

| Zmienna | Wymagana | Opis |
| --- | --- | --- |
| `NODE_ENV` | tak | `development`, `production` albo `test` |
| `PORT` | tak | port procesu backendu |
| `DISABLE_HTTPS` | tak | `true` = HTTP, `false` = próba uruchomienia HTTPS z `../certs` |
| `BACKEND_PUBLIC_URL` | tak | publiczny adres backendu, bez dopisywania `/api` |
| `CORS_ORIGIN` | tak | lista originów oddzielona przecinkami albo `*` |
| `DATABASE_URL` | tak | connection string PostgreSQL |
| `JWT_SECRET` | tak | sekret JWT |
| `LDAP_URL` | tak | adres serwera LDAP |
| `LDAP_DN` | tak | wzorzec DN z `%s` dla loginu |
| `ZUT_SCHEDULE_STUDENT_URL` | tak | źródłowy endpoint planu zajęć używany przez backend |

Opcjonalnie możesz ustawić:

| Zmienna | Wymagana | Opis |
| --- | --- | --- |
| `DEV_AUTH_BYPASS` | opcjonalnie | `true` = tylko przy `NODE_ENV=development` pomija LDAP i pozwala zalogować się dowolnym loginem jako prowadzący; domyślnie `false` |

Dodatkowo przy rootowym `docker compose` możesz ustawić:

| Zmienna | Wymagana | Opis |
| --- | --- | --- |
| `BACKEND_HOST_PORT` | opcjonalnie | port hosta mapowany na kontener backendu; domyślnie `9099` |

Ważna uwaga dla Dockera:
- oba pliki Compose mapują kontener na port `9099`
- jeżeli zmienisz `PORT`, musisz też zmienić mapowanie portów w plikach Compose
- jeżeli nie chcesz niczego poprawiać ręcznie, zostaw `PORT=9099`

Minimalny blok backendu w `.env`:

```dotenv
NODE_ENV=development
PORT=9099
DISABLE_HTTPS=true
BACKEND_PUBLIC_URL=http://localhost:9099
CORS_ORIGIN=https://localhost:3000,http://localhost:3000,https://localhost
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/planqr_db?schema=public
JWT_SECRET=change-me
LDAP_URL=ldap://ldap.zut.edu.pl
LDAP_DN=uid=%s,cn=users,cn=accounts,dc=zut,dc=edu,dc=pl
ZUT_SCHEDULE_STUDENT_URL=https://plan.zut.edu.pl/schedule_student.php
DEV_AUTH_BYPASS=false
```

## Baza danych

Repo nie uruchamia PostgreSQL w żadnym z plików `docker-compose.yml`.

To znaczy, że baza musi działać osobno:
- lokalnie na hoście
- w osobnym kontenerze
- albo na zewnętrznym serwerze

Przykład szybkiego startu lokalnej bazy przez Dockera:

```bash
docker run --name planqr-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=planqr_db \
  -p 5432:5432 \
  -d postgres:16
```

Przy takim uruchomieniu `DATABASE_URL` może wyglądać tak:

```dotenv
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/planqr_db?schema=public
```

## Uruchomienie lokalne przez `npm`

To jest najlepsza opcja do developmentu backendu.

### 1. Przygotuj `.env`

W katalogu głównym repo:

```bash
cp .env.dev.example .env
```

Uzupełnij co najmniej:
- `DATABASE_URL`
- `JWT_SECRET`
- w razie potrzeby `CORS_ORIGIN`

Jeżeli chcesz lokalnie pominąć LDAP, ustaw dodatkowo:

```dotenv
NODE_ENV=development
DEV_AUTH_BYPASS=true
```

### 2. Zainstaluj zależności

```bash
cd planqr-backend
npm install
```

### 3. Przygotuj Prisma

```bash
npm run prisma:generate
npm run prisma:push
```

### 4. Uruchom backend

```bash
npm run dev
```

Po starcie:
- backend będzie dostępny pod `http://localhost:9099`
- Swagger będzie pod `http://localhost:9099/api/docs`

Jeżeli zmienisz `BACKEND_PUBLIC_URL`, użyj wtedy tego adresu zamiast przykładowego `localhost`.

## Lokalny HTTPS dla backendu

Domyślnie najprościej używać HTTP:

```dotenv
DISABLE_HTTPS=true
BACKEND_PUBLIC_URL=http://localhost:9099
```

Jeżeli chcesz wystawić backend po HTTPS:

1. utwórz katalog `certs` w katalogu głównym repo
2. przygotuj pliki `certs/cert.pem` i `certs/cert.key`
3. ustaw:

```dotenv
DISABLE_HTTPS=false
BACKEND_PUBLIC_URL=https://localhost:9099
```

Przykład generowania certyfikatów przez `mkcert`:

```bash
mkdir -p certs
mkcert -install
mkcert -key-file certs/cert.key -cert-file certs/cert.pem localhost 127.0.0.1 ::1
```

## Uruchomienie tylko backendu przez `docker compose`

W katalogu `planqr-backend` znajduje się osobny plik `docker-compose.yml`.

Ten tryb:
- buduje tylko backend
- czyta konfigurację z `../.env`
- montuje certyfikaty z `../certs`
- nie uruchamia PostgreSQL

### 1. Przygotuj `.env`

W katalogu głównym repo:

```bash
cp .env.dev.example .env
```

Najbezpieczniej zostaw:

```dotenv
PORT=9099
DISABLE_HTTPS=true
BACKEND_PUBLIC_URL=http://localhost:9099
DEV_AUTH_BYPASS=false
```

### 2. Uruchom kontener

```bash
cd planqr-backend
docker compose up --build
```

Po starcie:
- backend będzie dostępny pod `http://localhost:9099`
- kontener wykona automatycznie `npx prisma db push && npm start`

## Uruchomienie całego stacku przez rootowy `docker compose`

To jest najlepsza opcja, jeśli chcesz postawić frontend i backend razem.

Rootowy plik `docker-compose.yml`:
- buduje `planqr-backend`
- buduje `planqr-frontend`
- wymaga wspólnego pliku `.env`
- nadal nie uruchamia PostgreSQL

### 1. Przygotuj wspólny `.env`

Lokalnie:

```bash
cp .env.dev.example .env
```

Na środowisko produkcyjne:

```bash
cp .env.prod.example .env
```

Sprawdź szczególnie te wartości:

```dotenv
NODE_ENV=development
PORT=9099
BACKEND_HOST_PORT=9099
DISABLE_HTTPS=true
BACKEND_PUBLIC_URL=http://localhost:9099
CORS_ORIGIN=https://localhost
DATABASE_URL=postgresql://postgres:postgres@db-host:5432/planqr_db?schema=public
JWT_SECRET=change-me
LDAP_URL=ldap://ldap.zut.edu.pl
LDAP_DN=uid=%s,cn=users,cn=accounts,dc=zut,dc=edu,dc=pl
ZUT_SCHEDULE_STUDENT_URL=https://plan.zut.edu.pl/schedule_student.php
DEV_AUTH_BYPASS=false
FRONTEND_PORT=443
BACKEND_INTERNAL_URL=http://backend:9099
ZUT_SCHEDULE_URL=https://plan.zut.edu.pl/schedule.php
ZUT_PLAN_BASE_URL=https://plan.zut.edu.pl
```

Ważne:
- `BACKEND_INTERNAL_URL=http://backend:9099` jest potrzebne frontendowi w kontenerze
- `DATABASE_URL` musi wskazywać bazę widoczną z kontenera backendu
- `CORS_ORIGIN` musi odpowiadać adresowi frontendu widocznemu w przeglądarce
- `DEV_AUTH_BYPASS=true` działa wyłącznie z `NODE_ENV=development`; w innych trybach backend nie wystartuje
- jeżeli frontend działa na `https://localhost:8443`, dodaj do `CORS_ORIGIN` dokładnie `https://localhost:8443`
- jeżeli zmienisz `BACKEND_HOST_PORT`, ustaw też zgodny `BACKEND_PUBLIC_URL`, na przykład `http://localhost:9191`
- w Compose najprostsza i zalecana konfiguracja to `DISABLE_HTTPS=true`, bo TLS kończy się na `nginx` z frontendu

### 2. Przygotuj certyfikaty

Frontend w kontenerze działa wyłącznie po HTTPS, więc pliki poniżej są wymagane:
- `certs/cert.pem`
- `certs/cert.key`

Przykład:

```bash
mkdir -p certs
mkcert -install
mkcert -key-file certs/cert.key -cert-file certs/cert.pem localhost 127.0.0.1 ::1
```

### 3. Uruchom całość

W katalogu głównym repo:

```bash
docker compose up --build
```

Po starcie:
- frontend będzie dostępny pod `https://localhost` albo `https://localhost:<FRONTEND_PORT>`
- backend będzie dostępny pod `http://localhost:<BACKEND_HOST_PORT>`
- Swagger będzie pod `http://localhost:<BACKEND_HOST_PORT>/api/docs`

## Przydatne komendy

```bash
npm run dev
npm run build
npm start
npm run prisma:generate
npm run prisma:push
npm run prisma:studio
npm run lint
```

## Najczęstsze problemy

### `Environment validation failed`

Brakuje jednej z wymaganych zmiennych w `../.env` albo ma niepoprawny format.

### `P1001` / brak połączenia z bazą

`DATABASE_URL` wskazuje niedostępny host albo PostgreSQL nie działa.

### Backend działa, ale frontend dostaje błąd CORS

`CORS_ORIGIN` nie zawiera właściwego adresu frontendu, na przykład:
- `https://localhost`
- `https://localhost:3000`
- `https://localhost:8443`

### HTTPS nie startuje

Brakuje `../certs/cert.pem` albo `../certs/cert.key`, a `DISABLE_HTTPS=false`.

### LDAP lokalnie nie działa

Najczęściej problemem nie jest backend, tylko brak dostępu do sieci uczelni lub VPN.
