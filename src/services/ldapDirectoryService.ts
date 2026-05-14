import ldap from 'ldapjs';
import { env } from '../config/env';

export interface LdapDirectoryUser {
    username: string;
    displayName: string;
    givenName: string;
    surname: string;
    title: string;
    email: string;
}

const normalizeText = (value?: string | null) => String(value ?? '').trim();
const normalizeUsername = (value?: string | null) => normalizeText(value).toLowerCase();

const buildDisplayName = (givenName: string, surname: string, fallback: string) =>
    [surname, givenName].map(normalizeText).filter(Boolean).join(' ').trim() || fallback;

export class LdapDirectoryService {
    private readonly ldapUrl = env.LDAP_URL;
    private readonly ldapDnPattern = env.LDAP_DN;

    isConfigured() {
        return env.LDAP_SYNC_ENABLED;
    }

    async findUsers(usernames: string[]): Promise<Map<string, LdapDirectoryUser>> {
        const normalizedUsernames = Array.from(
            new Set(usernames.map(normalizeUsername).filter(Boolean))
        );

        if (!normalizedUsernames.length || !this.isConfigured()) {
            return new Map();
        }

        const client = ldap.createClient({
            url: this.ldapUrl,
            timeout: 10000,
            connectTimeout: 10000,
        });

        try {
            await this.bind(client);

            const users = new Map<string, LdapDirectoryUser>();
            const batchSize = env.LDAP_SYNC_BATCH_SIZE;

            for (let index = 0; index < normalizedUsernames.length; index += batchSize) {
                const batch = normalizedUsernames.slice(index, index + batchSize);
                const batchUsers = await this.searchBatch(client, batch);

                for (const [username, user] of batchUsers) {
                    users.set(username, user);
                }
            }

            return users;
        } finally {
            this.closeClient(client);
        }
    }

    async findAllUsers(): Promise<LdapDirectoryUser[]> {
        if (!this.isConfigured()) {
            return [];
        }

        const client = ldap.createClient({
            url: this.ldapUrl,
            timeout: 30000,
            connectTimeout: 10000,
        });

        try {
            await this.bind(client);
            return Array.from((await this.searchAll(client)).values());
        } finally {
            this.closeClient(client);
        }
    }

    private bind(client: ldap.Client) {
        return new Promise<void>((resolve, reject) => {
            client.bind('', '', (error) => {
                if (error) {
                    reject(error);
                    return;
                }

                resolve();
            });
        });
    }

    private searchBatch(client: ldap.Client, usernames: string[]) {
        return new Promise<Map<string, LdapDirectoryUser>>((resolve, reject) => {
            const users = new Map<string, LdapDirectoryUser>();
            const filter = usernames.length === 1
                ? `(uid=${this.escapeLdapFilterValue(usernames[0])})`
                : `(|${usernames.map((username) => `(uid=${this.escapeLdapFilterValue(username)})`).join('')})`;

            const searchOptions: ldap.SearchOptions = {
                scope: 'sub',
                filter,
                attributes: ['uid', 'givenName', 'sn', 'title', 'mail', 'displayName', 'cn'],
            };

            client.search(this.getSearchBaseDn(), searchOptions, (error, result) => {
                if (error) {
                    reject(error);
                    return;
                }

                result.on('searchEntry', (entry) => {
                    const user = this.toDirectoryUser(entry);
                    if (user) {
                        users.set(user.username, user);
                    }
                });

                result.on('error', reject);
                result.on('end', (status) => {
                    if (status && status.status !== 0) {
                        reject(new Error(`LDAP search ended with status ${status.status}`));
                        return;
                    }

                    resolve(users);
                });
            });
        });
    }

    private searchAll(client: ldap.Client) {
        return new Promise<Map<string, LdapDirectoryUser>>((resolve, reject) => {
            const users = new Map<string, LdapDirectoryUser>();
            const searchOptions: ldap.SearchOptions = {
                scope: 'sub',
                filter: env.LDAP_SYNC_FULL_FILTER,
                attributes: ['uid', 'givenName', 'sn', 'title', 'mail', 'displayName', 'cn'],
                paged: {
                    pageSize: env.LDAP_SYNC_FULL_PAGE_SIZE,
                },
                sizeLimit: env.LDAP_SYNC_FULL_USER_LIMIT > 0
                    ? env.LDAP_SYNC_FULL_USER_LIMIT
                    : undefined,
            };

            client.search(this.getSearchBaseDn(), searchOptions, (error, result) => {
                if (error) {
                    reject(error);
                    return;
                }

                result.on('searchEntry', (entry) => {
                    const user = this.toDirectoryUser(entry);
                    if (user) {
                        users.set(user.username, user);
                    }
                });

                result.on('error', reject);
                result.on('end', (status) => {
                    if (status && status.status !== 0) {
                        reject(new Error(`LDAP full search ended with status ${status.status}`));
                        return;
                    }

                    resolve(users);
                });
            });
        });
    }

    private toDirectoryUser(entry: ldap.SearchEntry): LdapDirectoryUser | null {
        const username = normalizeUsername(this.getSearchEntryAttributeValue(entry, 'uid'));
        if (!username) {
            return null;
        }

        const givenName = normalizeText(this.getSearchEntryAttributeValue(entry, 'givenName'));
        const surname = normalizeText(this.getSearchEntryAttributeValue(entry, 'sn'));
        const title = normalizeText(this.getSearchEntryAttributeValue(entry, 'title'));
        const email = normalizeText(this.getSearchEntryAttributeValue(entry, 'mail'));
        const ldapDisplayName = normalizeText(this.getSearchEntryAttributeValue(entry, 'displayName'));
        const commonName = normalizeText(this.getSearchEntryAttributeValue(entry, 'cn'));
        const displayName = ldapDisplayName || buildDisplayName(givenName, surname, commonName || username);

        return {
            username,
            displayName,
            givenName,
            surname,
            title,
            email,
        };
    }

    private getSearchBaseDn() {
        if (env.LDAP_SYNC_SEARCH_BASE_DN) {
            return env.LDAP_SYNC_SEARCH_BASE_DN;
        }

        const firstCommaIndex = this.ldapDnPattern.indexOf(',');
        return firstCommaIndex >= 0 ? this.ldapDnPattern.slice(firstCommaIndex + 1).trim() : this.ldapDnPattern;
    }

    private closeClient(client: ldap.Client) {
        try {
            client.unbind((error) => {
                if (error) {
                    console.error('[LDAP Sync] Unbind error:', error);
                }
            });
        } catch (error) {
            console.error('[LDAP Sync] Unbind exception:', error);
            client.destroy();
        }
    }

    private escapeLdapFilterValue(value: string) {
        return value.replace(/[\\()*\0]/g, (character) => {
            switch (character) {
                case '\\':
                    return '\\5c';
                case '*':
                    return '\\2a';
                case '(':
                    return '\\28';
                case ')':
                    return '\\29';
                case '\0':
                    return '\\00';
                default:
                    return character;
            }
        });
    }

    private getSearchEntryAttributeValue(entry: ldap.SearchEntry, attribute: string) {
        const directValue = this.getAttributeValueFromRecord(entry as unknown as Record<string, unknown>, attribute);
        if (directValue) {
            return directValue;
        }

        const pojoValue = this.getAttributeValueFromRecord(entry.pojo as unknown as Record<string, unknown>, attribute);
        if (pojoValue) {
            return pojoValue;
        }

        return this.getAttributeValueFromCollections([
            entry.attributes,
            entry.pojo?.attributes,
        ], attribute);
    }

    private getAttributeValueFromCollections(collections: Array<unknown[] | undefined>, attribute: string) {
        const targetAttribute = attribute.toLowerCase();

        for (const collection of collections) {
            if (!Array.isArray(collection)) {
                continue;
            }

            for (const item of collection) {
                if (!item || typeof item !== 'object') {
                    continue;
                }

                const itemRecord = item as Record<string, unknown>;
                const typeCandidate =
                    typeof itemRecord.type === 'string'
                        ? itemRecord.type
                        : typeof itemRecord.name === 'string'
                            ? itemRecord.name
                            : '';

                if (typeCandidate.toLowerCase() !== targetAttribute) {
                    continue;
                }

                const valuesCandidate =
                    Array.isArray(itemRecord.values)
                        ? itemRecord.values
                        : Array.isArray(itemRecord.vals)
                            ? itemRecord.vals
                            : [];

                const resolvedValue = valuesCandidate
                    .map((value) => String(value).trim())
                    .find(Boolean);

                if (resolvedValue) {
                    return resolvedValue;
                }

                const singleValueCandidate = this.getAttributeValueFromRecord(itemRecord, 'value');
                if (singleValueCandidate) {
                    return singleValueCandidate;
                }
            }
        }

        return '';
    }

    private getAttributeValueFromRecord(entry: Record<string, unknown>, attribute: string) {
        const exactValue = this.normalizeAttributeValue(entry[attribute]);
        if (exactValue) {
            return exactValue;
        }

        const matchingKey = Object.keys(entry).find((key) => key.toLowerCase() === attribute.toLowerCase());
        if (!matchingKey) {
            return '';
        }

        return this.normalizeAttributeValue(entry[matchingKey]);
    }

    private normalizeAttributeValue(value: unknown) {
        if (Array.isArray(value)) {
            return value.map((item) => String(item).trim()).find(Boolean) ?? '';
        }

        if (typeof value === 'string') {
            return value.trim();
        }

        if (value === null || value === undefined) {
            return '';
        }

        return String(value).trim();
    }
}
