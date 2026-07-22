// The GHSL GPKG stores GC_UCN_LIS_2025 (the absorbed-settlement name list)
// as double-encoded UTF-8 for ~754 of 11,422 rows: the bytes were written as
// UTF-8, then read back as Latin-1 and re-encoded. Main names are unaffected.
// Reinterpreting latin1 -> utf8 recovers the original ("Thá»§ Äá»©c" -> "Thủ Đức").

const MOJIBAKE_HINT = /[ÃÂ][\x80-\xBF]|á»|Ä©|Å¡|â€/;

function repairMojibake(s) {
  if (!s || !MOJIBAKE_HINT.test(s)) return s;
  const reinterpreted = Buffer.from(s, 'latin1').toString('utf8');
  // U+FFFD means the latin1 bytes weren't valid UTF-8, so this wasn't
  // mojibake after all -- keep the original rather than corrupting it.
  if (reinterpreted.includes('�')) return s;
  return reinterpreted;
}

module.exports = { repairMojibake };
