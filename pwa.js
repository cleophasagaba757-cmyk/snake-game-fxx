(() => {
  'use strict';

  const installBtn = document.getElementById('installBtn');
  const helpEl = document.getElementById('installHelp');
  const helpClose = document.getElementById('installHelpClose');
  const helpText = document.getElementById('installHelpText');
  const toastEl = document.getElementById('pwaToast');

  let deferredPrompt = null;
  let toastTimer = null;

  /* ---------- helpers ---------- */
  function isStandalone() {
    return (
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      (window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches) ||
      window.navigator.standalone === true
    );
  }

  function isIos() {
    const ua = window.navigator.userAgent || '';
    const iPadOs = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
    return /iphone|ipad|ipod/i.test(ua) || iPadOs;
  }

  function showToast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 4500);
  }

  function showInstallButton(show) {
    if (!installBtn) return;
    installBtn.hidden = !show;
  }

  function openHelp(text) {
    if (!helpEl) return;
    if (helpText) helpText.textContent = text;
    helpEl.hidden = false;
  }

  function closeHelp() {
    if (helpEl) helpEl.hidden = true;
  }

  /* ---------- running as an installed app ---------- */
  if (isStandalone()) {
    document.documentElement.classList.add('standalone');
  }

  /* ---------- install experience ---------- */
  // Chrome / Edge / Samsung Internet / Android: fires when the app is installable.
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    if (!isStandalone()) showInstallButton(true);
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    showInstallButton(false);
    closeHelp();
    showToast('Snake 50 installed! Open it from your home screen.');
  });

  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (deferredPrompt) {
        const promptEvent = deferredPrompt;
        deferredPrompt = null; // a prompt can only be used once
        try {
          promptEvent.prompt();
          await promptEvent.userChoice;
          // Hide either way; the browser fires beforeinstallprompt again if it wants to re-offer.
          showInstallButton(false);
        } catch (e) {
          showInstallButton(false);
        }
      } else if (isIos()) {
        openHelp('Tap the Share button in Safari, then choose "Add to Home Screen".');
      }
    });
  }

  if (helpClose) helpClose.addEventListener('click', closeHelp);
  if (helpEl) {
    helpEl.addEventListener('click', (e) => {
      if (e.target === helpEl) closeHelp();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && helpEl && !helpEl.hidden) closeHelp();
  });

  // iOS Safari never fires beforeinstallprompt, so show a manual "how to install" button.
  if (isIos() && !isStandalone()) showInstallButton(true);

  /* ---------- service worker ---------- */
  const secure = window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if ('serviceWorker' in navigator && secure) {
    window.addEventListener('load', () => {
      // Relative URL + scope keep this working inside a GitHub Pages sub-directory.
      navigator.serviceWorker
        .register('service-worker.js', { scope: './' })
        .then((registration) => {
          registration.addEventListener('updatefound', () => {
            const worker = registration.installing;
            if (!worker) return;
            worker.addEventListener('statechange', () => {
              if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                showToast('Update downloaded. It will apply the next time you open the game.');
              }
            });
          });
        })
        .catch((err) => console.warn('Service worker registration failed:', err));
    });
  }

  window.addEventListener('offline', () => showToast('You are offline. The game still works!'));
  window.addEventListener('online', () => showToast('Back online.'));
})();
