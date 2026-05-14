CREATE TABLE IF NOT EXISTS ldap_users (
    username TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    given_name TEXT,
    surname TEXT,
    title TEXT,
    email TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    ldap_synced_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ldap_users_display_name
    ON ldap_users(display_name);

CREATE INDEX IF NOT EXISTS idx_ldap_users_active
    ON ldap_users(is_active);
