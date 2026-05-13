// === Card Stack Manager ===
var CardStack = {
  stack: [],
  overlay: null,
  MAX_VISIBLE: 5,

  getOverlay: function() {
    if (this.overlay) return this.overlay;
    this.overlay = document.createElement('div');
    this.overlay.className = 'quickadd-overlay';
    document.body.appendChild(this.overlay);
    var self = this;
    this.overlay.addEventListener('click', function(e) {
      if (e.target === self.overlay) self.dismissTop();
    });
    this.overlay.addEventListener('keydown', function(e) {
      if (self.stack.length === 0) return;
      var top = self.stack[self.stack.length - 1];
      if (e.key === 'Escape') { self.dismissTop(); e.preventDefault(); return; }
      // Let card-specific handler run first (e.g. Group hex input blocks Enter)
      if (top._onOverlayKeydown) top._onOverlayKeydown(e);
      if (e.defaultPrevented) return;
      if (e.key === 'Enter') {
        // Only submit if focused element is inside topmost card
        if (top.el.contains(document.activeElement)) {
          e.preventDefault();
          top.onSubmit();
        }
      }
    });
    return this.overlay;
  },

  push: function(card) {
    var ov = this.getOverlay();
    this.stack.push(card);
    ov.appendChild(card.el);
    ov.classList.add('open');
    this.reposition();
    setTimeout(function() {
      var firstInput = card.el.querySelector('input:not([type=hidden])');
      if (firstInput) firstInput.focus();
    }, 50);
  },

  pop: function() {
    if (this.stack.length === 0) return;
    var card = this.stack.pop();
    card.el.remove();
    if (this.stack.length === 0) {
      this.overlay.classList.remove('open');
    } else {
      this.reposition();
    }
    return card;
  },

  dismissTop: function() {
    if (this.stack.length === 0) return;
    var card = this.stack[this.stack.length - 1];
    if (card.onDismiss) card.onDismiss();
    this.pop();
  },

  remove: function(card) {
    var idx = this.stack.indexOf(card);
    if (idx < 0) return;
    this.stack.splice(idx, 1);
    card.el.remove();
    if (this.stack.length === 0) {
      this.overlay.classList.remove('open');
    } else {
      this.reposition();
    }
  },
  reposition: function() {
    var total = this.stack.length;
    if (total === 0) return;
    var visibleStart = Math.max(0, total - this.MAX_VISIBLE);
    // Restore any overflow badge headers
    for (var j = 0; j < total; j++) {
      if (this.stack[j]._origHeaderText !== undefined) {
        var hdr = this.stack[j].el.querySelector('.quickadd-header');
        if (hdr) hdr.textContent = this.stack[j]._origHeaderText;
        delete this.stack[j]._origHeaderText;
      }
    }
    // Reset top card width so it returns to natural size, then measure it
    var topCard = this.stack[total - 1];
    topCard.el.style.width = '';
    var frontWidth = topCard.el.getBoundingClientRect().width;

    for (var i = 0; i < total; i++) {
      var card = this.stack[i];
      if (i < visibleStart) {
        card.el.classList.add('stack-hidden');
        continue;
      }
      card.el.classList.remove('stack-hidden');
      var posFromTop = (total - 1) - i;
      var xOffset = posFromTop * 12;
      var yOffset = posFromTop * 36;
      card.el.style.transform = 'translate(calc(-50% - ' + xOffset + 'px), calc(-50% - ' + yOffset + 'px))';
      card.el.style.zIndex = 10 - posFromTop;
      if (posFromTop === 0) {
        card.el.classList.remove('is-stacked-behind');
        card.el.style.width = '';
      } else {
        card.el.classList.add('is-stacked-behind');
        card.el.style.width = frontWidth + 'px';
      }
    }
    this.updateOverflowBadge();
  },

  updateOverflowBadge: function() {
    var total = this.stack.length;
    if (total <= this.MAX_VISIBLE) return;
    var hiddenCount = total - this.MAX_VISIBLE;
    var oldestVisible = this.stack[total - this.MAX_VISIBLE];
    var header = oldestVisible.el.querySelector('.quickadd-header');
    if (header) {
      oldestVisible._origHeaderText = header.textContent;
      header.textContent = '+ ' + (hiddenCount + 1) + ' more';
    }
  }
};
window.CardStack = CardStack;

// Helper: scoped query inside a card element
function _q(el, cls) { return el.querySelector('.' + cls); }
