import https from 'node:https';
import tls from 'node:tls';
import { execFileSync } from 'node:child_process';

// Upotreba sistemskog poverenja bez isključivanja provere TLS sertifikata.
export function createPublicAgent() {
  let systemCertificates = [];
  if (typeof tls.getCACertificates === 'function') systemCertificates = tls.getCACertificates('system');
  else if (process.platform === 'win32') {
    const command = "foreach ($location in @('CurrentUser','LocalMachine')) { $store = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root',$location); $store.Open('ReadOnly'); foreach ($cert in $store.Certificates) { '-----BEGIN CERTIFICATE-----'; [Convert]::ToBase64String($cert.RawData,[Base64FormattingOptions]::InsertLineBreaks); '-----END CERTIFICATE-----' }; $store.Close() }";
    try {
      const pem = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
      systemCertificates = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || [];
    } catch (error) { console.warn('Sistemski TLS sertifikati nisu dostupni:', error.message); }
  }
  return new https.Agent({ ca: [...tls.rootCertificates, ...systemCertificates], keepAlive: true, rejectUnauthorized: true });
}
export const publicAgent = createPublicAgent();
export function fetchPublic(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { agent: publicAgent, headers: { Accept: 'application/json' } }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; if (body.length > 2000000) request.destroy(new Error('Odgovor je prevelik')); });
      response.on('error', reject);
      response.on('end', () => resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode, json: async () => JSON.parse(body) }));
    });
    request.setTimeout(10000, () => request.destroy(new Error('Isteklo vreme povezivanja')));
    request.on('error', reject);
  });
}
