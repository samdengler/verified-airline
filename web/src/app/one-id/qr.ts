import { encode } from 'uqr';

/**
 * A QR code for a short text, such as a session's link, drawn as one SVG path of
 * its dark modules.  uqr (MIT, from Project Nayuki's encoder) does the encoding;
 * the code keeps the four-module quiet zone around it that scanners need.  The
 * template binds the path as an attribute, so nothing needs an inline style or
 * script under the site's content security policy.
 */
export function qrCode(text: string): { size: number; d: string } {
  const { data, size } = encode(text, { ecc: 'M', border: 4 });
  let d = '';
  data.forEach((row, y) => row.forEach((dark, x) => {
    if (dark) d += `M${x} ${y}h1v1h-1z`;
  }));
  return { size, d };
}
