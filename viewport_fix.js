// Set --app-height to exact visible viewport height (fallback for desktop).
// Also reset scroll position to prevent body from being scrolled behind browser chrome.
(function() {
  function set() {
    var h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    document.documentElement.style.setProperty('--app-height', h + 'px');
    // Prevent body from being scrolled (mobile browsers sometimes scroll behind chrome)
    window.scrollTo(0, 0);
  }
  set();
  window.addEventListener('resize', set);
  window.addEventListener('orientationchange', function() { setTimeout(set, 100); });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', set);
    window.visualViewport.addEventListener('scroll', function() {
      window.scrollTo(0, 0);
    });
  }
})();
