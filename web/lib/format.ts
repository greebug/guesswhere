/** Population inputs are stored as bare digits and displayed with thousands
 * separators. `<input type="number">` can't show separators at all -- the
 * browser rejects the formatted value -- so those inputs are type="text" with
 * inputMode="numeric" and these two helpers in between. */

export function parseDigits(value: string): string {
  return value.replace(/\D/g, '');
}

export function formatThousands(digits: string): string {
  if (!digits) return '';
  return Number(digits).toLocaleString('en-US');
}
