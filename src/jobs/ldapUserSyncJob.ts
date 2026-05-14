import cron from 'node-cron';
import { env } from '../config/env';
import { syncLdapUsers } from '../services/ldapUserCacheService';

let ldapUserSyncInProgress = false;

const runLdapUserSync = async (source: 'startup' | 'schedule') => {
    if (ldapUserSyncInProgress) {
        console.log(`[LDAP Sync] Previous sync is still running; skipping ${source} sync.`);
        return;
    }

    ldapUserSyncInProgress = true;
    try {
        const result = await syncLdapUsers();
        console.log(
            `[LDAP Sync] Finished ${source} sync with status=${result.status}, mode=${result.mode}, known=${result.known}, synced=${result.synced}, missing=${result.missing}.`
        );
    } catch (error) {
        console.error(`[LDAP Sync] ${source} sync failed:`, error);
    } finally {
        ldapUserSyncInProgress = false;
    }
};

export const startLdapUserSyncJob = () => {
    if (!env.LDAP_SYNC_ENABLED) {
        console.log('[LDAP Sync] Disabled.');
        return;
    }

    void runLdapUserSync('startup');
    cron.schedule('0 * * * *', () => void runLdapUserSync('schedule'));
};
