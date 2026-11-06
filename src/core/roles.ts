// Colours for device roles. NetBox stores a hex colour per role (e.g. "aa1409");
// without it, a stable colour is picked from a fixed palette by role name.

const PALETTE = ['1D4ED8', '0F766E', '6D28D9', 'B91C1C', '475569', 'B45309', '0E7490', '9D174D', '3F6212', '1F2937'];

const isHex = (c: string | undefined): c is string => !!c && /^[0-9a-fA-F]{6}$/.test(c);

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Background and readable text colour for a device of the given role. */
export function roleColors(role: string, netboxColor?: string): { bg: string; fg: string } {
  const lower = role.toLowerCase();
  const hex = isHex(netboxColor)
    ? netboxColor
    : /cable|кабел/.test(lower)
      ? 'D6DDDB'
      : /pdu|power|захран/.test(lower)
        ? '57534E'
        : role
          ? PALETTE[hash(lower) % PALETTE.length]
          : '13232B';
  const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  // Relative luminance (WCAG); light backgrounds get dark text.
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return { bg: '#' + hex.toUpperCase(), fg: L > 0.4 ? '#13232B' : '#FFFFFF' };
}
