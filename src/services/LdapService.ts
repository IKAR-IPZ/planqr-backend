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

                // Now search for user details
                const searchOptions: ldap.SearchOptions = {
                    scope: 'base',
                    filter: '(objectClass=*)',
                    attributes: ['givenName', 'sn', 'title']
                };

                client.search(userDn, searchOptions, (err, res) => {
                    if (err) {
                        console.error('LDAP Search failed:', err);
                        finish({ outcome: 'authenticated' });
                        closeClient('LDAP search');
                        return;
                    }

                    let givenName = '';
                    let surname = '';
                    let title = '';

                    res.on('searchEntry', (entry) => {
                        const userEntry = (entry as any).object || (entry as any).pojo || {};

                        givenName = userEntry.givenName || '';
                        surname = userEntry.sn || '';
                        title = userEntry.title || '';
                    });

                    res.on('error', (err) => {
                        console.error('Search entry error:', err);
                    });

                    res.on('end', (result) => {
                        if (result && result.status !== 0) {
                            console.error('LDAP search ended with non-zero status:', result);
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
