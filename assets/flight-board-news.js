// The official CTS News live player streams directly from YouTube, never via Supabase.
// Verified from https://news.cts.com.tw/live on 2026-11-20.
export const CTS_LIVE_VIDEO_ID = 'wM0g8EoUZ_E';
export function mountLiveNews(root, { videoId = CTS_LIVE_VIDEO_ID } = {}) {
  if (!/^[\w-]{11}$/.test(videoId)) videoId = CTS_LIVE_VIDEO_ID;
  root.innerHTML = `<header class="news-heading"><span><i></i>華視新聞直播</span><span>靜音直播</span></header>
    <div class="news-video"><iframe id="ttvPlayer" title="華視新聞台 24 小時官方直播" src="https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&playsinline=1&enablejsapi=1&rel=0&origin=${encodeURIComponent(location.origin)}" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>
    <footer class="news-footer"><span data-news-status role="status">正在連接官方直播…</span><a href="https://news.cts.com.tw/live" target="_blank" rel="noopener">官方直播 ↗</a><button type="button" data-news-retry>重新播放</button></footer>`;
  const status = root.querySelector('[data-news-status]');
  let player, ready = false, announcementDepth = 0, destroyed = false, recoveryTimer = null;
  const decorateFrame=()=>{const frame=root.querySelector('iframe');if(frame){frame.title='華視新聞台 24 小時官方直播';frame.referrerPolicy='strict-origin-when-cross-origin';}};
  const syncSound = () => {
    if (ready) player.mute();
    else root.querySelector('iframe')?.contentWindow?.postMessage(JSON.stringify({event:'command',func:'mute',args:[]}), 'https://www.youtube-nocookie.com');
  };
  // Some TV browsers pause the iframe when another media element gains audio focus.
  // Recover the existing stream after speech; never reload it or restore its sound.
  const keepPlaying = () => {
    if (destroyed || !ready || announcementDepth || document.hidden) return;
    syncSound();
    const state = player.getPlayerState?.();
    if (state === undefined || [-1, 0, 2, 5].includes(state)) player.playVideo();
  };
  const scheduleRecovery = () => {
    clearTimeout(recoveryTimer);
    recoveryTimer = setTimeout(keepPlaying, 500);
  };
  const load = () => {
    if (destroyed || player || !window.YT?.Player) return;
    player = new window.YT.Player(root.querySelector('#ttvPlayer'), {
      host: 'https://www.youtube-nocookie.com', videoId,
      playerVars: { autoplay: 1, mute: 1, playsinline: 1, rel: 0, origin: location.origin },
      events: {
        onReady: () => { ready = true; decorateFrame();syncSound(); player.playVideo(); status.textContent = '華視官方直播 · 靜音'; },
        onStateChange: e => { if (e.data === 1) { syncSound(); status.textContent = '華視官方直播 · 靜音'; } else if ([0, 2, 5].includes(e.data)) scheduleRecovery(); },
        onAutoplayBlocked: () => { status.textContent = '請點播放器的播放鍵，或按「重新播放」'; },
        onError: () => { status.textContent = '直播暫時無法播放，請重試或開啟官方直播'; }
      }
    });
    // Keep the Referer required by YouTube client identification, without sharing the paired URL.
    const frame = player.getIframe?.();
    if (frame) { frame.title = '華視新聞台 24 小時官方直播'; frame.referrerPolicy = 'strict-origin-when-cross-origin'; frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'; }
  };
  root.querySelector('[data-news-retry]').addEventListener('click', () => {
    if (ready) { syncSound(); player.loadVideoById(videoId); } else boot();
  });
  function boot() {
    if (window.YT?.Player) { load(); return; }
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { previousReady?.(); load(); };
    if (!document.querySelector('script[data-youtube-api]')) {
      const script = document.createElement('script'); script.src = 'https://www.youtube.com/iframe_api'; script.dataset.youtubeApi = 'true';
      script.onerror = () => { script.remove(); status.textContent = '無法連接直播服務，航班資訊仍可正常使用'; };
      document.head.append(script);
    }
  }
  const recoverOnVisible = () => { if (!document.hidden) keepPlaying(); };
  document.addEventListener('visibilitychange', recoverOnVisible);
  const watchdog = setInterval(keepPlaying, 5000);
  boot();
  return {
    beginAnnouncement() { announcementDepth++; syncSound(); status.textContent = '廣播中 · 新聞維持靜音'; },
    endAnnouncement() { announcementDepth = Math.max(0, announcementDepth - 1); keepPlaying(); scheduleRecovery(); status.textContent = '華視官方直播 · 靜音'; },
    destroy() { destroyed = true; clearTimeout(recoveryTimer); clearInterval(watchdog); document.removeEventListener('visibilitychange', recoverOnVisible); player?.destroy(); }
  };
}
