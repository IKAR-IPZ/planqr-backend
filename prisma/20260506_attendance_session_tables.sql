CREATE TABLE IF NOT EXISTS tbldydaktyk (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL,
    card_hex TEXT NOT NULL,
    opened_at TIMESTAMP NOT NULL,
    closed_at TIMESTAMP,
    status TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tbluser (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL,
    card_hex TEXT NOT NULL,
    last_access TIMESTAMP NOT NULL,
    status TEXT,
    dydaktyk_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dydaktyk_active
    ON tbldydaktyk(is_active);

CREATE INDEX IF NOT EXISTS idx_dydaktyk_username
    ON tbldydaktyk(username);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dydaktyk_username_unique
    ON tbldydaktyk(username);

CREATE INDEX IF NOT EXISTS idx_user_username
    ON tbluser(username);

CREATE INDEX IF NOT EXISTS idx_user_card_hex
    ON tbluser(card_hex);

CREATE INDEX IF NOT EXISTS idx_user_dydaktyk_id
    ON tbluser(dydaktyk_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_unique
    ON tbluser(username, card_hex);
