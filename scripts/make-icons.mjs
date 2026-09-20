// Genera los iconos PNG de la app a partir de apps/web/public/icon.svg (usa el Chromium de Playwright).
// Uso: node scripts/make-icons.mjs
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const svg = readFileSync("apps/web/public/icon.svg", "utf8");
const out = "apps/web/public";
const inner = svg.replace(/<svg[^>]*>/, "").replace("</svg>", "");

// "any": el icono tal cual, con esquinas redondeadas y fondo transparente.
const any = (size) => `<body style="margin:0;background:transparent"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">${inner}</svg></body>`;
// "maskable": fondo a sangre y el dibujo reducido al 62 % para caer en la zona segura (Android lo recorta).
const maskable = (size) => `<body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}"><rect width="512" height="512" fill="#C94A2F"/><g transform="translate(256 256) scale(.62) translate(-256 -256)">${inner.replace(/<rect[^>]*\/>/, "")}</g></svg></body>`;
// iOS aplica su propia máscara: cuadrado completo.
const square = (size) => `<body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}"><rect width="512" height="512" fill="#C94A2F"/><g transform="translate(256 256) scale(.86) translate(-256 -256)">${inner.replace(/<rect[^>]*\/>/, "")}</g></svg></body>`;

const jobs = [
  ["icon-192.png", any(192), 192],
  ["icon-512.png", any(512), 512],
  ["icon-maskable-512.png", maskable(512), 512],
  ["apple-touch-icon.png", square(180), 180],
  ["favicon-32.png", any(32), 32],
];

const browser = await chromium.launch();
for (const [file, html, size] of jobs) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(html);
  await page.screenshot({ path: `${out}/${file}`, omitBackground: true });
  await page.close();
  console.log("✓", file);
}
await browser.close();
