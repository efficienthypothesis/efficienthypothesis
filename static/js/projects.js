function getItemTemporalStatus(item) {
  var today = getTodayStr();
  if (item.type === 'task' || item.type === 'routine') {
    var assignDate = item.assign ? utcToLocalDate(item.assign) : '';
    var dueDate = item.due ? utcToLocalDate(item.due) : '';
    if (assignDate && dueDate) {
      if (today < assignDate) return 'future';
      if (today > dueDate) return 'past';
      return 'present';
    } else if (assignDate) {
      if (today < assignDate) return 'future';
      if (today > assignDate) return 'past';
      return 'present';
    } else if (dueDate) {
      if (today < dueDate) return 'future';
      if (today > dueDate) return 'past';
      return 'present';
    }
    return 'present';
  }
  if (item.type === 'note') {
    var noteDate = item.due || '';
    if (!noteDate) return 'present';
    if (noteDate === today) return 'present';
    return noteDate < today ? 'past' : 'future';
  }
  if (item.type === 'action') {
    var startDate = item.assign ? utcToLocalDate(item.assign) : '';
    var endDate = item.due ? utcToLocalDate(item.due) : '';
    if (startDate === today || endDate === today) return 'present';
    if (startDate && startDate > today) return 'future';
    if (endDate && endDate < today) return 'past';
    if (startDate && startDate < today) return 'past';
    return 'present';
  }
  return 'present';
}

function isItemVisibleByTimeFilter(item) {
  var status = getItemTemporalStatus(item);
  if (item.done) {
    var tf = projectsTimeFilter.completed;
    return tf[status];
  }
  if (item.type === 'note') {
    var tf = projectsTimeFilter.notes;
    return tf[status];
  }
  // tasks, routines, actions — no time filter rule yet, always show
  return true;
}

function getFolderById(folderId) {
  if (!folderId) return null;
  return prodFolders.find(function(g) { return g.id === folderId; }) || null;
}

function getFolderColor(folderId) {
  if (!folderId) return null;
  var folder = getFolderById(folderId);
  if (folder) return folder.color;
  return null;
}

function getFolderLabel(folder) {
  if (!folder) return '';
  var names = [];
  var current = folder;
  var guard = 0;
  while (current && guard < 20) {
    names.unshift(current.name || '');
    current = getFolderById(current.parent_id);
    guard++;
  }
  return names.filter(Boolean).join(' / ');
}

function resolveFolderInput(value) {
  var raw = (value || '').trim().toLowerCase();
  if (!raw) return null;
  return prodFolders.find(function(g) {
    return (g.id || '').toLowerCase() === raw
      || (g.name || '').toLowerCase() === raw
      || getFolderLabel(g).toLowerCase() === raw;
  }) || null;
}

function getUnfiledItems() {
  // All non-draft, non-routine-instance tasks + routines + notes without a folder, sorted by created_at desc
  var tasks = (prodAllTasks || []).filter(function(t) {
    return !t.draft && !t.routine_id && !t.folder_id;
  });
  var routines = (prodRoutines || []).filter(function(r) { return !r.folder_id; });
  var notes = (prodNotes || []).filter(function(n) { return !n.folder_id; });
  var items = [];
  tasks.forEach(function(t) { items.push({type: 'task', id: t.task_id, name: t.name, assign: t.assign_datetime, due: t.due_datetime, done: !!t.end_datetime, created_at: t.created_at || ''}); });
  routines.forEach(function(r) { items.push({type: 'routine', id: r.id, name: r.name, due: null, done: false, created_at: r.created_at || ''}); });
  notes.forEach(function(n) { items.push({type: 'note', id: n.id, name: n.name, due: n.date, done: false, created_at: n.created_at || ''}); });
  items.sort(function(a, b) { return (b.created_at || '').localeCompare(a.created_at || ''); });
  return items;
}

function getFolderItems(folderId) {
  var tasks = (prodAllTasks || []).filter(function(t) {
    return !t.draft && !t.routine_id && t.folder_id === folderId;
  });
  var routines = (prodRoutines || []).filter(function(r) { return r.folder_id === folderId; });
  var notes = (prodNotes || []).filter(function(n) { return n.folder_id === folderId; });
  var items = [];
  tasks.forEach(function(t) { items.push({type: 'task', id: t.task_id, name: t.name, assign: t.assign_datetime, due: t.due_datetime, done: !!t.end_datetime, created_at: t.created_at || ''}); });
  routines.forEach(function(r) { items.push({type: 'routine', id: r.id, name: r.name, due: null, done: false, created_at: r.created_at || ''}); });
  notes.forEach(function(n) { items.push({type: 'note', id: n.id, name: n.name, due: n.date, done: false, created_at: n.created_at || ''}); });
  items.sort(function(a, b) { return (b.created_at || '').localeCompare(a.created_at || ''); });
  return items;
}

function renderFolderItemHtml(item) {
  if (!projectsShowCompleted && item.done) return '';
  if (!projectsShowNotes && item.type === 'note') return '';
  if (!isItemVisibleByTimeFilter(item)) return '';
  var doneClass = item.done ? ' folder-item-done' : '';
  var icon = item.type === 'routine' ? 'repeat' : (item.type === 'note' ? 'note' : 'task_alt');
  var dueHtml = '';
  if (item.type === 'note' && item.due) {
    dueHtml = '<span class="folder-item-due">' + escHtml(item.due) + '</span>';
  } else if (item.due) {
    dueHtml = '<span class="folder-item-due">' + formatDateTime(item.due) + '</span>';
  }
  return '<div class="folder-item' + doneClass + '" draggable="true" data-item-id="' + item.id + '" data-item-type="' + item.type + '"' +
    ' ondragstart="onFolderItemDragStart(event)" ondragend="onFolderItemDragEnd(event)">' +
    '<span class="material-symbols-outlined folder-item-icon">' + icon + '</span>' +
    '<span class="folder-item-name">' + escHtml(item.name) + '</span>' + dueHtml + '</div>';
}

function getRootFolders() {
  return prodFolders.filter(function(g) { return !g.parent_id; });
}

function getChildFolders(parentId) {
  return prodFolders.filter(function(g) { return g.parent_id === parentId; });
}

// === Layout Algorithm ===
var LY_TOP_COLS = 4;
var LY_EST_ITEM_H = 34;
var LY_EST_HEADER_H = 36;
var LY_GAP = 16;
var projectsNeedsReorganize = false;

function getVisibleItems(folderId) {
  return getFolderItems(folderId).filter(function(item) {
    if (!projectsShowCompleted && item.done) return false;
    if (!projectsShowNotes && item.type === 'note') return false;
    if (!isItemVisibleByTimeFilter(item)) return false;
    return true;
  });
}

function buildFolderTree() {
  var nodeMap = {};
  prodFolders.forEach(function(g) {
    nodeMap[g.id] = { folder: g, children: [], items: getVisibleItems(g.id) };
  });
  prodFolders.forEach(function(g) {
    if (g.parent_id && nodeMap[g.parent_id]) nodeMap[g.parent_id].children.push(nodeMap[g.id]);
  });
  var roots = [];
  prodFolders.forEach(function(g) {
    if (!g.parent_id) roots.push(nodeMap[g.id]);
  });
  if (!projectsShowEmptyFolders) {
    function hasContent(node) {
      if (node.items.length > 0) return true;
      for (var i = 0; i < node.children.length; i++) {
        if (hasContent(node.children[i])) return true;
      }
      return false;
    }
    function prune(node) {
      node.children = node.children.filter(function(child) {
        prune(child);
        return hasContent(child);
      });
    }
    roots.forEach(prune);
    roots = roots.filter(hasContent);
  }
  return roots;
}

function countAllItems(node) {
  var count = node.items.length;
  for (var i = 0; i < node.children.length; i++) count += countAllItems(node.children[i]);
  return count;
}

// === Visual mode constants ===
var VIS_MAX_DISPLAY_ITEMS = 5; // max items shown per card
var VIS_D2_FIXED_H = LY_EST_HEADER_H + VIS_MAX_DISPLAY_ITEMS * LY_EST_ITEM_H + 20; // depth-2 card fixed height
var VIS_CATCHALL_FIXED_H = VIS_MAX_DISPLAY_ITEMS * LY_EST_ITEM_H + 20; // catchall (no header)
var VIS_BOX_PAD = 20; // body padding + border for depth-1 cards

// === Tree helpers ===
function findNodeById(nodes, folderId) {
  for (var i = 0; i < nodes.length; i++) {
    if (nodes[i].folder.id === folderId) return nodes[i];
    var found = findNodeById(nodes[i].children, folderId);
    if (found) return found;
  }
  return null;
}

function buildFocusedTree(focusId) {
  var allRoots = buildFolderTree();
  if (!focusId) {
    return { focusFolder: null, children: allRoots, directItems: getVisibleUnfiledItems() };
  }
  var focusNode = findNodeById(allRoots, focusId);
  if (!focusNode) {
    projectsFocusPath = null;
    return { focusFolder: null, children: allRoots, directItems: getVisibleUnfiledItems() };
  }
  return { focusFolder: focusNode.folder, children: focusNode.children, directItems: focusNode.items };
}

function getVisibleUnfiledItems() {
  return getUnfiledItems().filter(function(item) {
    if (!projectsShowCompleted && item.done) return false;
    if (!projectsShowNotes && item.type === 'note') return false;
    if (!isItemVisibleByTimeFilter(item)) return false;
    return true;
  });
}

// === Render items with limit (shows first N-1 + "+X more") ===
function renderItemsWithLimit(items, subfolders, limit) {
  // Merge subfolders (depth 3+) as item-like entries, then real items
  var allEntries = [];
  (subfolders || []).forEach(function(sg) {
    allEntries.push({ _isSubfolder: true, folder: sg.folder, _totalItems: countAllItems(sg) });
  });
  items.forEach(function(item) { allEntries.push(item); });

  var html = '';
  var total = allEntries.length;
  var showCount = total <= limit ? total : limit - 1;
  for (var i = 0; i < showCount; i++) {
    var entry = allEntries[i];
    if (entry._isSubfolder) {
      html += renderSubfolderAsItem(entry);
    } else {
      html += renderFolderItemHtml(entry);
    }
  }
  if (total > limit) {
    var remaining = total - showCount;
    html += '<div class="folder-item folder-item-more">+' + remaining + ' more</div>';
  }
  return html;
}

function renderSubfolderAsItem(entry) {
  var id = escHtml(entry.folder.id);
  return '<div class="folder-item folder-item-subfolder" ondblclick="event.stopPropagation();projectsZoomIn(\'' + id + '\')">' +
    '<span class="material-symbols-outlined folder-item-icon">folder</span>' +
    '<span class="folder-item-name">' + escHtml(entry.folder.name) + '</span>' +
    '<span class="folder-item-due" style="color:#80868b">' + entry._totalItems + '</span></div>';
}

// === Depth-2 card (small, fixed height, 1 col) ===
function renderDepth2Card(node) {
  var folder = node.folder;
  var folderColor = escHtml(folder.color || DEFAULT_COLOR);
  // Depth-3+ children become items with folder icons
  var depth3Folders = node.children || [];
  var items = node.items || [];
  var bodyHtml = renderItemsWithLimit(items, depth3Folders, VIS_MAX_DISPLAY_ITEMS);

  return '<div class="folder-box folder-box-d2" data-folder-id="' + escHtml(folder.id) +
    '" style="--folder-color:' + folderColor + ';border-color:' + folderColor +
    ';height:' + VIS_D2_FIXED_H + 'px"' +
    ' ondblclick="event.stopPropagation();projectsZoomIn(\'' + escHtml(folder.id) + '\')"' +
    ' ondragover="onFolderBoxDragOver(event)" ondragleave="onFolderBoxDragLeave(event)" ondrop="onFolderBoxDrop(event)">' +
    '<div class="folder-box-header">' +
    '<span class="folder-box-name">' + escHtml(folder.name) + '</span>' +
    '<div class="folder-box-actions" onclick="event.stopPropagation()">' +
    '<button class="folder-box-actions-btn" onclick="event.stopPropagation();toggleFolderDropdown(this)"><span class="material-symbols-outlined">more_vert</span></button>' +
    '<div class="folder-box-dropdown">' +
    '<button class="folder-box-dd-item" onclick="event.stopPropagation();editFolder(\'' + escHtml(folder.id) + '\')"><span class="material-symbols-outlined">edit</span> Edit</button>' +
    '<button class="folder-box-dd-item danger" onclick="event.stopPropagation();deleteFolder(\'' + escHtml(folder.id) + '\')"><span class="material-symbols-outlined">delete</span> Delete</button>' +
    '</div></div></div>' +
    '<div class="folder-box-body">' + bodyHtml + '</div></div>';
}

// === Catchall card (no header, for direct items) ===
function renderCatchallCard(items, parentId) {
  var bodyHtml = renderItemsWithLimit(items, [], VIS_MAX_DISPLAY_ITEMS);
  return '<div class="folder-box-catchall" data-folder-id="' + escHtml(parentId || '') + '"' +
    ' style="height:' + VIS_CATCHALL_FIXED_H + 'px"' +
    ' ondragover="onFolderBoxDragOver(event)" ondragleave="onFolderBoxDragLeave(event)" ondrop="onFolderBoxDrop(event)">' +
    '<div class="folder-box-body">' + bodyHtml + '</div></div>';
}

// === Depth-1 card (large, contains depth-2 grid) ===
function renderDepth1Card(node, directItems) {
  var folder = node.folder;
  var folderColor = escHtml(folder.color || DEFAULT_COLOR);
  var depth2Children = node.children || [];
  var hasDirectItems = directItems && directItems.length > 0;
  // Only use catchall card when there are BOTH subfolders and direct items
  // Count depth-2 slots: subfolders + 1 for direct items if both exist
  var hasMixedContent = hasDirectItems && depth2Children.length > 0;
  var numD2 = depth2Children.length + (hasMixedContent ? 1 : 0);
  var cols = Math.min(numD2, LY_TOP_COLS);
  if (cols < 1) cols = 1;
  node.layoutCols = cols;

  // Height: always use depth-2 card row height (min 1 row so all depth-1 cards match)
  var rows = Math.max(Math.ceil(numD2 / cols), 1);
  var innerCardH = VIS_D2_FIXED_H;
  var d1Height = LY_EST_HEADER_H + rows * (innerCardH + LY_GAP) - LY_GAP + VIS_BOX_PAD;

  // Render inner content
  var innerHtml = '';
  if (depth2Children.length === 0 && hasDirectItems) {
    // No subfolders — render items directly in body (no wrapper)
    innerHtml = renderItemsWithLimit(directItems, [], VIS_MAX_DISPLAY_ITEMS);
  } else {
    depth2Children.forEach(function(child) {
      innerHtml += renderDepth2Card(child);
    });
    if (hasMixedContent) {
      // Direct items alongside subfolders — render without catchall styling
      var catchallBody = renderItemsWithLimit(directItems, [], VIS_MAX_DISPLAY_ITEMS);
      innerHtml += '<div style="height:' + VIS_D2_FIXED_H + 'px;overflow:hidden"' +
        ' data-folder-id="' + escHtml(folder.id) + '"' +
        ' ondragover="onFolderBoxDragOver(event)" ondragleave="onFolderBoxDragLeave(event)" ondrop="onFolderBoxDrop(event)">' +
        '<div class="folder-box-body">' + catchallBody + '</div></div>';
    }
  }

  return '<div class="folder-box" data-folder-id="' + escHtml(folder.id) +
    '" style="--folder-color:' + folderColor + ';border-color:' + folderColor + ';min-height:' + d1Height + 'px"' +
    ' ondblclick="projectsZoomIn(\'' + escHtml(folder.id) + '\')"' +
    ' ondragover="onFolderBoxDragOver(event)" ondragleave="onFolderBoxDragLeave(event)" ondrop="onFolderBoxDrop(event)">' +
    '<div class="folder-box-header">' +
    '<span class="folder-box-name">' + escHtml(folder.name) + '</span>' +
    '<div class="folder-box-actions" onclick="event.stopPropagation()">' +
    '<button class="folder-box-actions-btn" onclick="event.stopPropagation();toggleFolderDropdown(this)"><span class="material-symbols-outlined">more_vert</span></button>' +
    '<div class="folder-box-dropdown">' +
    '<button class="folder-box-dd-item" onclick="event.stopPropagation();editFolder(\'' + escHtml(folder.id) + '\')"><span class="material-symbols-outlined">edit</span> Edit</button>' +
    '<button class="folder-box-dd-item danger" onclick="event.stopPropagation();deleteFolder(\'' + escHtml(folder.id) + '\')"><span class="material-symbols-outlined">delete</span> Delete</button>' +
    '</div></div></div>' +
    '<div class="folder-box-body layout-packed-body" style="grid-template-columns:repeat(' + cols + ',1fr)">' +
    innerHtml + '</div></div>';
}

// === Visual mode masonry ===
function estimateDepth1Height(node, directItems) {
  var depth2Children = node.children || [];
  var hasDirectItems = directItems && directItems.length > 0;
  var hasMixedContent = hasDirectItems && depth2Children.length > 0;
  var numD2 = depth2Children.length + (hasMixedContent ? 1 : 0);
  var cols = Math.min(numD2, LY_TOP_COLS);
  if (cols < 1) cols = 1;
  var rows = Math.max(Math.ceil(numD2 / cols), 1);
  var innerCardH = VIS_D2_FIXED_H;
  return LY_EST_HEADER_H + rows * (innerCardH + LY_GAP) - LY_GAP + VIS_BOX_PAD;
}

function renderProjectsVisual() {
  var el = document.getElementById('prod-projects'); if (!el) return;
  var focused = buildFocusedTree(projectsFocusPath);
  var depth1Nodes = focused.children;
  var directItems = focused.directItems;

  if (depth1Nodes.length === 0 && directItems.length === 0) {
    el.innerHTML = '<p class="prod-empty">No folders here. Right-click and select "Folder" to create one.</p>';
    return;
  }

  // Build render list: each depth-1 node + catchall for root-level direct items
  var renderItems = []; // { html, cols, height }
  depth1Nodes.forEach(function(node) {
    var nodeDirectItems = node.items || [];
    var h = estimateDepth1Height(node, nodeDirectItems);
    var hasDirectItems = nodeDirectItems.length > 0;
    var hasCatchall = hasDirectItems && node.children.length > 0;
    var numD2 = node.children.length + (hasCatchall ? 1 : 0);
    // Items-only cards (no subfolders) take 1 column
    var cols = numD2 > 0 ? Math.min(numD2, LY_TOP_COLS) : 1;
    renderItems.push({ html: renderDepth1Card(node, nodeDirectItems), cols: cols, height: h });
  });

  // Root-level direct items: place individually into masonry (no wrapper)
  directItems.forEach(function(item) {
    var itemHtml = renderFolderItemHtml(item);
    if (itemHtml) {
      renderItems.push({ html: itemHtml, cols: 1, height: LY_EST_ITEM_H });
    }
  });

  // Sort tallest first for better packing
  renderItems.sort(function(a, b) { return b.height - a.height; });

  // Absolute-positioned masonry
  var colH = [0, 0, 0, 0];
  var placements = [];

  renderItems.forEach(function(item) {
    var span = Math.min(item.cols, LY_TOP_COLS);
    var bestStart = 0, bestY = Infinity;
    for (var s = 0; s <= LY_TOP_COLS - span; s++) {
      var maxY = 0;
      for (var c = s; c < s + span; c++) {
        if (colH[c] > maxY) maxY = colH[c];
      }
      if (maxY < bestY) { bestY = maxY; bestStart = s; }
    }
    placements.push({ html: item.html, col: bestStart, top: bestY, span: span });
    var newH = bestY + item.height + LY_GAP;
    for (var c = bestStart; c < bestStart + span; c++) colH[c] = newH;
  });

  var maxH = 0;
  for (var i = 0; i < LY_TOP_COLS; i++) { if (colH[i] > maxH) maxH = colH[i]; }

  var html = '<div style="position:relative;min-height:' + maxH + 'px">';
  placements.forEach(function(p) {
    var leftCalc = p.col === 0 ? '0' : 'calc(' + (p.col * 25) + '% + ' + (p.col * 2.5) + 'px)';
    var widthCalc = p.span === LY_TOP_COLS ? '100%' : 'calc(' + (p.span * 25) + '% + ' + (p.span * 2.5 - 10) + 'px)';
    html += '<div style="position:absolute;top:' + p.top + 'px;left:' + leftCalc + ';width:' + widthCalc + '">';
    html += p.html;
    html += '</div>';
  });
  html += '</div>';
  el.innerHTML = html;
}

// === List mode ===
function renderProjectsList() {
  var el = document.getElementById('prod-projects'); if (!el) return;
  var roots = buildFolderTree();
  var ungrouped = getVisibleUnfiledItems();
  var rootLabel = userEmail || 'Projects';

  var html = '<div class="list-tree-node">';
  // Root row (always expanded)
  html += '<div class="list-tree-row" onclick="toggleListNode(this)">';
  html += '<span class="list-tree-chevron expanded material-symbols-outlined">chevron_right</span>';
  html += '<span class="list-tree-icon list-tree-icon-folder material-symbols-outlined">folder</span>';
  html += '<span class="list-tree-name">' + escHtml(rootLabel) + '</span>';
  html += '</div>';
  html += '<div class="list-tree-children">';
  roots.forEach(function(node) { html += renderListTreeNode(node, 1); });
  ungrouped.forEach(function(item) { html += renderListTreeItem(item, 1); });
  html += '</div></div>';

  el.innerHTML = html;
}

function renderListTreeNode(node, depth) {
  var folder = node.folder;
  var items = node.items || [];
  var children = node.children || [];
  var totalItems = countAllItems(node);
  var indent = depth * 20;
  var hasChildren = children.length > 0 || items.length > 0;
  var colorDot = (folder.color && folder.color !== '#000000' && folder.color !== DEFAULT_COLOR)
    ? '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + escHtml(folder.color) + ';margin-right:2px;flex-shrink:0"></span>' : '';

  var html = '<div class="list-tree-node" data-folder-id="' + escHtml(folder.id) + '"' +
    ' ondragover="onListTreeDragOver(event)" ondragleave="onListTreeDragLeave(event)" ondrop="onListTreeDrop(event)">';
  html += '<div class="list-tree-row" onclick="toggleListNode(this)" ondblclick="projectsZoomIn(\'' + escHtml(folder.id) + '\')">';
  html += '<span style="width:' + indent + 'px" class="list-tree-indent"></span>';
  if (hasChildren) {
    html += '<span class="list-tree-chevron material-symbols-outlined">chevron_right</span>';
  } else {
    html += '<span style="width:20px" class="list-tree-indent"></span>';
  }
  html += colorDot;
  html += '<span class="list-tree-icon list-tree-icon-folder material-symbols-outlined">folder</span>';
  html += '<span class="list-tree-name">' + escHtml(folder.name) + '</span>';
  if (totalItems > 0) html += '<span class="list-tree-count">(' + totalItems + ')</span>';
  html += '</div>';

  if (hasChildren) {
    html += '<div class="list-tree-children" style="display:none">';
    children.forEach(function(child) { html += renderListTreeNode(child, depth + 1); });
    items.forEach(function(item) { html += renderListTreeItem(item, depth + 1); });
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function renderListTreeItem(item, depth) {
  if (!projectsShowCompleted && item.done) return '';
  if (!projectsShowNotes && item.type === 'note') return '';
  if (!isItemVisibleByTimeFilter(item)) return '';
  var indent = depth * 20 + 20; // extra 20 for no chevron
  var icon = item.type === 'routine' ? 'repeat' : (item.type === 'note' ? 'note' : 'task_alt');
  var doneClass = item.done ? ' folder-item-done' : '';
  return '<div class="list-tree-item' + doneClass + '" draggable="true" data-item-id="' + item.id + '" data-item-type="' + item.type + '"' +
    ' ondragstart="onFolderItemDragStart(event)" ondragend="onFolderItemDragEnd(event)">' +
    '<span style="width:' + indent + 'px" class="list-tree-indent"></span>' +
    '<span class="list-tree-icon material-symbols-outlined">' + icon + '</span>' +
    '<span class="list-tree-name">' + escHtml(item.name) + '</span></div>';
}

function toggleListNode(rowEl) {
  var node = rowEl.closest('.list-tree-node');
  if (!node) return;
  var children = node.querySelector(':scope > .list-tree-children');
  var chevron = rowEl.querySelector('.list-tree-chevron');
  if (!children) return;
  var isOpen = children.style.display !== 'none';
  children.style.display = isOpen ? 'none' : '';
  if (chevron) chevron.classList.toggle('expanded', !isOpen);
}

// List mode drag-drop on tree nodes
function onListTreeDragOver(e) {
  e.preventDefault();
  var node = e.target.closest('.list-tree-node');
  if (node) node.querySelector('.list-tree-row').style.background = '#e8f0fe';
}
function onListTreeDragLeave(e) {
  var node = e.target.closest('.list-tree-node');
  if (node && !node.contains(e.relatedTarget)) node.querySelector('.list-tree-row').style.background = '';
}
function onListTreeDrop(e) {
  e.preventDefault(); e.stopPropagation();
  var node = e.target.closest('.list-tree-node');
  if (!node || !folderDraggedItemId) return;
  node.querySelector('.list-tree-row').style.background = '';
  var targetFolderId = node.dataset.folderId;
  if (targetFolderId) assignItemFolder(folderDraggedItemId, folderDraggedItemType, targetFolderId);
}

// === Main render dispatcher ===
function renderProjects() {
  var el = document.getElementById('prod-projects'); if (!el) return;
  if (projectsViewMode === 'list') {
    renderProjectsList();
  } else {
    renderProjectsVisual();
  }
}

function renderProjectsInPlace() {
  renderProjects();
}

// --- Group box interactions ---
function toggleFolderCollapse(headerEl) {
  var body = headerEl.nextElementSibling;
  var toggle = headerEl.querySelector('.folder-box-toggle');
  if (body) body.classList.toggle('collapsed');
  if (toggle) toggle.classList.toggle('collapsed');
}

function toggleFolderDropdown(btn) {
  var dd = btn.nextElementSibling;
  // Close others
  document.querySelectorAll('.folder-box-dropdown.open').forEach(function(d) { d.classList.remove('open'); });
  if (dd) dd.classList.toggle('open');
}

// Close folder dropdowns on click outside
document.addEventListener('click', function(e) {
  if (!e.target.closest('.folder-box-actions')) {
    document.querySelectorAll('.folder-box-dropdown.open').forEach(function(d) { d.classList.remove('open'); });
  }
});

function deleteFolder(folderId) {
  document.querySelectorAll('.folder-box-dropdown.open').forEach(function(d) { d.classList.remove('open'); });
  var folder = getFolderById(folderId);
  var label = folder ? getFolderLabel(folder) : folderId;
  if (!confirm('Delete folder "' + label + '" and all subfolders? Items will become unclassified.')) return;
  fetch('/api/folders', {method: 'DELETE', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: folderId})})
    .then(function(r) { if (!r.ok) throw 0; return r.json(); })
    .then(function() { refreshData(); })
    .catch(function() { alert('Failed to delete folder.'); });
}

function editFolder(folderId) {
  document.querySelectorAll('.folder-box-dropdown.open').forEach(function(d) { d.classList.remove('open'); });
  var folder = getFolderById(folderId);
  if (!folder) return;
  openFolderModal(folder);
}

// --- Drag and drop for folders ---
var folderDraggedItemId = null;
var folderDraggedItemType = null;

function onFolderItemDragStart(e) {
  var el = e.target.closest('.folder-item');
  if (!el) return;
  folderDraggedItemId = el.dataset.itemId;
  folderDraggedItemType = el.dataset.itemType;
  el.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', folderDraggedItemId);
  var ws = document.getElementById('projects-whitespace');
  if (ws) ws.classList.add('drag-active');
}

function onFolderItemDragEnd(e) {
  var el = e.target.closest('.folder-item');
  if (el) el.classList.remove('dragging');
  folderDraggedItemId = null;
  folderDraggedItemType = null;
  document.querySelectorAll('.folder-box.drag-over-folder').forEach(function(b) { b.classList.remove('drag-over-folder'); });
  var ws = document.getElementById('projects-whitespace');
  if (ws) ws.classList.remove('drag-active', 'drag-over');
}

function onFolderBoxDragOver(e) {
  e.preventDefault();
  var box = e.target.closest('.folder-box');
  if (box) box.classList.add('drag-over-folder');
}

function onFolderBoxDragLeave(e) {
  var box = e.target.closest('.folder-box');
  if (box && !box.contains(e.relatedTarget)) box.classList.remove('drag-over-folder');
}

function onFolderBoxDrop(e) {
  e.preventDefault(); e.stopPropagation();
  var box = e.target.closest('.folder-box');
  if (!box || !folderDraggedItemId) return;
  box.classList.remove('drag-over-folder');
  var targetFolderId = box.dataset.folderId;
  assignItemFolder(folderDraggedItemId, folderDraggedItemType, targetFolderId);
}

function onProjectsWhitespaceDragOver(e) {
  e.preventDefault();
  e.target.classList.add('drag-over');
}
function onProjectsWhitespaceDragLeave(e) {
  e.target.classList.remove('drag-over');
}
function onProjectsWhitespaceDrop(e) {
  e.preventDefault();
  e.target.classList.remove('drag-over', 'drag-active');
  if (!folderDraggedItemId) return;
  assignItemFolder(folderDraggedItemId, folderDraggedItemType, null);
}

function assignItemFolder(itemId, itemType, folderId) {
  if (itemType === 'routine') {
    fetch('/api/routines/' + itemId, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({folder_id: folderId})})
      .then(function(r) { if (!r.ok) throw 0; return r.json(); })
      .then(function() { refreshData(); })
      .catch(function() { alert('Failed to assign routine to folder.'); });
  } else if (itemType === 'note') {
    fetch('/api/notes/' + itemId, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({folder_id: folderId})})
      .then(function(r) { if (!r.ok) throw 0; return r.json(); })
      .then(function() { refreshData(); })
      .catch(function() { alert('Failed to assign note to folder.'); });
  } else {
    fetch('/api/tasks/' + itemId, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({folder_id: folderId})})
      .then(function(r) { if (!r.ok) throw 0; return r.json(); })
      .then(function() { refreshData(); })
      .catch(function() { alert('Failed to assign task to folder.'); });
  }
}

function toggleNoteDropdown(btn, noteId) {
  var existing = document.querySelector('.note-dropdown-menu');
  if (existing) { existing.remove(); return; }
  var menu = document.createElement('div');
  menu.className = 'note-dropdown-menu';
  menu.innerHTML = '<button onclick="editNote(\'' + noteId + '\');this.parentNode.remove()"><span class="material-symbols-outlined" style="font-size:16px">edit</span> Edit</button>' +
    '<button onclick="deleteNote(\'' + noteId + '\');this.parentNode.remove()"><span class="material-symbols-outlined" style="font-size:16px">delete</span> Delete</button>';
  btn.parentNode.appendChild(menu);
  setTimeout(function() {
    document.addEventListener('click', function handler(e) {
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', handler); }
    });
  }, 0);
}

// --- Group creation modal (factory) ---
var GA_PALETTE = [
  '#000000','#434343','#666666','#999999','#b7b7b7','#cccccc','#d9d9d9','#efefef','#f3f3f3','#ffffff',
  '#980000','#ff0000','#ff9900','#ffff00','#00ff00','#00ffff','#4a86e8','#0000ff','#9900ff','#ff00ff',
  '#e6b8af','#f4cccc','#fce5cd','#fff2cc','#d9ead3','#d0e0e3','#c9daf8','#cfe2f3','#d9d2e9','#ead1dc',
  '#dd7e6b','#ea9999','#f9cb9c','#ffe599','#b6d7a8','#a2c4c9','#a4c2f4','#9fc5e8','#b4a7d6','#d5a6bd',
  '#cc4125','#e06666','#f6b26b','#ffd966','#93c47d','#76a5af','#6d9eeb','#6fa8dc','#8e7cc3','#c27ba0',
  '#a61c00','#cc0000','#e69138','#f1c232','#6aa84f','#45818e','#3c78d8','#3d85c6','#674ea7','#a64d79',
  '#85200c','#990000','#b45f06','#bf9000','#38761d','#134f5c','#1155cc','#0b5394','#351c75','#741b47',
  '#5b0f00','#660000','#783f04','#7f6000','#274e13','#0c343d','#1c4587','#073763','#20124d','#4c1130'
];

function createFolderCard(existingFolder) {
  var editingFolderId = existingFolder ? existingFolder.id : null;
  var selectedColor = existingFolder ? (existingFolder.color || DEFAULT_COLOR) : DEFAULT_COLOR;
  var draftId = null;
  var draftSaveTimer = null;

  var cardEl = document.createElement('div');
  cardEl.className = 'quickadd-card';
  cardEl.innerHTML =
    '<div class="quickadd-header ga-header">Group</div>' +
    '<div class="quickadd-body">' +
      '<input class="quickadd-input gm-name" placeholder="Folder name" autocomplete="off">' +
      '<select class="quickadd-input gm-parent"></select>' +
      '<div class="ga-color-btn">' +
        '<div class="ga-color-circle"></div>' +
      '</div>' +
    '</div>' +
    '<div class="ga-color-picker" style="display:none">' +
      '<div class="ga-palette"></div>' +
      '<div class="ga-hex-row">' +
        '<label>Hex</label>' +
        '<input type="text" class="ga-hex-input" placeholder="#000000" maxlength="7" autocomplete="off">' +
      '</div>' +
    '</div>';

  var header = _q(cardEl, 'ga-header');
  var nameInput = _q(cardEl, 'gm-name');
  var parentSelect = _q(cardEl, 'gm-parent');
  var circle = _q(cardEl, 'ga-color-circle');
  var colorBtn = _q(cardEl, 'ga-color-btn');
  var colorPicker = _q(cardEl, 'ga-color-picker');
  var paletteEl = _q(cardEl, 'ga-palette');
  var hexInput = _q(cardEl, 'ga-hex-input');

  header.textContent = existingFolder ? 'Edit Folder' : 'Group';

  if (existingFolder) {
    nameInput.value = existingFolder.name || '';
  }

  parentSelect.innerHTML = '<option value="">No parent</option>' + prodFolders
    .filter(function(g) { return !existingFolder || g.id !== existingFolder.id; })
    .map(function(g) {
      return '<option value="' + escHtml(g.id) + '"' + (existingFolder && existingFolder.parent_id === g.id ? ' selected' : '') + '>' + escHtml(getFolderLabel(g)) + '</option>';
    }).join('');

  function updateCardColor() {
    if (circle) circle.style.backgroundColor = selectedColor;
    cardEl.style.borderColor = selectedColor;
    cardEl.style.setProperty('--qa-border-color', selectedColor);
    header.style.backgroundColor = selectedColor;
  }

  function selectColor(color) {
    selectedColor = color;
    updateCardColor();
    hexInput.value = color;
    cardEl.querySelectorAll('.ga-swatch.selected').forEach(function(s) { s.classList.remove('selected'); });
    var match = cardEl.querySelector('.ga-swatch[data-color="' + color + '"]');
    if (match) match.classList.add('selected');
    colorPicker.style.display = 'none';
  }

  updateCardColor();

  // Build palette
  paletteEl.innerHTML = GA_PALETTE.map(function(c) {
    return '<div class="ga-swatch' + (c === selectedColor ? ' selected' : '') + '" style="background:' + c + '" data-color="' + c + '"></div>';
  }).join('');
  paletteEl.addEventListener('click', function(e) {
    var swatch = e.target.closest('.ga-swatch');
    if (swatch && swatch.dataset.color) selectColor(swatch.dataset.color);
  });

  hexInput.value = selectedColor;
  hexInput.oninput = function() {
    var v = hexInput.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      selectedColor = v;
      updateCardColor();
      cardEl.querySelectorAll('.ga-swatch.selected').forEach(function(s) { s.classList.remove('selected'); });
    }
  };

  colorBtn.addEventListener('click', function() {
    colorPicker.style.display = colorPicker.style.display === 'none' ? '' : 'none';
  });

  // Draft auto-save for groups (not when editing existing)
  function scheduleDraftSave() {
    if (draftSaveTimer) clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(saveFolderDraft, 2000);
  }
  var draftCreated = false;
  function saveFolderDraft() {
    if (!draftId) return;
    var nameVal = nameInput.value.trim() || '';
    if (!nameVal && !draftCreated) return; // don't create draft for empty content
    var data = {
      name: nameVal,
      draft_type: 'folder',
      parent_id: parentSelect.value || null,
      color: selectedColor
    };
    if (!draftCreated) {
      draftCreated = true;
      fetch('/api/drafts', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(Object.assign({draft_id: draftId}, data))});
    } else {
      fetch('/api/drafts/' + draftId, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)});
    }
  }

  if (existingFolder && existingFolder._draftId) {
    // Resuming a draft — reuse existing draft ID
    draftId = existingFolder._draftId;
    draftCreated = true;
    editingFolderId = null;
    nameInput.addEventListener('input', scheduleDraftSave);
    parentSelect.addEventListener('change', scheduleDraftSave);
  } else if (!existingFolder) {
    draftId = crypto.randomUUID ? crypto.randomUUID() : 'draft-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    nameInput.addEventListener('input', scheduleDraftSave);
    parentSelect.addEventListener('change', scheduleDraftSave);
  }

  var card = {
    type: 'folder',
    el: cardEl,
    draftId: draftId,
    _onOverlayKeydown: function(e) {
      // Don't submit on Enter inside hex input
      if (e.key === 'Enter' && document.activeElement === hexInput) { e.stopPropagation(); e.preventDefault(); return; }
    },
    onSubmit: function() { saveThisFolder(); },
    onDismiss: function() {
      if (draftSaveTimer) { clearTimeout(draftSaveTimer); draftSaveTimer = null; }
      if (draftId && draftCreated) {
        var hasContent = nameInput.value.trim();
        if (!hasContent) {
          fetch('/api/drafts/' + draftId, {method: 'DELETE'});
        } else {
          saveFolderDraft();
        }
      }
    }
  };

  function saveThisFolder() {
    var name = nameInput.value.trim();
    var parentId = parentSelect.value || null;
    var color = selectedColor || DEFAULT_COLOR;
    if (!name) { alert('Name is required.'); nameInput.focus(); return; }

    if (editingFolderId) {
      fetch('/api/folders', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: editingFolderId, name: name, parent_id: parentId, color: color})})
        .then(function(r) { if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || 'Failed'); }); return r.json(); })
        .then(function() { CardStack.remove(card); refreshData(); })
        .catch(function(err) { alert(err.message || 'Failed.'); });
    } else {
      var siblings = parentId ? getChildFolders(parentId) : getRootFolders();
      if (siblings.length >= 12) { alert('A folder can have at most 12 subfolders.'); return; }
      fetch('/api/folders', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: name, parent_id: parentId, color: color})})
        .then(function(r) { if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || 'Failed'); }); return r.json(); })
        .then(function() {
          if (draftId) fetch('/api/drafts/' + draftId, {method: 'DELETE'});
          CardStack.remove(card);
          refreshData();
        })
        .catch(function(err) { alert(err.message || 'Failed.'); });
    }
  }

  return card;
}

function openFolderModal(existingFolder) {
  CardStack.push(createFolderCard(existingFolder));
}

function closeFolderModal() {
  CardStack.dismissTop();
}
