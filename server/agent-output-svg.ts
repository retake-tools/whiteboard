export function createAgentOutputSvg(executionId: string): string {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768" viewBox="0 0 1024 768">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop stop-color="#eef2ff" offset="0"/>
      <stop stop-color="#cffafe" offset="0.48"/>
      <stop stop-color="#fef3c7" offset="1"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="768" fill="url(#bg)"/>
  <rect x="168" y="132" width="688" height="468" rx="32" fill="#111827"/>
  <rect x="216" y="190" width="592" height="112" rx="20" fill="#f8fafc"/>
  <circle cx="342" cy="438" r="72" fill="#38bdf8"/>
  <circle cx="512" cy="438" r="72" fill="#22c55e"/>
  <circle cx="682" cy="438" r="72" fill="#f97316"/>
  <path d="M292 438 L462 338 L732 438" fill="none" stroke="#f8fafc" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="512" y="680" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="34" fill="#1f2937">Imported Agent Output</text>
  <text x="512" y="724" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="20" fill="#475569">${escapeXml(executionId)}</text>
</svg>
`.trim();
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
