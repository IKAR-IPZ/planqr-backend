import ldap from 'ldapjs';
import { env } from '../config/env';

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
     * @returns Promise<boolean> true if authentication succeeds
     */
    async authenticate(username: string, password: string): Promise<{ isAuthenticated: boolean, givenName?: string, surname?: string, title?: string }> {
        return new Promise((resolve, reject) => {
            const client = ldap.createClient({
                url: this.ldapUrl,
                timeout: 5000,
                connectTimeout: 5000
            });

            client.on('error', (err) => {
                console.error('LDAP Client Error:', err);
                resolve({ isAuthenticated: false });
            });

            const userDn = this.ldapDnPattern.replace('%s', username);

            console.log(`Attempting LDAP bind for DN: ${userDn}`);

            client.bind(userDn, password, (err) => {
                if (err) {
                    console.error(`LDAP Bind failed for ${userDn}:`, err.message);
                    client.unbind();
                    return resolve({ isAuthenticated: false });
                }

                console.log('LDAP Bind successful for:', username);

                // Now search for user details
                const searchOptions: ldap.SearchOptions = {
                    scope: 'base',
                    filter: '(objectClass=*)',
                    attributes: ['givenName', 'sn', 'title', 'cn']
                };

                client.search(userDn, searchOptions, (err, res) => {
                    if (err) {
                        console.error('LDAP Search failed:', err);
                        try {
                            client.unbind((err) => { if (err) console.error('Unbind error:', err); });
                        } catch (e) { console.error('Unbind exception:', e); }
                        return resolve({ isAuthenticated: true }); // Auth worked, but details failed
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
                        try {
                            client.unbind((err) => {
                                if (err) console.error('Unbind error after search:', err);
                                else console.log('LDAP Unbound successfully');
                            });
                        } catch (e) { console.error('Unbind exception:', e); }

                        resolve({
                            isAuthenticated: true,
                            givenName,
                            surname,
                            title
                        });
                    });
                });
            });
        });
    }
}
