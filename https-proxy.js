/**
 * SIRAT — HTTPS proxy untuk port publik 3901.
 *
 * Pola yang sama dengan /var/www/yapsi-landing/https-proxy.js (v11):
 *   - Aplikasi Next.js standalone HTTP di 127.0.0.1:3900 (internal)
 *   - Proxy HTTPS 0.0.0.0:3901 (publik) menggunakan Let's Encrypt
 *     fullchain + privkey untuk *.yapsidarussalam.or.id
 *
 * Tidak ada nginx, tidak ada OpenLiteSpeed. Cloudflared tunnel
 * sudah dikonfigurasi secara terpisah oleh admin.
 *
 * Keamanan:
 *   - x-forwarded-proto: https (Next.js tahu asalnya HTTPS)
 *   - x-forwarded-for: IP klien asli (untuk audit log SIRAT)
 *   - Header keamanan standar (HSTS, X-Content-Type-Options, dll.)
 *   - Tidak ada path rewrite / redirect — semua diteruskan apa adanya.
 *     SIRAT bukan multi-unit; tidak perlu x-yapsi-site.
 */
const https = require("https");
const http = require("http");
const fs = require("fs");

const APP_PORT = 3900; // internal Next.js HTTP (127.0.0.1)
const HTTPS_PORT = 3901; // publik HTTPS

const tlsOptions = {
  key: fs.readFileSync("/etc/letsencrypt/live/yapsidarussalam.or.id/privkey.pem"),
  cert: fs.readFileSync("/etc/letsencrypt/live/yapsidarussalam.or.id/fullchain.pem"),
  // Next.js standalone kadang butuh keep-alive; set minimum TLS 1.2.
  minVersion: "TLSv1.2",
};

const SECURITY_HEADERS = {
  "Strict-Transport-Security": "max-age=15552000",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

function handler(clientReq, clientRes) {
  const headers = {
    ...clientReq.headers,
    "x-forwarded-proto": "https",
    "x-forwarded-for": clientReq.socket.remoteAddress || "",
  };

  const proxyReq = http.request(
    {
      hostname: "127.0.0.1",
      port: APP_PORT,
      path: clientReq.url,
      method: clientReq.method,
      headers,
    },
    (proxyRes) => {
      clientRes.writeHead(proxyRes.statusCode, {
        ...proxyRes.headers,
        ...SECURITY_HEADERS,
      });
      proxyRes.pipe(clientRes, { end: true });
    }
  );

  proxyReq.on("error", (e) => {
    console.error(`[sirat-proxy] upstream error: ${e.message}`);
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { "Content-Type": "text/plain", ...SECURITY_HEADERS });
    }
    clientRes.end("Bad Gateway");
  });

  clientReq.pipe(proxyReq, { end: true });
}

https.createServer(tlsOptions, handler).listen(HTTPS_PORT, "0.0.0.0", () => {
  console.log(`[sirat-proxy] HTTPS :${HTTPS_PORT} -> http://127.0.0.1:${APP_PORT}`);
});
