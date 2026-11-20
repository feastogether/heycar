// The official CTS News live player streams directly from YouTube, never via Supabase.
// Verified from https://news.cts.com.tw/live on 2026-11-20.
export const CTS_LIVE_VIDEO_ID = 'wM0g8EoUZ_E';
export function mountLiveNews(root, { videoId = CTS_LIVE_VIDEO_ID } = {}) {
  if (!/^[\w-]{11}$/.test(videoId)) videoId = CTS_LIVE_VIDEO_ID;
  root.innerHTML = `<header class="news-heading"><span><i></i>華視新聞直播</span><button type="button" data-news-sound aria-pressed="false">開啟新聞聲音</button></header>
    <div class="news-video"><iframe id="ttvPlayer" title="華視新聞台 24 小時官方直播" src="https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&playsinline=1&enablejsapi=1&rel=0&origin=${encodeURIComponent(location.origin)}" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>
    <footer class="news-footer"><span data-news-status role="status">正在連接官方直播…</span><a href="https://news.cts.com.tw/live" target="_blank" rel="noopener">官方直播 ↗</a><button type="button" data-news-retry>重新播放</button></footer>`;
  const status = root.querySelector('[data-news-status]');
  const sound = root.querySelector('[data-news-sound]');
  let player, ready = false, wantsSound = false, announcementDepth = 0, destroyed = false;
  const decorateFrame=()=>{const frame=root.querySelector('iframe');if(frame){frame.title='華視新聞台 24 小時官方直播';frame.referrerPolicy='strict-origin-when-cross-origin';}};
  const syncSound = () => {
    if (ready) { if (wantsSound && !announcementDepth) player.unMute(); else player.mute(); }
    else root.querySelector('iframe')?.contentWindow?.postMessage(JSON.stringify({event:'command',func:wantsSound&&!announcementDepth?'unMute':'mute',args:[]}), 'https://www.youtube-nocookie.com');
    sound.textContent = wantsSound ? '關閉新聞聲音' : '開啟新聞聲音';
    sound.setAttribute('aria-pressed', String(wantsSound));
  };
  const load = () => {
    if (destroyed || player || !window.YT?.Player) return;
    player = new window.YT.Player(root.querySelector('#ttvPlayer'), {
      host: 'https://www.youtube-nocookie.com', videoId,
      playerVars: { autoplay: 1, mute: 1, playsinline: 1, rel: 0, origin: location.origin },
      events: {
        onReady: () => { ready = true; decorateFrame();syncSound(); player.playVideo(); status.textContent = '新聞預設靜音；降落廣播優先'; },
        onStateChange: e => { if (e.data === 1) status.textContent = announcementDepth ? '降落廣播中，新聞暫時靜音' : '華視官方直播'; },
        onAutoplayBlocked: () => { status.textContent = '請點播放器的播放鍵，或按「重新播放」'; },
        onError: () => { status.textContent = '直播暫時無法播放，請重試或開啟官方直播'; }
      }
    });
    // Keep the Referer required by YouTube client identification, without sharing the paired URL.
    const frame = player.getIframe?.();
    if (frame) { frame.title = '華視新聞台 24 小時官方直播'; frame.referrerPolicy = 'strict-origin-when-cross-origin'; frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'; }
  };
  sound.addEventListener('click', () => { wantsSound = !wantsSound; syncSound(); if (ready) player.playVideo(); });
  root.querySelector('[data-news-retry]').addEventListener('click', () => {
    if (ready) { player.loadVideoById(videoId); syncSound(); } else boot();
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
  boot();
  return {
    beginAnnouncement() { if(!announcementDepth&&ready&&player.isMuted)wantsSound=!player.isMuted();announcementDepth++; syncSound(); status.textContent = '降落廣播中，新聞暫時靜音'; },
    endAnnouncement() { announcementDepth = Math.max(0, announcementDepth - 1); syncSound(); status.textContent = '華視官方直播'; },
    destroy() { destroyed = true; player?.destroy(); }
  };
}
