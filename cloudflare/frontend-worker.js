export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/storage" || url.pathname.startsWith("/files/")) {
      return env.STORAGE.fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};
