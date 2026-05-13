// === Homescreen ===

var homescreenSettings = null; // cached {has_image, scale, translateX, translateY}

function renderHomescreenContent() {
  // Kick off async load of homescreen settings + image
  if (!homescreenSettings) {
    fetch('/api/homescreen/settings').then(function(r) { return r.json(); }).then(function(data) {
      homescreenSettings = data;
      if (currentPage === 'home') applyHomescreenBackground();
    }).catch(function() { homescreenSettings = { has_image: false }; });
  } else {
    setTimeout(applyHomescreenBackground, 0);
  }
  return '<div id="homescreen-root">' +
    '<div id="homescreen-bg"></div>' +
    '<div id="homescreen-overlay">' +
      '<div id="homescreen-upload-area">' +
        '<button id="homescreen-plus-btn" onclick="homescreenPickFile()" title="Upload background photo">' +
          '<span class="material-symbols-outlined">add</span>' +
        '</button>' +
        '<p id="homescreen-hint">drag and drop a picture</p>' +
      '</div>' +
    '</div>' +
    '<input type="file" id="homescreen-file-input" accept="image/*" style="display:none" onchange="homescreenFileSelected(this)">' +
  '</div>';
}

function applyHomescreenBackground() {
  var bg = document.getElementById('homescreen-bg');
  var overlay = document.getElementById('homescreen-overlay');
  if (!bg || !overlay) return;
  if (homescreenSettings && homescreenSettings.has_image && homescreenSettings.image_url) {
    var s = homescreenSettings.scale || 1;
    var tx = homescreenSettings.translateX || 0;
    var ty = homescreenSettings.translateY || 0;
    bg.style.backgroundImage = 'url("' + homescreenSettings.image_url + '")';
    bg.style.backgroundSize = (s * 100) + '%';
    bg.style.backgroundPosition = (50 + tx) + '% ' + (50 + ty) + '%';
    bg.style.display = 'block';
    // Hide the upload UI when background exists
    overlay.style.display = 'none';
  } else {
    bg.style.display = 'none';
    overlay.style.display = 'flex';
  }
}

function homescreenPickFile() {
  document.getElementById('homescreen-file-input').click();
}

function homescreenFileSelected(input) {
  if (!input.files || !input.files[0]) return;
  var file = input.files[0];
  if (!file.type.startsWith('image/')) return;
  if (file.size > 10 * 1024 * 1024) { alert('File too large (max 10 MB)'); return; }
  openCropUI(file);
  input.value = '';
}

// Drag and drop on homescreen
document.addEventListener('dragover', function(e) {
  if (currentPage !== 'home' && currentPage !== 'settings') return;
  var area = document.getElementById('homescreen-upload-area') || document.getElementById('settings-bg-drop');
  if (!area) return;
  e.preventDefault();
  area.classList.add('drag-active');
});
document.addEventListener('dragleave', function(e) {
  var area = document.getElementById('homescreen-upload-area') || document.getElementById('settings-bg-drop');
  if (!area) return;
  if (e.target === document || e.target === document.documentElement) {
    area.classList.remove('drag-active');
  }
});
document.addEventListener('drop', function(e) {
  if (currentPage !== 'home' && currentPage !== 'settings') return;
  var area = document.getElementById('homescreen-upload-area') || document.getElementById('settings-bg-drop');
  if (!area) return;
  e.preventDefault();
  area.classList.remove('drag-active');
  var files = e.dataTransfer && e.dataTransfer.files;
  if (!files || !files[0]) return;
  var file = files[0];
  if (!file.type.startsWith('image/')) return;
  if (file.size > 10 * 1024 * 1024) { alert('File too large (max 10 MB)'); return; }
  openCropUI(file);
});

// === Crop UI ===

var cropState = { file: null, url: null, scale: 1, tx: 0, ty: 0, dragging: false, startX: 0, startY: 0, startTx: 0, startTy: 0 };

function openCropUI(file) {
  cropState.file = file;
  cropState.url = URL.createObjectURL(file);
  cropState.scale = 1;
  cropState.tx = 0;
  cropState.ty = 0;

  var overlay = document.createElement('div');
  overlay.id = 'crop-overlay';
  overlay.innerHTML =
    '<div id="crop-backdrop"></div>' +
    '<div id="crop-viewport">' +
      '<img id="crop-image" src="' + cropState.url + '" draggable="false">' +
    '</div>' +
    '<div id="crop-controls">' +
      '<button class="crop-ctrl-btn" onclick="cropZoom(-0.1)" title="Zoom out"><span class="material-symbols-outlined">remove</span></button>' +
      '<span id="crop-zoom-label">100%</span>' +
      '<button class="crop-ctrl-btn" onclick="cropZoom(0.1)" title="Zoom in"><span class="material-symbols-outlined">add</span></button>' +
      '<button class="crop-ctrl-btn crop-save" onclick="cropSave()">Save</button>' +
      '<button class="crop-ctrl-btn crop-cancel" onclick="cropCancel()">Cancel</button>' +
    '</div>';
  document.body.appendChild(overlay);

  var img = document.getElementById('crop-image');
  img.addEventListener('mousedown', cropMouseDown);
  document.addEventListener('mousemove', cropMouseMove);
  document.addEventListener('mouseup', cropMouseUp);
  overlay.addEventListener('wheel', cropWheel, { passive: false });
  updateCropTransform();
}

function cropZoom(delta) {
  cropState.scale = Math.max(0.1, Math.min(5, cropState.scale + delta));
  updateCropTransform();
}

function cropWheel(e) {
  e.preventDefault();
  var delta = e.deltaY > 0 ? -0.05 : 0.05;
  cropZoom(delta);
}

function cropMouseDown(e) {
  e.preventDefault();
  cropState.dragging = true;
  cropState.startX = e.clientX;
  cropState.startY = e.clientY;
  cropState.startTx = cropState.tx;
  cropState.startTy = cropState.ty;
}

function cropMouseMove(e) {
  if (!cropState.dragging) return;
  var viewport = document.getElementById('crop-viewport');
  if (!viewport) return;
  var dx = e.clientX - cropState.startX;
  var dy = e.clientY - cropState.startY;
  // Convert pixel drag to percentage offset
  cropState.tx = cropState.startTx + (dx / viewport.offsetWidth) * 100;
  cropState.ty = cropState.startTy + (dy / viewport.offsetHeight) * 100;
  updateCropTransform();
}

function cropMouseUp() {
  cropState.dragging = false;
}

function updateCropTransform() {
  var img = document.getElementById('crop-image');
  var label = document.getElementById('crop-zoom-label');
  if (!img) return;
  img.style.transform = 'translate(' + cropState.tx + '%, ' + cropState.ty + '%) scale(' + cropState.scale + ')';
  if (label) label.textContent = Math.round(cropState.scale * 100) + '%';
}

function cropCancel() {
  closeCropUI();
}

function cropSave() {
  // Upload file then save settings
  var formData = new FormData();
  formData.append('file', cropState.file);

  var saveBtn = document.querySelector('.crop-save');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

  fetch('/api/homescreen/upload', { method: 'POST', body: formData })
    .then(function(r) { return r.json(); })
    .then(function() {
      // Save crop settings
      return fetch('/api/homescreen/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scale: cropState.scale,
          translateX: cropState.tx,
          translateY: cropState.ty
        })
      });
    })
    .then(function(r) { return r.json(); })
    .then(function() {
      closeCropUI();
      // Re-fetch settings to get fresh presigned URL
      return fetch('/api/homescreen/settings').then(function(r) { return r.json(); });
    })
    .then(function(data) {
      homescreenSettings = data;
      if (currentPage === 'home') applyHomescreenBackground();
      if (currentPage === 'settings') renderSettingsBgPreview();
    })
    .catch(function(err) {
      alert('Upload failed: ' + (err.message || 'Unknown error'));
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
    });
}

function closeCropUI() {
  document.removeEventListener('mousemove', cropMouseMove);
  document.removeEventListener('mouseup', cropMouseUp);
  var overlay = document.getElementById('crop-overlay');
  if (overlay) overlay.remove();
  if (cropState.url) { URL.revokeObjectURL(cropState.url); cropState.url = null; }
}

// === Settings Background Helpers ===

function settingsBgPickFile() {
  document.getElementById('settings-bg-file-input').click();
}

function settingsBgFileSelected(input) {
  if (!input.files || !input.files[0]) return;
  var file = input.files[0];
  if (!file.type.startsWith('image/')) return;
  if (file.size > 10 * 1024 * 1024) { alert('File too large (max 10 MB)'); return; }
  openCropUI(file);
  input.value = '';
}

function settingsBgRemove() {
  if (!confirm('Remove homescreen background?')) return;
  fetch('/api/homescreen/image', { method: 'DELETE' })
    .then(function(r) { return r.json(); })
    .then(function() {
      homescreenSettings = { has_image: false };
      renderSettingsBgPreview();
    });
}

function renderSettingsBgPreview() {
  var container = document.getElementById('settings-bg-current');
  if (!container) return;
  if (homescreenSettings && homescreenSettings.has_image && homescreenSettings.image_url) {
    container.innerHTML = '<img id="settings-bg-preview" src="' + homescreenSettings.image_url + '">' +
      '<br><button class="prod-add-btn secondary" style="height:30px;font-size:0.78rem;margin-top:8px" onclick="settingsBgRemove()"><span class="material-symbols-outlined" style="font-size:0.9rem">delete</span> Remove</button>';
  } else {
    container.innerHTML = '<p style="font-size:0.85rem;color:#9aa0a6;margin:0 0 12px">No background set</p>';
  }
}
