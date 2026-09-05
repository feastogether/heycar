export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/storage" || url.pathname.startsWith("/files/")) {
      return env.STORAGE.fetch(request);
    }
    const response = await env.ASSETS.fetch(request);
    if (/\.(html|js|css)$/i.test(url.pathname) || url.pathname === "/" || url.pathname === "") {
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
      headers.set("Pragma", "no-cache");
      headers.set("Expires", "0");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    return response;
  }
};
