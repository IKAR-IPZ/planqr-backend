import ldap from 'ldapjs';
import { env } from '../config/env';

const LDAP_INVALID_CREDENTIALS_CODE = '49';

export type LdapAuthenticationFailureReason =
    | 'invalid_credentials'
    | 'timeout'
    | 'service_unavailable'
    | 'unexpected';

export type LdapAuthenticationResult =
    | {
        outcome: 'authenticated';
        givenName?: string;
        surname?: string;
        title?: string;
    }
    | {
        outcome: 'failed';
        reason: LdapAuthenticationFailureReason;
        details: string;
    };

export class LdapService {
    private readonly ldapUrl: string;
    private readonly ldapDnPattern: string;

    constructor() {
        this.ldapUrl = env.LDAP_URL;
        this.ldapDnPattern = env.LDAP_DN;
    }

    /**
     * Authenticate a user against the LDAP server.
     * @param username The username (uid)
     * @param password The password
     * @returns Structured result that distinguishes invalid credentials from LDAP failures
     */
    async authenticate(username: string, password: string): Promise<LdapAuthenticationResult> {
        return new Promise((resolve) => {
            const client = ldap.createClient({
                url: this.ldapUrl,
                timeout: 5000,
                connectTimeout: 5000
            });

            let settled = false;

            const finish = (result: LdapAuthenticationResult) => {
                if (settled) {
                    return;
                }

                settled = true;
                client.removeListener('error', handleClientError);
                resolve(result);
            };

            const closeClient = (context: string) => {
                try {
                    client.unbind((err) => {
                        if (err) {
                            console.error(`${context} unbind error:`, err);
                        }
                    });
                } catch (error) {
                    console.error(`${context} unbind exception:`, error);
                    try {
                        client.destroy();
                    } catch (destroyError) {
                        console.error(`${context} destroy exception:`, destroyError);
                    }
                }
            };

            const fail = (error: unknown, context: string) => {
                console.error(`${context}:`, error);
                finish({
                    outcome: 'failed',
                    reason: this.classifyLdapError(error),
                    details: this.getErrorMessage(error)
                });
                closeClient(context);
            };

            const handleClientError = (error: unknown) => {
                if (settled) {
                    return;
                }

                fail(error, 'LDAP client error');
            };

            client.on('error', handleClientError);

            const userDn = this.ldapDnPattern.replace('%s', username);

            console.log(`Attempting LDAP bind for DN: ${userDn}`);

            client.bind(userDn, password, (err) => {
                if (err) {
                    return fail(err, `LDAP bind failed for ${userDn}`);
                }

                console.log('LDAP Bind successful for:', username);

                const searchBaseDn = this.getSearchBaseDn();
                const searchOptions: ldap.SearchOptions = {
                    scope: 'sub',
                    filter: `(uid=${this.escapeLdapFilterValue(username)})`,
                    attributes: ['givenName', 'sn', 'title']
                };

                client.search(searchBaseDn, searchOptions, (err, res) => {
                    if (err) {
                        return fail(err, `LDAP search failed for ${username}`);
                    }

                    let givenName = '';
                    let surname = '';
                    let title = '';
                    let entryFound = false;

                    res.on('searchEntry', (entry) => {
                        entryFound = true;

                        givenName = this.getSearchEntryAttributeValue(entry, 'givenName');
                        surname = this.getSearchEntryAttributeValue(entry, 'sn');
                        title = this.getSearchEntryAttributeValue(entry, 'title');

                        if (!givenName && !surname && !title) {
                            console.warn(
                                `[LDAP] Search entry for "${username}" did not expose givenName/sn/title. Available keys: ${JSON.stringify(this.getSearchEntryDebugKeys(entry))}`
                            );
                        }
                    });

                    res.on('error', (err) => {
                        fail(err, `LDAP search result error for ${username}`);
                    });

                    res.on('end', (result) => {
                        if (settled) {
                            return;
                        }

                        if (result && result.status !== 0) {
                            fail(new Error(`LDAP search ended with status ${result.status}`), `LDAP search ended for ${username}`);
                            return;
                        }

                        if (!entryFound) {
                            fail(new Error('LDAP search returned no entries'), `LDAP search returned no user entry for ${username}`);
                            return;
                        }

                        finish({
                            outcome: 'authenticated',
                            givenName,
                            surname,
                            title
                        });
                        closeClient('LDAP search');
                    });
                });
            });
        });
    }

    private getSearchBaseDn() {
        const firstCommaIndex = this.ldapDnPattern.indexOf(',');
        return firstCommaIndex >= 0 ? this.ldapDnPattern.slice(firstCommaIndex + 1).trim() : this.ldapDnPattern;
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

        const attributeValue = this.getAttributeValueFromCollections([
            entry.attributes,
            entry.pojo?.attributes,
        ], attribute);

        return attributeValue;
    }

    private getSearchEntryDebugKeys(entry: ldap.SearchEntry) {
        const directKeys = Object.keys(entry as unknown as Record<string, unknown>);
        const pojoKeys = Object.keys((entry.pojo ?? {}) as unknown as Record<string, unknown>).map((key) => `pojo.${key}`);
        const attributeKeys = this.collectAttributeNames([entry.attributes, entry.pojo?.attributes]).map((key) => `attr.${key}`);

        return Array.from(new Set([...directKeys, ...pojoKeys, ...attributeKeys])).sort();
    }

    private getAttributeValueFromCollections(
        collections: Array<unknown[] | undefined>,
        attribute: string
    ) {
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

    private collectAttributeNames(collections: Array<unknown[] | undefined>) {
        const names = new Set<string>();

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
                            : null;

                if (typeCandidate) {
                    names.add(typeCandidate);
                }
            }
        }

        return Array.from(names);
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

    private classifyLdapError(error: unknown): LdapAuthenticationFailureReason {
        if (error instanceof ldap.InvalidCredentialsError) {
            return 'invalid_credentials';
        }

        const name = this.getErrorProperty(error, 'name');
        const code = this.getErrorProperty(error, 'code');
        const message = this.getErrorMessage(error).toLowerCase();

        if (name === 'InvalidCredentialsError' || code === LDAP_INVALID_CREDENTIALS_CODE) {
            return 'invalid_credentials';
        }

        if (
            name === 'TimeoutError' ||
            code === 'ETIMEDOUT' ||
            message.includes('timeout') ||
            message.includes('timed out')
        ) {
            return 'timeout';
        }

        if (
            name === 'ConnectionError' ||
            code === 'ECONNREFUSED' ||
            code === 'ECONNRESET' ||
            code === 'ECONNABORTED' ||
            code === 'ENOTFOUND' ||
            code === 'EHOSTUNREACH' ||
            code === 'EAI_AGAIN' ||
            message.includes('connection') ||
            message.includes('connect') ||
            message.includes('unavailable') ||
            message.includes('socket')
        ) {
            return 'service_unavailable';
        }

        return 'unexpected';
    }

    private getErrorMessage(error: unknown): string {
        if (error instanceof Error && error.message) {
            return error.message;
        }

        if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
            return error.message;
        }

        return 'Unknown LDAP error';
    }

    private getErrorProperty(error: unknown, property: 'name' | 'code'): string | null {
        if (!error || typeof error !== 'object' || !(property in error)) {
            return null;
        }

        const errorRecord = error as Record<string, unknown>;
        const value = errorRecord[property];
        return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
    }
}
