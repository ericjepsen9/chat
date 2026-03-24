// Set --app-height to exact visible viewport height.
// Runs synchronously in <head> before first render.
(function() {
  function set() {
    var h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    document.documentElement.style.setProperty('--app-height', h + 'px');
  }
  set();
  window.addEventListener('resize', set);
  window.addEventListener('orientationchange', function() { setTimeout(set, 100); });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', set);
  }
})();
