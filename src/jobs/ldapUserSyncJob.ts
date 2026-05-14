import cron from 'node-cron';
import { env } from '../config/env';
import { syncKnownLdapUsers } from '../services/ldapUserCacheService';

let ldapUserSyncInProgress = false;

export const startLdapUserSyncJob = () => {
    if (!env.LDAP_SYNC_ENABLED) {
        console.log('[LDAP Sync] Disabled.');
        return;
    }

    cron.schedule('0 * * * *', async () => {
        if (ldapUserSyncInProgress) {
            console.log('[LDAP Sync] Previous sync is still running; skipping this hour.');
            return;
        }

        ldapUserSyncInProgress = true;
        try {
            const result = await syncKnownLdapUsers();
            console.log(
                `[LDAP Sync] Finished with status=${result.status}, known=${result.known}, synced=${result.synced}, missing=${result.missing}.`
            );
        } catch (error) {
            console.error('[LDAP Sync] Failed:', error);
        } finally {
            ldapUserSyncInProgress = false;
        }
    });
};
