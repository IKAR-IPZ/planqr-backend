BEGIN;

WITH dydaktyk AS (
    INSERT INTO tbldydaktyk (
        username,
        card_hex,
        opened_at,
        closed_at,
        status,
        is_active,
        created_at,
        updated_at
    )
    VALUES (
        'gsliwinski',
        '004F:EAC4',
        TIMESTAMP '2026-05-06 10:28:56',
        NULL,
        'open',
        1,
        TIMESTAMP '2026-05-06 10:28:53.982714',
        TIMESTAMP '2026-05-13 09:57:23.033575'
    )
    ON CONFLICT (username) DO UPDATE
        SET card_hex = EXCLUDED.card_hex,
            opened_at = EXCLUDED.opened_at,
            closed_at = NULL,
            status = 'open',
            is_active = 1,
            updated_at = CURRENT_TIMESTAMP
    RETURNING id
)
INSERT INTO tbluser (
    username,
    card_hex,
    last_access,
    status,
    dydaktyk_id,
    created_at,
    updated_at
)
SELECT
    student.username,
    student.card_hex,
    student.last_access,
    student.status,
    dydaktyk.id,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM dydaktyk
CROSS JOIN (
    VALUES
        ('bi55857', 'BI55857', TIMESTAMP '2026-05-06 10:29:10', 'scanner')
) AS student(username, card_hex, last_access, status)
ON CONFLICT (username, card_hex) DO UPDATE
    SET last_access = EXCLUDED.last_access,
        status = EXCLUDED.status,
        dydaktyk_id = EXCLUDED.dydaktyk_id,
        updated_at = CURRENT_TIMESTAMP;

COMMIT;
