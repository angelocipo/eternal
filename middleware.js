export const config = {
  matcher: '/((?!api|_ds|img|blocked.html|favicon.ico).*)',
};

const BLOCKED_COUNTRIES = new Set(['BH', 'BD', 'CN', 'IN', 'IR', 'IQ', 'KW', 'NE', 'NG', 'PK']);

export default function middleware(req) {
  const country = req.headers.get('x-vercel-ip-country');
  if (country && BLOCKED_COUNTRIES.has(country)) {
    const url = new URL('/blocked.html', req.url);
    return Response.redirect(url, 307);
  }
}
