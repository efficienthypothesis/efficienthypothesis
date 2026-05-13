// === Right-click context menu ===
(function() {
  var menu = null;

  function buildMenu() {
    if (menu) menu.remove();
    menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.innerHTML = '<button class="ctx-menu-item" data-action="quickadd">' +
      '<span class="material-symbols-outlined">task_alt</span> Task</button>' +
      '<button class="ctx-menu-item" data-action="action">' +
      '<span class="material-symbols-outlined">schedule</span> Action</button>' +
      '<button class="ctx-menu-item" data-action="note">' +
      '<span class="material-symbols-outlined">note</span> Note</button>' +
      '<button class="ctx-menu-item" data-action="folder">' +
      '<span class="material-symbols-outlined">folder</span> Folder</button>' +
      '<button class="ctx-menu-item" data-action="drafts" id="ctx-drafts-item">' +
      '<span class="material-symbols-outlined">draft</span> Drafts' +
      '<span class="material-symbols-outlined" style="margin-left:auto;font-size:0.9rem">chevron_right</span>' +
      '<div class="ctx-submenu" id="ctx-drafts-submenu"></div></button>';
    document.body.appendChild(menu);

    menu.querySelector('[data-action="quickadd"]').addEventListener('click', function() {
      closeCtxMenu(); openQuickAdd();
    });
    menu.querySelector('[data-action="action"]').addEventListener('click', function() {
      closeCtxMenu(); openActionAdd();
    });
    menu.querySelector('[data-action="note"]').addEventListener('click', function() {
      closeCtxMenu(); openNoteAdd();
    });
    menu.querySelector('[data-action="folder"]').addEventListener('click', function() {
      closeCtxMenu(); openFolderModal(null);
    });

    var draftsItem = menu.querySelector('[data-action="drafts"]');
    var submenu = document.getElementById('ctx-drafts-submenu');
    draftsItem.addEventListener('mouseenter', function() { showDraftsSubmenu(submenu); });
    draftsItem.addEventListener('click', function(e) {
      if (e.target === draftsItem || e.target.closest('[data-action="drafts"]') === draftsItem) {
        showDraftsSubmenu(submenu);
      }
    });
  }

  function showDraftsSubmenu(submenu) {
    if (prodDrafts.length === 0) {
      submenu.innerHTML = '<div class="ctx-submenu-empty">No drafts</div>';
    } else {
      submenu.innerHTML = prodDrafts.map(function(d) {
        var icon, label;
        if (d.draft_type === 'note') { icon = 'note'; label = 'Note'; }
        else if (d.draft_type === 'folder') { icon = 'folder'; label = 'Folder'; }
        else if (d.is_routine_draft) { icon = 'repeat'; label = 'Routine'; }
        else { icon = 'draft'; label = 'Task'; }
        return '<button class="ctx-submenu-item" data-draft-id="' + d.draft_id + '">' +
          '<span class="material-symbols-outlined" style="font-size:0.95rem;color:#9aa0a6">' + icon + '</span> ' +
          escHtml(d.name || 'Untitled draft') +
          '<span style="margin-left:auto;font-size:0.72rem;color:#9aa0a6">' + label + '</span></button>';
      }).join('');
      submenu.querySelectorAll('[data-draft-id]').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          var draftId = btn.dataset.draftId;
          closeCtxMenu();
          resumeDraft(draftId);
        });
      });
    }
    // Position submenu: flip left if it would overflow right edge
    submenu.classList.add('open');
    var rect = submenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      submenu.style.left = 'auto';
      submenu.style.right = '100%';
    }
    if (rect.bottom > window.innerHeight) {
      submenu.style.top = 'auto';
      submenu.style.bottom = '0';
    }
  }

  function closeCtxMenu() {
    if (menu) menu.classList.remove('open');
    var sub = document.getElementById('ctx-drafts-submenu');
    if (sub) { sub.classList.remove('open'); sub.style.left = ''; sub.style.right = ''; sub.style.top = ''; sub.style.bottom = ''; }
  }

  document.addEventListener('contextmenu', function(e) {
    // Don't intercept on input/textarea/select elements
    var tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    // Only intercept inside the app (not on login/home pages)
    if (!document.getElementById('app-content')) return;
    e.preventDefault();
    buildMenu();
    // Position at cursor, flip if near edge
    var x = e.clientX, y = e.clientY;
    menu.classList.add('open');
    var mRect = menu.getBoundingClientRect();
    if (x + mRect.width > window.innerWidth) x = window.innerWidth - mRect.width - 4;
    if (y + mRect.height > window.innerHeight) y = window.innerHeight - mRect.height - 4;
    if (x < 0) x = 4;
    if (y < 0) y = 4;
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
  });

  document.addEventListener('click', function(e) {
    if (menu && !menu.contains(e.target)) closeCtxMenu();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeCtxMenu();
  });
})();
