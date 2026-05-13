function getGroupColor(groupPath) {
  // Returns the color of the deepest (most specific) group matching this path.
  // e.g. groupPath="/SCHOOL/CHINESE" → use color of /SCHOOL/CHINESE group
  if (!groupPath) return null;
  var group = prodGroups.find(function(g) { return g.path === groupPath; });
  if (group) return group.color;
  return null;
}

function getUngroupedItems() {
  // All non-draft, non-routine-instance tasks + routines + notes without a group, sorted by created_at desc
  var tasks = (prodAllTasks || []).filter(function(t) {
    return !t.draft && !t.routine_id && !t.group;
  });
  var routines = (prodRoutines || []).filter(function(r) { return !r.group; });
  var notes = (prodNotes || []).filter(function(n) { return !n.group; });
  var items = [];
  tasks.forEach(function(t) { items.push({type: 'task', id: t.task_id, name: t.name, due: t.due_datetime, done: !!t.end_datetime, created_at: t.created_at || ''}); });
  routines.forEach(function(r) { items.push({type: 'routine', id: r.id, name: r.name, due: null, done: false, created_at: r.created_at || ''}); });
  notes.forEach(function(n) { items.push({type: 'note', id: n.id, name: n.name, due: n.date, done: false, created_at: n.created_at || ''}); });
  items.sort(function(a, b) { return (b.created_at || '').localeCompare(a.created_at || ''); });
  return items;
}

function getGroupItems(groupPath) {
  // Items assigned to exactly this group path
  var tasks = (prodAllTasks || []).filter(function(t) {
    return !t.draft && !t.routine_id && t.group === groupPath;
  });
  var routines = (prodRoutines || []).filter(function(r) { return r.group === groupPath; });
  var notes = (prodNotes || []).filter(function(n) { return n.group === groupPath; });
  var items = [];
  tasks.forEach(function(t) { items.push({type: 'task', id: t.task_id, name: t.name, due: t.due_datetime, done: !!t.end_datetime, created_at: t.created_at || ''}); });
  routines.forEach(function(r) { items.push({type: 'routine', id: r.id, name: r.name, due: null, done: false, created_at: r.created_at || ''}); });
  notes.forEach(function(n) { items.push({type: 'note', id: n.id, name: n.name, due: n.date, done: false, created_at: n.created_at || ''}); });
  items.sort(function(a, b) { return (b.created_at || '').localeCompare(a.created_at || ''); });
  return items;
}

function renderGroupItemHtml(item) {
  if (!projectsShowCompleted && item.done) return '';
  if (!projectsShowNotes && item.type === 'note') return '';
  var doneClass = item.done ? ' group-item-done' : '';
  var icon = item.type === 'routine' ? 'repeat' : (item.type === 'note' ? 'note' : 'task_alt');
  var dueHtml = '';
  if (item.type === 'note' && item.due) {
    dueHtml = '<span class="group-item-due">' + escHtml(item.due) + '</span>';
  } else if (item.due) {
    dueHtml = '<span class="group-item-due">' + formatDateTime(item.due) + '</span>';
  }
  return '<div class="group-item' + doneClass + '" draggable="true" data-item-id="' + item.id + '" data-item-type="' + item.type + '"' +
    ' ondragstart="onGroupItemDragStart(event)" ondragend="onGroupItemDragEnd(event)">' +
    '<span class="material-symbols-outlined group-item-icon">' + icon + '</span>' +
    '<span class="group-item-name">' + escHtml(item.name) + '</span>' + dueHtml + '</div>';
}

function getRootGroups() {
  // Groups whose path has only one segment (e.g., "/STATS" but not "/CS/ML")
  return prodGroups.filter(function(g) {
    var segments = g.path.split('/').filter(Boolean);
    return segments.length === 1;
  });
}

function getChildGroups(parentPath) {
  // Direct children: parentPath + one more segment
  var prefix = parentPath.endsWith('/') ? parentPath : parentPath + '/';
  return prodGroups.filter(function(g) {
    if (!g.path.startsWith(prefix)) return false;
    var rest = g.path.slice(prefix.length);
    return rest.length > 0 && !rest.includes('/');
  });
}

// === Layout Algorithm ===
var LY_TOP_COLS = 4;
var LY_EST_ITEM_H = 34;
var LY_EST_HEADER_H = 36;
var LY_GAP = 16;
var projectsNeedsReorganize = false;

function getVisibleItems(groupPath) {
  return getGroupItems(groupPath).filter(function(item) {
    if (!projectsShowCompleted && item.done) return false;
    if (!projectsShowNotes && item.type === 'note') return false;
    return true;
  });
}

function buildGroupTree() {
  var nodeMap = {};
  prodGroups.forEach(function(g) {
    nodeMap[g.path] = { group: g, children: [], items: getVisibleItems(g.path) };
  });
  prodGroups.forEach(function(g) {
    var segs = g.path.split('/').filter(Boolean);
    if (segs.length > 1) {
      var parentPath = '/' + segs.slice(0, -1).join('/');
      if (nodeMap[parentPath]) nodeMap[parentPath].children.push(nodeMap[g.path]);
    }
  });
  var roots = [];
  prodGroups.forEach(function(g) {
    var segs = g.path.split('/').filter(Boolean);
    if (segs.length === 1) roots.push(nodeMap[g.path]);
  });
  if (!projectsShowEmptyGroups) {
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
function findNodeByPath(nodes, path) {
  for (var i = 0; i < nodes.length; i++) {
    if (nodes[i].group.path === path) return nodes[i];
    var found = findNodeByPath(nodes[i].children, path);
    if (found) return found;
  }
  return null;
}

function buildFocusedTree(focusPath) {
  var allRoots = buildGroupTree();
  if (!focusPath) {
    return { focusGroup: null, children: allRoots, directItems: getVisibleUngroupedItems() };
  }
  var focusNode = findNodeByPath(allRoots, focusPath);
  if (!focusNode) {
    projectsFocusPath = null;
    return { focusGroup: null, children: allRoots, directItems: getVisibleUngroupedItems() };
  }
  return { focusGroup: focusNode.group, children: focusNode.children, directItems: focusNode.items };
}

function getVisibleUngroupedItems() {
  return getUngroupedItems().filter(function(item) {
    if (!projectsShowCompleted && item.done) return false;
    if (!projectsShowNotes && item.type === 'note') return false;
    return true;
  });
}

// === Render items with limit (shows first N-1 + "+X more") ===
function renderItemsWithLimit(items, subgroups, limit) {
  // Merge subgroups (depth 3+) as item-like entries, then real items
  var allEntries = [];
  (subgroups || []).forEach(function(sg) {
    allEntries.push({ _isSubgroup: true, group: sg.group, _totalItems: countAllItems(sg) });
  });
  items.forEach(function(item) { allEntries.push(item); });

  var html = '';
  var total = allEntries.length;
  var showCount = total <= limit ? total : limit - 1;
  for (var i = 0; i < showCount; i++) {
    var entry = allEntries[i];
    if (entry._isSubgroup) {
      html += renderSubgroupAsItem(entry);
    } else {
      html += renderGroupItemHtml(entry);
    }
  }
  if (total > limit) {
    var remaining = total - showCount;
    html += '<div class="group-item group-item-more" onclick="projectsZoomIn(\'' + escHtml((allEntries[0] && allEntries[0]._isSubgroup ? allEntries[0].group.path : '').replace(/\/[^\/]*$/, '')) + '\')">+' + remaining + ' more</div>';
  }
  return html;
}

function renderSubgroupAsItem(entry) {
  var path = escHtml(entry.group.path);
  return '<div class="group-item group-item-subgroup" ondblclick="event.stopPropagation();projectsZoomIn(\'' + path + '\')">' +
    '<span class="material-symbols-outlined group-item-icon">folder</span>' +
    '<span class="group-item-name">' + escHtml(entry.group.name) + '</span>' +
    '<span class="group-item-due" style="color:#80868b">' + entry._totalItems + '</span></div>';
}

// === Depth-2 card (small, fixed height, 1 col) ===
function renderDepth2Card(node) {
  var group = node.group;
  var groupColor = escHtml(group.color || DEFAULT_COLOR);
  // Depth-3+ children become items with folder icons
  var depth3Groups = node.children || [];
  var items = node.items || [];
  var bodyHtml = renderItemsWithLimit(items, depth3Groups, VIS_MAX_DISPLAY_ITEMS);

  return '<div class="group-box group-box-d2" data-group-path="' + escHtml(group.path) +
    '" style="--group-color:' + groupColor + ';border-color:' + groupColor +
    ';height:' + VIS_D2_FIXED_H + 'px"' +
    ' ondblclick="event.stopPropagation();projectsZoomIn(\'' + escHtml(group.path) + '\')"' +
    ' ondragover="onGroupBoxDragOver(event)" ondragleave="onGroupBoxDragLeave(event)" ondrop="onGroupBoxDrop(event)">' +
    '<div class="group-box-header">' +
    '<span class="group-box-name">' + escHtml(group.name) + '</span>' +
    '<div class="group-box-actions" onclick="event.stopPropagation()">' +
    '<button class="group-box-actions-btn" onclick="event.stopPropagation();toggleGroupDropdown(this)"><span class="material-symbols-outlined">more_vert</span></button>' +
    '<div class="group-box-dropdown">' +
    '<button class="group-box-dd-item" onclick="event.stopPropagation();editGroup(\'' + escHtml(group.path) + '\')"><span class="material-symbols-outlined">edit</span> Edit</button>' +
    '<button class="group-box-dd-item danger" onclick="event.stopPropagation();deleteGroup(\'' + escHtml(group.path) + '\')"><span class="material-symbols-outlined">delete</span> Delete</button>' +
    '</div></div></div>' +
    '<div class="group-box-body">' + bodyHtml + '</div></div>';
}

// === Catchall card (no header, for direct items) ===
function renderCatchallCard(items, parentPath) {
  var bodyHtml = renderItemsWithLimit(items, [], VIS_MAX_DISPLAY_ITEMS);
  return '<div class="group-box-catchall" data-group-path="' + escHtml(parentPath || '') + '"' +
    ' style="height:' + VIS_CATCHALL_FIXED_H + 'px"' +
    ' ondragover="onGroupBoxDragOver(event)" ondragleave="onGroupBoxDragLeave(event)" ondrop="onGroupBoxDrop(event)">' +
    '<div class="group-box-body">' + bodyHtml + '</div></div>';
}

// === Depth-1 card (large, contains depth-2 grid) ===
function renderDepth1Card(node, directItems) {
  var group = node.group;
  var groupColor = escHtml(group.color || DEFAULT_COLOR);
  var depth2Children = node.children || [];
  var hasDirectItems = directItems && directItems.length > 0;
  // Only use catchall card when there are BOTH subgroups and direct items
  // Count depth-2 slots: subgroups + 1 for direct items if both exist
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
    // No subgroups — render items directly in body (no wrapper)
    innerHtml = renderItemsWithLimit(directItems, [], VIS_MAX_DISPLAY_ITEMS);
  } else {
    depth2Children.forEach(function(child) {
      innerHtml += renderDepth2Card(child);
    });
    if (hasMixedContent) {
      // Direct items alongside subgroups — render without catchall styling
      var catchallBody = renderItemsWithLimit(directItems, [], VIS_MAX_DISPLAY_ITEMS);
      innerHtml += '<div style="height:' + VIS_D2_FIXED_H + 'px;overflow:hidden"' +
        ' data-group-path="' + escHtml(group.path) + '"' +
        ' ondragover="onGroupBoxDragOver(event)" ondragleave="onGroupBoxDragLeave(event)" ondrop="onGroupBoxDrop(event)">' +
        '<div class="group-box-body">' + catchallBody + '</div></div>';
    }
  }

  return '<div class="group-box" data-group-path="' + escHtml(group.path) +
    '" style="--group-color:' + groupColor + ';border-color:' + groupColor + ';min-height:' + d1Height + 'px"' +
    ' ondblclick="projectsZoomIn(\'' + escHtml(group.path) + '\')"' +
    ' ondragover="onGroupBoxDragOver(event)" ondragleave="onGroupBoxDragLeave(event)" ondrop="onGroupBoxDrop(event)">' +
    '<div class="group-box-header">' +
    '<span class="group-box-name">' + escHtml(group.name) + '</span>' +
    '<div class="group-box-actions" onclick="event.stopPropagation()">' +
    '<button class="group-box-actions-btn" onclick="event.stopPropagation();toggleGroupDropdown(this)"><span class="material-symbols-outlined">more_vert</span></button>' +
    '<div class="group-box-dropdown">' +
    '<button class="group-box-dd-item" onclick="event.stopPropagation();editGroup(\'' + escHtml(group.path) + '\')"><span class="material-symbols-outlined">edit</span> Edit</button>' +
    '<button class="group-box-dd-item danger" onclick="event.stopPropagation();deleteGroup(\'' + escHtml(group.path) + '\')"><span class="material-symbols-outlined">delete</span> Delete</button>' +
    '</div></div></div>' +
    '<div class="group-box-body layout-packed-body" style="grid-template-columns:repeat(' + cols + ',1fr)">' +
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
    el.innerHTML = '<p class="prod-empty">No groups here. Right-click and select "Group" to create one.</p>';
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
    // Items-only cards (no subgroups) take 1 column
    var cols = numD2 > 0 ? Math.min(numD2, LY_TOP_COLS) : 1;
    renderItems.push({ html: renderDepth1Card(node, nodeDirectItems), cols: cols, height: h });
  });

  // Root-level direct items: place individually into masonry (no wrapper)
  directItems.forEach(function(item) {
    var itemHtml = renderGroupItemHtml(item);
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
  var roots = buildGroupTree();
  var ungrouped = getVisibleUngroupedItems();
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
  var group = node.group;
  var items = node.items || [];
  var children = node.children || [];
  var totalItems = countAllItems(node);
  var indent = depth * 20;
  var hasChildren = children.length > 0 || items.length > 0;
  var colorDot = (group.color && group.color !== '#000000' && group.color !== DEFAULT_COLOR)
    ? '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + escHtml(group.color) + ';margin-right:2px;flex-shrink:0"></span>' : '';

  var html = '<div class="list-tree-node" data-path="' + escHtml(group.path) + '"' +
    ' ondragover="onListTreeDragOver(event)" ondragleave="onListTreeDragLeave(event)" ondrop="onListTreeDrop(event)">';
  html += '<div class="list-tree-row" onclick="toggleListNode(this)" ondblclick="projectsZoomIn(\'' + escHtml(group.path) + '\')">';
  html += '<span style="width:' + indent + 'px" class="list-tree-indent"></span>';
  if (hasChildren) {
    html += '<span class="list-tree-chevron material-symbols-outlined">chevron_right</span>';
  } else {
    html += '<span style="width:20px" class="list-tree-indent"></span>';
  }
  html += colorDot;
  html += '<span class="list-tree-icon list-tree-icon-folder material-symbols-outlined">folder</span>';
  html += '<span class="list-tree-name">' + escHtml(group.name) + '</span>';
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
  var indent = depth * 20 + 20; // extra 20 for no chevron
  var icon = item.type === 'routine' ? 'repeat' : (item.type === 'note' ? 'note' : 'task_alt');
  var doneClass = item.done ? ' group-item-done' : '';
  return '<div class="list-tree-item' + doneClass + '" draggable="true" data-item-id="' + item.id + '" data-item-type="' + item.type + '"' +
    ' ondragstart="onGroupItemDragStart(event)" ondragend="onGroupItemDragEnd(event)">' +
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
  if (!node || !groupDraggedItemId) return;
  node.querySelector('.list-tree-row').style.background = '';
  var targetPath = node.dataset.path;
  if (targetPath) assignItemGroup(groupDraggedItemId, groupDraggedItemType, targetPath);
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
function toggleGroupCollapse(headerEl) {
  var body = headerEl.nextElementSibling;
  var toggle = headerEl.querySelector('.group-box-toggle');
  if (body) body.classList.toggle('collapsed');
  if (toggle) toggle.classList.toggle('collapsed');
}

function toggleGroupDropdown(btn) {
  var dd = btn.nextElementSibling;
  // Close others
  document.querySelectorAll('.group-box-dropdown.open').forEach(function(d) { d.classList.remove('open'); });
  if (dd) dd.classList.toggle('open');
}

// Close group dropdowns on click outside
document.addEventListener('click', function(e) {
  if (!e.target.closest('.group-box-actions')) {
    document.querySelectorAll('.group-box-dropdown.open').forEach(function(d) { d.classList.remove('open'); });
  }
});

function deleteGroup(path) {
  document.querySelectorAll('.group-box-dropdown.open').forEach(function(d) { d.classList.remove('open'); });
  if (!confirm('Delete group "' + path + '" and all subgroups? Items will become unclassified.')) return;
  fetch('/api/groups', {method: 'DELETE', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({path: path})})
    .then(function(r) { if (!r.ok) throw 0; return r.json(); })
    .then(function() { refreshData(); })
    .catch(function() { alert('Failed to delete group.'); });
}

function editGroup(path) {
  document.querySelectorAll('.group-box-dropdown.open').forEach(function(d) { d.classList.remove('open'); });
  var group = prodGroups.find(function(g) { return g.path === path; });
  if (!group) return;
  openGroupModal(group);
}

// --- Drag and drop for groups ---
var groupDraggedItemId = null;
var groupDraggedItemType = null;

function onGroupItemDragStart(e) {
  var el = e.target.closest('.group-item');
  if (!el) return;
  groupDraggedItemId = el.dataset.itemId;
  groupDraggedItemType = el.dataset.itemType;
  el.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', groupDraggedItemId);
  var ws = document.getElementById('projects-whitespace');
  if (ws) ws.classList.add('drag-active');
}

function onGroupItemDragEnd(e) {
  var el = e.target.closest('.group-item');
  if (el) el.classList.remove('dragging');
  groupDraggedItemId = null;
  groupDraggedItemType = null;
  document.querySelectorAll('.group-box.drag-over-group').forEach(function(b) { b.classList.remove('drag-over-group'); });
  var ws = document.getElementById('projects-whitespace');
  if (ws) ws.classList.remove('drag-active', 'drag-over');
}

function onGroupBoxDragOver(e) {
  e.preventDefault();
  var box = e.target.closest('.group-box');
  if (box) box.classList.add('drag-over-group');
}

function onGroupBoxDragLeave(e) {
  var box = e.target.closest('.group-box');
  if (box && !box.contains(e.relatedTarget)) box.classList.remove('drag-over-group');
}

function onGroupBoxDrop(e) {
  e.preventDefault(); e.stopPropagation();
  var box = e.target.closest('.group-box');
  if (!box || !groupDraggedItemId) return;
  box.classList.remove('drag-over-group');
  var targetPath = box.dataset.groupPath;
  assignItemGroup(groupDraggedItemId, groupDraggedItemType, targetPath);
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
  if (!groupDraggedItemId) return;
  assignItemGroup(groupDraggedItemId, groupDraggedItemType, null);
}

function assignItemGroup(itemId, itemType, groupPath) {
  if (itemType === 'routine') {
    fetch('/api/routines/' + itemId, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({group: groupPath})})
      .then(function(r) { if (!r.ok) throw 0; return r.json(); })
      .then(function() { refreshData(); })
      .catch(function() { alert('Failed to assign routine to group.'); });
  } else if (itemType === 'note') {
    fetch('/api/notes/' + itemId, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({group: groupPath})})
      .then(function(r) { if (!r.ok) throw 0; return r.json(); })
      .then(function() { refreshData(); })
      .catch(function() { alert('Failed to assign note to group.'); });
  } else {
    fetch('/api/tasks/' + itemId, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({group: groupPath})})
      .then(function(r) { if (!r.ok) throw 0; return r.json(); })
      .then(function() { refreshData(); })
      .catch(function() { alert('Failed to assign task to group.'); });
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

function _formatPathForDisplay(value) {
  return value.replace(/\s*\/\s*/g, ' / ').replace(/\s+/g, ' ').trim();
}
function _normalizePathForSave(value) {
  return value.replace(/\s*\/\s*/g, '/').replace(/^\/+/, '').replace(/\/+$/, '').trim();
}

function createGroupCard(existingGroup) {
  var editingGroupPath = existingGroup ? existingGroup.path : null;
  var selectedColor = existingGroup ? (existingGroup.color || DEFAULT_COLOR) : DEFAULT_COLOR;
  var draftId = null;
  var draftSaveTimer = null;

  var cardEl = document.createElement('div');
  cardEl.className = 'quickadd-card';
  cardEl.innerHTML =
    '<div class="quickadd-header ga-header">Group</div>' +
    '<div class="quickadd-body">' +
      '<div class="ga-path-wrap">' +
        '<span class="ga-path-prefix">/</span>' +
        '<input class="ga-path-input gm-path" autocomplete="off">' +
        '<span class="ga-path-ghost"></span>' +
      '</div>' +
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
  var pathInput = _q(cardEl, 'gm-path');
  var ghost = _q(cardEl, 'ga-path-ghost');
  var circle = _q(cardEl, 'ga-color-circle');
  var colorBtn = _q(cardEl, 'ga-color-btn');
  var colorPicker = _q(cardEl, 'ga-color-picker');
  var paletteEl = _q(cardEl, 'ga-palette');
  var hexInput = _q(cardEl, 'ga-hex-input');

  header.textContent = existingGroup ? 'Edit Group' : 'Group';

  if (existingGroup) {
    pathInput.value = _formatPathForDisplay(existingGroup.path.slice(1));
    pathInput.disabled = true;
  }

  function updateCardColor() {
    if (circle) circle.style.backgroundColor = selectedColor;
    cardEl.style.borderColor = selectedColor;
    cardEl.style.setProperty('--qa-border-color', selectedColor);
    header.style.backgroundColor = selectedColor;
  }

  function autoSize() {
    if (!pathInput.value) { pathInput.style.width = '2px'; return; }
    var m = document.getElementById('ga-path-measurer');
    if (!m) {
      m = document.createElement('span');
      m.id = 'ga-path-measurer';
      m.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font-size:0.9rem;font-family:inherit;letter-spacing:0.5px;';
      document.body.appendChild(m);
    }
    m.textContent = pathInput.value;
    pathInput.style.width = Math.ceil(m.offsetWidth + 2) + 'px';
  }

  function updateGhost() {
    var raw = _normalizePathForSave(pathInput.value);
    var trimmed = pathInput.value.trim();
    var endsWithSlash = trimmed.endsWith('/');
    var parentPath;
    if (!raw || raw === '') { parentPath = null; }
    else if (endsWithSlash) { parentPath = '/' + raw; }
    else { ghost.textContent = ''; return; }
    var children = parentPath === null ? getRootGroups() : getChildGroups(parentPath);
    if (children.length === 0) { ghost.textContent = ''; }
    else {
      ghost.textContent = children.map(function(g) {
        var segs = g.path.split('/').filter(Boolean);
        return segs[segs.length - 1];
      }).join(', ');
    }
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
  updateGhost();
  autoSize();

  pathInput.oninput = function() {
    var start = pathInput.selectionStart;
    var oldVal = pathInput.value;
    var formatted = _formatPathForDisplay(oldVal);
    if (formatted !== oldVal) {
      var diff = formatted.length - oldVal.length;
      pathInput.value = formatted;
      pathInput.setSelectionRange(Math.max(0, start + diff), Math.max(0, start + diff));
    }
    autoSize();
    updateGhost();
  };

  var wrap = cardEl.querySelector('.ga-path-wrap');
  if (wrap) wrap.onclick = function() { pathInput.focus(); };

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
    draftSaveTimer = setTimeout(saveGroupDraft, 2000);
  }
  var draftCreated = false;
  function saveGroupDraft() {
    if (!draftId) return;
    var pathVal = _normalizePathForSave(pathInput.value) || '';
    if (!pathVal && !draftCreated) return; // don't create draft for empty content
    var data = {
      name: pathVal,
      draft_type: 'group',
      color: selectedColor
    };
    if (!draftCreated) {
      draftCreated = true;
      fetch('/api/drafts', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(Object.assign({draft_id: draftId}, data))});
    } else {
      fetch('/api/drafts/' + draftId, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)});
    }
  }

  if (existingGroup && existingGroup._draftId) {
    // Resuming a draft — reuse existing draft ID
    draftId = existingGroup._draftId;
    draftCreated = true;
    editingGroupPath = null;
    pathInput.addEventListener('input', scheduleDraftSave);
  } else if (!existingGroup) {
    draftId = crypto.randomUUID ? crypto.randomUUID() : 'draft-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    pathInput.addEventListener('input', scheduleDraftSave);
  }

  var card = {
    type: 'group',
    el: cardEl,
    draftId: draftId,
    _onOverlayKeydown: function(e) {
      // Don't submit on Enter inside hex input
      if (e.key === 'Enter' && document.activeElement === hexInput) { e.stopPropagation(); e.preventDefault(); return; }
    },
    onSubmit: function() { saveThisGroup(); },
    onDismiss: function() {
      if (draftSaveTimer) { clearTimeout(draftSaveTimer); draftSaveTimer = null; }
      if (draftId && draftCreated) {
        var hasContent = _normalizePathForSave(pathInput.value);
        if (!hasContent) {
          fetch('/api/drafts/' + draftId, {method: 'DELETE'});
        } else {
          saveGroupDraft();
        }
      }
    }
  };

  function saveThisGroup() {
    var rawPath = _normalizePathForSave(pathInput.value);
    var path = '/' + rawPath;
    var color = selectedColor || DEFAULT_COLOR;

    if (editingGroupPath) {
      fetch('/api/groups', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({path: editingGroupPath, color: color})})
        .then(function(r) { if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || 'Failed'); }); return r.json(); })
        .then(function() { CardStack.remove(card); refreshData(); })
        .catch(function(err) { alert(err.message || 'Failed.'); });
    } else {
      if (!path.startsWith('/')) path = '/' + path;
      if (path.endsWith('/')) path = path.slice(0, -1);
      if (!path || path === '') { alert('Path is required.'); return; }

      var segments = path.split('/').filter(Boolean);
      if (segments.length === 0) { alert('Path is required.'); return; }
      var pathsToCreate = [];
      var existingPaths = prodGroups.map(function(g) { return g.path; });
      for (var i = 0; i < segments.length; i++) {
        var partial = '/' + segments.slice(0, i + 1).join('/');
        if (existingPaths.indexOf(partial) < 0) pathsToCreate.push(partial);
      }

      if (pathsToCreate.length === 0) { alert('Group already exists.'); return; }

      // Enforce max 12 subgroups per parent
      var parentPath = segments.length > 1 ? '/' + segments.slice(0, segments.length - 1).join('/') : null;
      var siblings = parentPath ? getChildGroups(parentPath) : getRootGroups();
      if (siblings.length >= 12) { alert('A group can have at most 12 subgroups.'); return; }

      var createNext = function(idx) {
        if (idx >= pathsToCreate.length) {
          if (draftId) fetch('/api/drafts/' + draftId, {method: 'DELETE'});
          CardStack.remove(card);
          refreshData();
          return;
        }
        var p = pathsToCreate[idx];
        var segs = p.split('/').filter(Boolean);
        var name = segs[segs.length - 1];
        var c = (idx === pathsToCreate.length - 1) ? color : DEFAULT_COLOR;
        fetch('/api/groups', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({path: p, name: name, color: c})})
          .then(function(r) { if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || 'Failed'); }); return r.json(); })
          .then(function() { createNext(idx + 1); })
          .catch(function(err) { alert(err.message || 'Failed.'); });
      };
      createNext(0);
    }
  }

  return card;
}

function openGroupModal(existingGroup) {
  CardStack.push(createGroupCard(existingGroup));
}

function closeGroupModal() {
  CardStack.dismissTop();
}
