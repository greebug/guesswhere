// Exercises every branch of appUrl(). Run with:
//   npx tsx appurl.test.mjs   (from web/)
import { appUrl } from '../lib/appUrl.ts';
import { BASE_PATH } from '../lib/basePath.ts';

let failures = 0;
const eq = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label} -> ${actual}${ok ? '' : ` (expected ${expected})`}`);
};

eq('APP_URL wins', appUrl({ APP_URL: 'https://guesswhere.example', RAILWAY_PUBLIC_DOMAIN: 'x.up.railway.app' }), 'https://guesswhere.example');
eq('APP_URL trailing slash stripped', appUrl({ APP_URL: 'https://guesswhere.example/' }), 'https://guesswhere.example');
eq('APP_URL multiple trailing slashes stripped', appUrl({ APP_URL: 'https://guesswhere.example///' }), 'https://guesswhere.example');
eq('APP_URL whitespace trimmed', appUrl({ APP_URL: '  https://guesswhere.example  ' }), 'https://guesswhere.example');
eq('empty APP_URL falls through', appUrl({ APP_URL: '', RAILWAY_PUBLIC_DOMAIN: 'g.up.railway.app' }), 'https://g.up.railway.app');
eq('whitespace-only APP_URL falls through', appUrl({ APP_URL: '   ', RAILWAY_PUBLIC_DOMAIN: 'g.up.railway.app' }), 'https://g.up.railway.app');

eq('Railway domain gets https://', appUrl({ RAILWAY_PUBLIC_DOMAIN: 'guesswhere-production.up.railway.app' }), 'https://guesswhere-production.up.railway.app');
eq('Railway domain already schemed is not doubled', appUrl({ RAILWAY_PUBLIC_DOMAIN: 'https://g.up.railway.app' }), 'https://g.up.railway.app');
eq('Railway domain trailing slash stripped', appUrl({ RAILWAY_PUBLIC_DOMAIN: 'g.up.railway.app/' }), 'https://g.up.railway.app');

eq('nothing set -> localhost', appUrl({}), 'http://localhost:3000');

// The link shapes the emails actually build. appUrl() resolves the ORIGIN only;
// email.ts appends BASE_PATH because the app is mounted at a sub-path. Getting
// that wrong means every emailed link 404s, so it is asserted here rather than
// left to the reader.
const base = appUrl({ RAILWAY_PUBLIC_DOMAIN: 'guesswhere-production.up.railway.app' });
eq('appUrl returns origin only, no base path', base, 'https://guesswhere-production.up.railway.app');
eq('verify link', `${base}${BASE_PATH}/verify?token=abc`, 'https://guesswhere-production.up.railway.app/guesswhere/verify?token=abc');
eq('reset link', `${base}${BASE_PATH}/reset-password?token=abc`, 'https://guesswhere-production.up.railway.app/guesswhere/reset-password?token=abc');

// A custom-domain deploy is the shape that actually ships.
const prod = appUrl({ APP_URL: 'https://bingbongblitz.com' });
eq('prod verify link', `${prod}${BASE_PATH}/verify?token=abc`, 'https://bingbongblitz.com/guesswhere/verify?token=abc');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
