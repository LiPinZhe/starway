/* Public summaries only. The reader works independently of the scene renderer. */
(() => {
  'use strict';
  const dialog = document.getElementById('researchDialog');
  const heading = document.getElementById('researchHeading');
  const panels = [...dialog.querySelectorAll('[data-paper-panel]')];
  const tabs = [...dialog.querySelectorAll('[data-paper-tab]')];
  const valid = id => panels.some(panel => panel.dataset.paperPanel === id);
  const fromHash = () => location.hash.startsWith('#paper-') ? location.hash.slice(7) : '';
  let returnFocus = null, returnHash = '', ownsEntry = false;

  function show(id) {
    if (!valid(id)) return;
    const opening = !dialog.open;
    if (opening) {
      returnFocus = document.activeElement;
      document.body.classList.add('reading');
      dialog.showModal();
      document.dispatchEvent(new Event('research:open'));
    }
    panels.forEach(panel => {
      panel.hidden = panel.dataset.paperPanel !== id;
      if (!panel.hidden) heading.textContent = panel.dataset.title;
    });
    tabs.forEach(tab => tab.setAttribute('aria-pressed', String(tab.dataset.paperTab === id)));
    dialog.querySelector('.research-scroll').scrollTop = 0;
    heading.focus({ preventScroll: true });
  }

  function syncHash() {
    const id = fromHash();
    if (valid(id)) show(id);
    else if (dialog.open) dialog.close();
  }

  function open(id) {
    if (!valid(id)) return;
    if (!dialog.open) {
      returnHash = location.hash;
      ownsEntry = true;
      history.pushState(history.state, '', `#paper-${id}`);
    } else history.replaceState(history.state, '', `#paper-${id}`);
    show(id);
  }

  function close() {
    if (ownsEntry) { ownsEntry = false; history.back(); }
    else {
      history.replaceState(history.state, '', `${location.pathname}${location.search}${returnHash}`);
      dialog.close();
    }
  }

  document.querySelectorAll('[data-open-paper]').forEach(link => link.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button > 0) return;
    event.preventDefault();
    open(link.dataset.openPaper);
  }));
  tabs.forEach(tab => tab.addEventListener('click', () => open(tab.dataset.paperTab)));
  document.getElementById('closeResearch').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close();
  });
  dialog.addEventListener('close', () => {
    document.body.classList.remove('reading');
    document.dispatchEvent(new Event('research:close'));
    const focus = returnFocus?.isConnected && !returnFocus.closest('[inert]') ? returnFocus : document.getElementById('researchButton');
    focus?.focus({ preventScroll: true });
    ownsEntry = false;
  });
  addEventListener('popstate', syncHash);
  addEventListener('hashchange', syncHash);
  syncHash();
})();
