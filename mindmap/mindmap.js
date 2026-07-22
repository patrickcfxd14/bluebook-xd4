/* =====================================================================
 * MINDMAP.JS — Módulo de Mapa Mental / Organograma interativo
 * XD4 Blue Book — vanilla JS (sem frameworks), classes ES6.
 *
 * Estrutura do arquivo:
 *   1. Utils                — helpers genéricos
 *   2. TreeModel             — modelo de dados (árvore) e mutações
 *   3. LayoutEngine          — cálculo de posição dos nós (árvore horizontal)
 *   4. HistoryManager        — undo/redo por snapshot
 *   5. Storage                — persistência (localStorage + JSON)
 *   6. IconLibrary / Colors  — catálogo de ícones e paleta de cores
 *   7. Viewport               — pan & zoom do canvas
 *   8. MindMapRenderer        — desenha nós (DOM) e conexões (SVG)
 *   9. Sidebar                — árvore lateral + busca
 *  10. NodeEditor             — painel lateral de edição
 *  11. ContextMenu            — menu de botão direito
 *  12. ExportManager          — JSON / PNG / SVG / PDF
 *  13. MindMapApp             — orquestrador geral + atalhos de teclado
 * ===================================================================== */

/* --------------------------- 1. UTILS --------------------------------- */
class Utils {
  static uid(prefix = 'n') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
  static clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }
  static debounce(fn, wait = 250) {
    let t = null;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
  }
  static clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  static escapeHtml(s = '') {
    return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }
  static download(filename, content, mime = 'application/octet-stream') {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

/* ------------------------- 2. TREE MODEL ------------------------------- */
/* Formato de nó: { id, title, description, category, icon, color, notes,
 *                  collapsed, ox, oy, children[] }
 * ox/oy = deslocamento manual (drag) aplicado sobre a posição calculada
 * automaticamente pelo LayoutEngine. */
class TreeModel {
  constructor(data) {
    this.root = data;
    this.byId = new Map();
    this.reindex();
  }

  reindex() {
    this.byId.clear();
    this._walk(this.root, null, (node, parent) => {
      this.byId.set(node.id, node);
      node._parent = parent;
    });
  }

  _walk(node, parent, cb) {
    cb(node, parent);
    (node.children || []).forEach(c => this._walk(c, node, cb));
  }

  find(id) { return this.byId.get(id) || null; }
  parentOf(id) { const n = this.find(id); return n ? n._parent : null; }

  _blank(props = {}) {
    return Object.assign({
      id: Utils.uid('n'), title: 'Novo nó', description: '', category: '',
      icon: 'circle', color: ColorPalette.default(), notes: '',
      collapsed: false, ox: 0, oy: 0, children: []
    }, props);
  }

  addChild(parentId, props = {}) {
    const parent = this.find(parentId);
    if (!parent) return null;
    if (!parent.children) parent.children = [];
    const node = this._blank(props);
    parent.children.push(node);
    parent.collapsed = false;
    this.reindex();
    return node;
  }

  addSibling(id, props = {}) {
    const parent = this.parentOf(id);
    if (!parent) return this.addChild(id, props); // raiz: vira filho
    const node = this._blank(props);
    const idx = parent.children.findIndex(c => c.id === id);
    parent.children.splice(idx + 1, 0, node);
    this.reindex();
    return node;
  }

  remove(id) {
    if (id === this.root.id) return false;
    const parent = this.parentOf(id);
    if (!parent) return false;
    parent.children = parent.children.filter(c => c.id !== id);
    this.reindex();
    return true;
  }

  update(id, patch) {
    const n = this.find(id);
    if (!n) return null;
    Object.assign(n, patch);
    return n;
  }

  duplicate(id) {
    const n = this.find(id);
    const parent = this.parentOf(id);
    if (!n || !parent) return null;
    const clone = Utils.clone(n);
    delete clone._parent;
    this._reassignIds(clone);
    const idx = parent.children.findIndex(c => c.id === id);
    parent.children.splice(idx + 1, 0, clone);
    this.reindex();
    return clone;
  }

  _reassignIds(node) {
    node.id = Utils.uid('n');
    (node.children || []).forEach(c => this._reassignIds(c));
  }

  isDescendant(node, maybeDescendant) {
    if (node === maybeDescendant) return true;
    return (node.children || []).some(c => this.isDescendant(c, maybeDescendant));
  }

  move(id, newParentId, index = null) {
    const node = this.find(id);
    const newParent = this.find(newParentId);
    if (!node || !newParent) return false;
    if (node.id === newParentId) return false;
    if (this.isDescendant(node, newParent)) return false; // evita ciclo
    const oldParent = this.parentOf(id);
    if (!oldParent) return false;
    oldParent.children = oldParent.children.filter(c => c.id !== id);
    if (!newParent.children) newParent.children = [];
    if (index == null || index > newParent.children.length) newParent.children.push(node);
    else newParent.children.splice(index, 0, node);
    newParent.collapsed = false;
    node.ox = 0; node.oy = 0; // reseta deslocamento manual ao reparentar
    this.reindex();
    return true;
  }

  toggleCollapse(id) {
    const n = this.find(id);
    if (n) n.collapsed = !n.collapsed;
  }

  expandAll() { this._walk(this.root, null, n => { n.collapsed = false; }); }
  collapseAll() { this._walk(this.root, null, n => { if (n !== this.root && (n.children || []).length) n.collapsed = true; }); }

  countDescendants(id) {
    const n = this.find(id);
    if (!n) return 0;
    let count = 0;
    this._walk(n, null, () => count++);
    return count - 1;
  }

  pathTo(id) {
    const path = [];
    let n = this.find(id);
    while (n) { path.unshift(n); n = n._parent; }
    return path;
  }

  toJSON() { return this._strip(this.root); }
  _strip(node) {
    const clean = {
      id: node.id, title: node.title, description: node.description || '',
      category: node.category || '', icon: node.icon || 'circle',
      color: node.color || ColorPalette.default(), notes: node.notes || '',
      collapsed: !!node.collapsed, ox: node.ox || 0, oy: node.oy || 0,
      children: (node.children || []).map(c => this._strip(c))
    };
    return clean;
  }
  static fromJSON(data) { return new TreeModel(Utils.clone(data)); }
}

/* ------------------------- 3. LAYOUT ENGINE ----------------------------- */
/* Árvore horizontal (esquerda -> direita), no estilo organograma/XMind.
 * Cada nó recebe {x,y,w,h} relativos ao "world". A altura de cada subárvore
 * é a soma das alturas dos filhos visíveis (respeitando collapse). */
class LayoutEngine {
  constructor(opts = {}) {
    this.nodeW = opts.nodeW || 220;
    this.nodeH = opts.nodeH || 58;
    this.hGap = opts.hGap || 100;
    this.vGap = opts.vGap || 22;
  }

  compute(root) {
    const positions = new Map();
    this._measure(root);
    this._place(root, 0, 0, positions);
    return positions;
  }

  _measure(node) {
    const hasKids = !node.collapsed && node.children && node.children.length;
    if (!hasKids) { node._h = this.nodeH; return node._h; }
    let total = 0;
    node.children.forEach(c => { total += this._measure(c) + this.vGap; });
    total -= this.vGap;
    node._h = Math.max(total, this.nodeH);
    return node._h;
  }

  _place(node, depth, yTop, positions) {
    const h = node._h || this.nodeH;
    const cy = yTop + h / 2;
    const baseX = depth * (this.nodeW + this.hGap);
    const baseY = cy - this.nodeH / 2;
    positions.set(node.id, {
      x: baseX + (node.ox || 0),
      y: baseY + (node.oy || 0),
      baseX, baseY, w: this.nodeW, h: this.nodeH
    });
    const hasKids = !node.collapsed && node.children && node.children.length;
    if (hasKids) {
      let y = yTop;
      node.children.forEach(c => {
        const ch = c._h || this.nodeH;
        this._place(c, depth + 1, y, positions);
        y += ch + this.vGap;
      });
    }
  }
}

/* ------------------------- 4. HISTORY (UNDO/REDO) ----------------------- */
class HistoryManager {
  constructor(getState, setState, limit = 120) {
    this.getState = getState;
    this.setState = setState;
    this.undoStack = [];
    this.redoStack = [];
    this.limit = limit;
  }
  record() {
    this.undoStack.push(Utils.clone(this.getState()));
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }
  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(Utils.clone(this.getState()));
    this.setState(this.undoStack.pop());
    return true;
  }
  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(Utils.clone(this.getState()));
    this.setState(this.redoStack.pop());
    return true;
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
}

/* --------------------------- 5. STORAGE --------------------------------- */
class Storage {
  static KEY = 'xd4_mindmap_tree_v1';

  static saveTree(data) {
    try { localStorage.setItem(Storage.KEY, JSON.stringify(data)); return true; }
    catch (e) { console.warn('[mindmap] falha ao salvar localStorage', e); return false; }
  }

  static loadTreeFromLocal() {
    try {
      const raw = localStorage.getItem(Storage.KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  /* Tenta: 1) localStorage  2) mindmap-data.json (fetch)  3) fallback embutido */
  static async loadTree() {
    const local = Storage.loadTreeFromLocal();
    if (local) return local;
    try {
      const res = await fetch('mindmap-data.json', { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch (e) { /* file:// sem servidor não permite fetch — cai no fallback */ }
    return Utils.clone(DEFAULT_TREE);
  }

  static exportJSON(data) {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    Utils.download(`mindmap-${stamp}.json`, JSON.stringify(data, null, 2), 'application/json');
  }

  static importJSON(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try { resolve(JSON.parse(reader.result)); }
        catch (e) { reject(new Error('Arquivo JSON inválido.')); }
      };
      reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
      reader.readAsText(file);
    });
  }
}

/* -------------------- 6. ÍCONES E PALETA DE CORES ------------------------ */
const IconLibrary = {
  map: {
    hub: '◈', mountain: '▲', dam: '▤', belt: '↔', gear: '⚙', funnel: '▽',
    flame: '🔥', ship: '🚢', platform: '⛓', tank: '⬤', pipe: '━', vessel: '⏚',
    leaf: '🍃', flask: '⚗', boiler: '♨', chimney: '▮', silo: '▯',
    bolt: '⚡', tower: '⇑', substation: '⎔', line: '⚟', turbine: '✺',
    bridge: '⌒', tunnel: '◐', gallery: '▭', factory: '🏭', furnace: '▲',
    crane: '⊤', circle: '●', star: '★', flag: '⚑', doc: '▤', check: '✔',
    warn: '⚠', pin: '📍', folder: '▢'
  },
  list() { return Object.keys(this.map); },
  glyph(key) { return this.map[key] || this.map.circle; }
};

const ColorPalette = {
  swatches: ['#2BA9E0', '#3A6EA5', '#34C795', '#F2B84B', '#F2726C', '#B67CE0', '#4FD1C5', '#F2A65A', '#7C93FF', '#E0729A', '#8FD14F', '#5E7093'],
  default() { return this.swatches[0]; }
};

/* ---------------------------- 7. VIEWPORT -------------------------------- */
/* Controla pan (arrastar canvas) e zoom (scroll) do "world" dentro do
 * "viewport" visível. */
class Viewport {
  constructor(viewportEl, worldEl, onChange) {
    this.viewportEl = viewportEl;
    this.worldEl = worldEl;
    this.onChange = onChange || (() => {});
    this.scale = 1;
    this.tx = 60;
    this.ty = 60;
    this.minScale = 0.2;
    this.maxScale = 2.5;
    this._panning = false;
    this._panStart = null;
    this._bind();
    this.apply();
  }

  apply() {
    this.worldEl.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
    this.onChange(this.scale);
  }

  screenToWorld(clientX, clientY) {
    const rect = this.viewportEl.getBoundingClientRect();
    const x = (clientX - rect.left - this.tx) / this.scale;
    const y = (clientY - rect.top - this.ty) / this.scale;
    return { x, y };
  }

  zoomAt(clientX, clientY, factor) {
    const rect = this.viewportEl.getBoundingClientRect();
    const px = clientX - rect.left, py = clientY - rect.top;
    const newScale = Utils.clamp(this.scale * factor, this.minScale, this.maxScale);
    const worldX = (px - this.tx) / this.scale;
    const worldY = (py - this.ty) / this.scale;
    this.scale = newScale;
    this.tx = px - worldX * this.scale;
    this.ty = py - worldY * this.scale;
    this.apply();
  }

  zoomStep(delta) {
    const rect = this.viewportEl.getBoundingClientRect();
    this.zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, delta > 0 ? 1.15 : 1 / 1.15);
  }

  pan(dx, dy) { this.tx += dx; this.ty += dy; this.apply(); }

  centerOnBounds(bounds, padding = 60) {
    const rect = this.viewportEl.getBoundingClientRect();
    if (!bounds || rect.width === 0) return;
    const bw = Math.max(bounds.maxX - bounds.minX, 1);
    const bh = Math.max(bounds.maxY - bounds.minY, 1);
    const scaleX = (rect.width - padding * 2) / bw;
    const scaleY = (rect.height - padding * 2) / bh;
    this.scale = Utils.clamp(Math.min(scaleX, scaleY, 1.15), this.minScale, this.maxScale);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    this.tx = rect.width / 2 - cx * this.scale;
    this.ty = rect.height / 2 - cy * this.scale;
    this.apply();
  }

  centerOnPoint(x, y) {
    const rect = this.viewportEl.getBoundingClientRect();
    this.tx = rect.width / 2 - x * this.scale;
    this.ty = rect.height / 2 - y * this.scale;
    this.apply();
  }

  _bind() {
    this.viewportEl.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = Math.pow(1.0016, -e.deltaY);
      this.zoomAt(e.clientX, e.clientY, factor);
    }, { passive: false });

    this.viewportEl.addEventListener('mousedown', (e) => {
      if (e.target !== this.viewportEl && e.target !== this.worldEl && !e.target.closest('.mm-edges')) return;
      if (e.button !== 0 && e.button !== 1) return;
      this._panning = true;
      this._panStart = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty };
      this.viewportEl.classList.add('mm-panning');
    });
    window.addEventListener('mousemove', (e) => {
      if (!this._panning) return;
      this.tx = this._panStart.tx + (e.clientX - this._panStart.x);
      this.ty = this._panStart.ty + (e.clientY - this._panStart.y);
      this.apply();
    });
    window.addEventListener('mouseup', () => {
      this._panning = false;
      this.viewportEl.classList.remove('mm-panning');
    });
  }
}

/* ------------------------- 8. MINDMAP RENDERER --------------------------- */
class MindMapRenderer {
  constructor(app) {
    this.app = app;
    this.nodesLayer = app.el.nodesLayer;
    this.svg = app.el.svg;
    this.nodeEls = new Map(); // id -> element
    this.positions = new Map();
    this._dragState = null;
  }

  render() {
    const model = this.app.model;
    const positions = this.app.layout.compute(model.root);
    this.positions = positions;
    this._syncNodes(model.root, positions);
    this._drawEdges(model.root, positions);
    this._resizeWorld(positions);
    this.app.sidebar.render();
    this.app.updateToolbarState();
  }

  _bounds(positions) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of positions.values()) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + p.w); maxY = Math.max(maxY, p.y + p.h);
    }
    if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 400, maxY: 200 };
    return { minX, minY, maxX, maxY };
  }

  _resizeWorld(positions) {
    const b = this._bounds(positions);
    const pad = 400;
    const w = (b.maxX - b.minX) + pad * 2;
    const h = (b.maxY - b.minY) + pad * 2;
    this.svg.setAttribute('width', w);
    this.svg.setAttribute('height', h);
    this.svg.style.left = `${b.minX - pad}px`;
    this.svg.style.top = `${b.minY - pad}px`;
    this.svg.setAttribute('viewBox', `${b.minX - pad} ${b.minY - pad} ${w} ${h}`);
    this._lastBounds = b;
  }

  _syncNodes(root, positions) {
    const visible = new Set();
    const walk = (node) => {
      visible.add(node.id);
      this._renderNode(node, positions.get(node.id));
      if (!node.collapsed) (node.children || []).forEach(walk);
    };
    walk(root);
    for (const [id, el] of this.nodeEls) {
      if (!visible.has(id)) { el.remove(); this.nodeEls.delete(id); }
    }
  }

  _renderNode(node, pos) {
    let el = this.nodeEls.get(node.id);
    if (!el) { el = this._createNodeEl(node); this.nodesLayer.appendChild(el); this.nodeEls.set(node.id, el); }
    this._updateNodeEl(el, node);
    el.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
  }

  _createNodeEl(node) {
    const el = document.createElement('div');
    el.className = 'mm-node';
    el.dataset.id = node.id;
    el.innerHTML = `
      <div class="mm-node-row">
        <span class="mm-node-ic" data-role="icon"></span>
        <span class="mm-node-title" data-role="title" spellcheck="false"></span>
      </div>
      <div class="mm-node-meta" data-role="meta"></div>
      <button class="mm-node-toggle" data-role="toggle" hidden></button>
      <button class="mm-node-quickadd" data-role="quickadd" title="Adicionar filho (clique)">+</button>
    `;

    // seleção / abrir editor
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-role="toggle"]') || e.target.closest('[data-role="quickadd"]')) return;
      if (this._justDragged) { this._justDragged = false; return; }
      this.app.handleNodeClick(node.id, e);
    });

    // renomear inline (duplo clique no título)
    const titleEl = el.querySelector('[data-role="title"]');
    titleEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this.app.startInlineRename(node.id, titleEl);
    });

    // expandir / colapsar
    el.querySelector('[data-role="toggle"]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.app.toggleCollapse(node.id);
    });

    // adicionar filho rápido
    el.querySelector('[data-role="quickadd"]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.app.addChild(node.id);
    });

    // menu de contexto
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      this.app.selectNode(node.id, { openEditor: false });
      this.app.ctxMenu.openForNode(node.id, e.clientX, e.clientY);
    });

    // arrastar nó (mover livremente / reparentar)
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('[data-role="toggle"]') || e.target.closest('[data-role="quickadd"]')) return;
      if (e.target.isContentEditable) return;
      this._startNodeDrag(node.id, el, e);
    });

    return el;
  }

  _updateNodeEl(el, node) {
    el.style.setProperty('--node-color', node.color || ColorPalette.default());
    el.classList.toggle('mm-selected', this.app.selectedId === node.id);
    el.classList.toggle('mm-search-match', this.app.search.matchIds.has(node.id));
    el.classList.toggle('mm-path-highlight', this.app.search.pathIds.has(node.id));
    el.classList.toggle('mm-dimmed', this.app.search.active && !this.app.search.pathIds.has(node.id) && !this.app.search.matchIds.has(node.id));
    el.classList.toggle('mm-drop-target', this.app.dragDropTargetId === node.id);

    const iconEl = el.querySelector('[data-role="icon"]');
    iconEl.textContent = IconLibrary.glyph(node.icon);

    const titleEl = el.querySelector('[data-role="title"]');
    if (document.activeElement !== titleEl) titleEl.textContent = node.title;

    const metaEl = el.querySelector('[data-role="meta"]');
    metaEl.innerHTML = node.category ? `<span class="mm-node-category">${Utils.escapeHtml(node.category)}</span>` : '';

    const toggleEl = el.querySelector('[data-role="toggle"]');
    const hasKids = (node.children || []).length > 0;
    toggleEl.hidden = !hasKids;
    toggleEl.textContent = node.collapsed ? `+${node.children.length}` : '−';
    toggleEl.title = node.collapsed ? 'Expandir ramo' : 'Recolher ramo';
  }

  _startNodeDrag(nodeId, el, downEvt) {
    const scale = this.app.viewport.scale;
    const startClient = { x: downEvt.clientX, y: downEvt.clientY };
    const node = this.app.model.find(nodeId);
    const startOffset = { ox: node.ox || 0, oy: node.oy || 0 };
    let moved = false;
    let historyRecorded = false;

    const onMove = (e) => {
      const dx = (e.clientX - startClient.x) / scale;
      const dy = (e.clientY - startClient.y) / scale;
      if (!moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
        moved = true;
        el.classList.add('mm-dragging');
        if (!historyRecorded) { this.app.history.record(); historyRecorded = true; }
      }
      if (!moved) return;
      node.ox = startOffset.ox + dx;
      node.oy = startOffset.oy + dy;
      const pos = this.positions.get(nodeId);
      if (pos) el.style.transform = `translate(${pos.baseX + node.ox}px, ${pos.baseY + node.oy}px)`;
      this._redrawEdgesOnly();
      this.app.dragDropTargetId = this._findDropTarget(nodeId, e.clientX, e.clientY);
      this._highlightDropTarget();
    };

    const onUp = (e) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      el.classList.remove('mm-dragging');
      if (!moved) return;
      this._justDragged = true;
      const dropId = this.app.dragDropTargetId;
      this.app.dragDropTargetId = null;
      this._highlightDropTarget();
      if (dropId && dropId !== nodeId) {
        const parent = this.app.model.parentOf(nodeId);
        if (!parent || parent.id !== dropId) {
          const ok = this.app.model.move(nodeId, dropId);
          if (ok) this.app.toast(`Nó movido para "${this.app.model.find(dropId).title}"`);
        }
      }
      this.app.commit({ skipHistory: true });
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  _findDropTarget(draggingId, clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    const nodeEl = el && el.closest ? el.closest('.mm-node') : null;
    if (!nodeEl) return null;
    const id = nodeEl.dataset.id;
    if (id === draggingId) return null;
    const dragNode = this.app.model.find(draggingId);
    const targetNode = this.app.model.find(id);
    if (!dragNode || !targetNode) return null;
    if (this.app.model.isDescendant(dragNode, targetNode)) return null;
    return id;
  }

  _highlightDropTarget() {
    for (const [id, el] of this.nodeEls) {
      el.classList.toggle('mm-drop-target', this.app.dragDropTargetId === id);
    }
  }

  _redrawEdgesOnly() {
    // recalcula apenas as posições finais (com offsets) sem re-executar o layout inteiro
    const model = this.app.model;
    const positions = this.positions;
    for (const [id, pos] of positions) {
      const n = model.find(id);
      if (n) { pos.x = pos.baseX + (n.ox || 0); pos.y = pos.baseY + (n.oy || 0); }
    }
    this._drawEdges(model.root, positions);
  }

  _drawEdges(root, positions) {
    const paths = [];
    const walk = (node) => {
      if (node.collapsed || !node.children || !node.children.length) return;
      const p0 = positions.get(node.id);
      node.children.forEach(child => {
        const p1 = positions.get(child.id);
        if (!p0 || !p1) return;
        const x0 = p0.x + p0.w, y0 = p0.y + p0.h / 2;
        const x1 = p1.x, y1 = p1.y + p1.h / 2;
        const dx = Math.max(40, (x1 - x0) * 0.5);
        const d = `M ${x0} ${y0} C ${x0 + dx} ${y0}, ${x1 - dx} ${y1}, ${x1} ${y1}`;
        const highlighted = this.app.search.pathIds.has(node.id) && this.app.search.pathIds.has(child.id);
        const dimmed = this.app.search.active && !highlighted;
        paths.push({ d, id: `${node.id}__${child.id}`, highlighted, dimmed });
        walk(child);
      });
    };
    walk(root);

    // reconcilia paths (evita recriar todo SVG a cada frame)
    const existing = new Map();
    this.svg.querySelectorAll('path[data-edge]').forEach(p => existing.set(p.dataset.edge, p));
    const seen = new Set();
    paths.forEach(p => {
      seen.add(p.id);
      let pathEl = existing.get(p.id);
      if (!pathEl) {
        pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pathEl.setAttribute('data-edge', p.id);
        pathEl.setAttribute('class', 'mm-edge-path');
        this.svg.appendChild(pathEl);
      }
      pathEl.setAttribute('d', p.d);
      pathEl.classList.toggle('mm-path-highlight', p.highlighted);
      pathEl.classList.toggle('mm-dimmed', p.dimmed);
    });
    for (const [id, el] of existing) if (!seen.has(id)) el.remove();
  }
}

/* ------------------------------ 9. SIDEBAR -------------------------------- */
class Sidebar {
  constructor(app) {
    this.app = app;
    this.treeEl = app.el.tree;
  }

  render() {
    this.treeEl.innerHTML = '';
    this.treeEl.appendChild(this._buildNode(this.app.model.root));
  }

  _buildNode(node) {
    const wrap = document.createElement('div');
    wrap.className = 'mm-tree-node';

    const row = document.createElement('div');
    row.className = 'mm-tree-row';
    if (this.app.selectedId === node.id) row.classList.add('mm-selected');
    if (this.app.search.matchIds.has(node.id)) row.classList.add('mm-match');

    const hasKids = (node.children || []).length > 0;
    row.innerHTML = `
      <span class="mm-tree-caret ${hasKids ? (node.collapsed ? '' : 'mm-open') : 'mm-leaf'}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="9 6 15 12 9 18"/></svg>
      </span>
      <span class="mm-tree-dot" style="background:${node.color || ColorPalette.default()}"></span>
      <span class="mm-tree-lbl">${Utils.escapeHtml(node.title)}</span>
    `;
    row.querySelector('.mm-tree-caret').addEventListener('click', (e) => {
      e.stopPropagation();
      if (hasKids) this.app.toggleCollapse(node.id);
    });
    row.addEventListener('click', () => this.app.selectNode(node.id, { center: true, openEditor: false }));
    wrap.appendChild(row);

    if (hasKids && !node.collapsed) {
      const childrenEl = document.createElement('div');
      childrenEl.className = 'mm-tree-children';
      node.children.forEach(c => childrenEl.appendChild(this._buildNode(c)));
      wrap.appendChild(childrenEl);
    }
    return wrap;
  }
}

/* ---------------------------- 10. NODE EDITOR ------------------------------ */
class NodeEditor {
  constructor(app) {
    this.app = app;
    this.el = app.el.editor;
    this.currentId = null;
    this._buildOptionGrids();
    this._bind();
  }

  _buildOptionGrids() {
    const iconGrid = document.getElementById('mmIconGrid');
    iconGrid.innerHTML = IconLibrary.list().map(key =>
      `<button class="mm-icon-opt" data-icon="${key}" title="${key}">${IconLibrary.glyph(key)}</button>`
    ).join('');
    const colorGrid = document.getElementById('mmColorGrid');
    colorGrid.innerHTML = ColorPalette.swatches.map(c =>
      `<button class="mm-color-opt" data-color="${c}" style="background:${c}"></button>`
    ).join('');
  }

  _bind() {
    document.getElementById('mmEditorClose').addEventListener('click', () => this.close());

    const titleI = document.getElementById('mmFieldTitle');
    const catI = document.getElementById('mmFieldCategory');
    const descI = document.getElementById('mmFieldDescription');
    const notesI = document.getElementById('mmFieldNotes');

    const patchDebounced = Utils.debounce((patch) => {
      if (!this.currentId) return;
      this.app.history.record();
      this.app.model.update(this.currentId, patch);
      this.app.commit({ skipHistory: true, keepEditor: true });
    }, 300);

    titleI.addEventListener('input', () => patchDebounced({ title: titleI.value || 'Sem título' }));
    catI.addEventListener('input', () => patchDebounced({ category: catI.value }));
    descI.addEventListener('input', () => patchDebounced({ description: descI.value }));
    notesI.addEventListener('input', () => patchDebounced({ notes: notesI.value }));

    document.getElementById('mmIconGrid').addEventListener('click', (e) => {
      const btn = e.target.closest('.mm-icon-opt');
      if (!btn || !this.currentId) return;
      this.app.history.record();
      this.app.model.update(this.currentId, { icon: btn.dataset.icon });
      this.app.commit({ skipHistory: true, keepEditor: true });
    });
    document.getElementById('mmColorGrid').addEventListener('click', (e) => {
      const btn = e.target.closest('.mm-color-opt');
      if (!btn || !this.currentId) return;
      this.app.history.record();
      this.app.model.update(this.currentId, { color: btn.dataset.color });
      this.app.commit({ skipHistory: true, keepEditor: true });
    });

    document.getElementById('mmEditorDuplicate').addEventListener('click', () => {
      if (this.currentId) this.app.duplicateNode(this.currentId);
    });
    document.getElementById('mmEditorDelete').addEventListener('click', () => {
      if (this.currentId) this.app.deleteNode(this.currentId);
    });
  }

  open(id) {
    const node = this.app.model.find(id);
    if (!node) return;
    this.currentId = id;
    document.getElementById('mmFieldTitle').value = node.title || '';
    document.getElementById('mmFieldCategory').value = node.category || '';
    document.getElementById('mmFieldDescription').value = node.description || '';
    document.getElementById('mmFieldNotes').value = node.notes || '';
    document.getElementById('mmFieldId').textContent = `ID: ${node.id}`;
    const count = this.app.model.countDescendants(id);
    document.getElementById('mmFieldChildCount').textContent = count ? `${count} descendente(s)` : 'Nó folha';

    document.querySelectorAll('#mmIconGrid .mm-icon-opt').forEach(b => b.classList.toggle('mm-active', b.dataset.icon === node.icon));
    document.querySelectorAll('#mmColorGrid .mm-color-opt').forEach(b => b.classList.toggle('mm-active', b.dataset.color.toLowerCase() === (node.color || '').toLowerCase()));

    this.el.hidden = false;
  }

  refreshIfOpen() {
    if (this.currentId && !this.el.hidden) this.open(this.currentId);
  }

  close() {
    this.el.hidden = true;
    this.currentId = null;
  }
}

/* ---------------------------- 11. CONTEXT MENU ------------------------------ */
class ContextMenu {
  constructor(app) {
    this.app = app;
    this.el = app.el.ctxMenu;
    document.addEventListener('click', () => this.close());
    document.addEventListener('contextmenu', (e) => {
      if (!e.target.closest('.mm-node')) this.close();
    });
    window.addEventListener('scroll', () => this.close(), true);
  }

  openForNode(nodeId, x, y) {
    const node = this.app.model.find(nodeId);
    if (!node) return;
    const isRoot = nodeId === this.app.model.root.id;
    this.el.innerHTML = `
      <div class="mm-ctx-item" data-act="add-child"><span class="mm-ctx-icon">＋</span>Adicionar filho</div>
      ${!isRoot ? `<div class="mm-ctx-item" data-act="add-sibling"><span class="mm-ctx-icon">⤢</span>Adicionar irmão</div>` : ''}
      <div class="mm-ctx-item" data-act="rename"><span class="mm-ctx-icon">✎</span>Renomear</div>
      <div class="mm-ctx-item" data-act="duplicate"><span class="mm-ctx-icon">⧉</span>Duplicar</div>
      ${!isRoot ? `<div class="mm-ctx-item" data-act="move"><span class="mm-ctx-icon">⇄</span>Mover</div>` : ''}
      <div class="mm-ctx-sep"></div>
      <div class="mm-ctx-item" data-act="toggle-collapse"><span class="mm-ctx-icon">${node.collapsed ? '▸' : '▾'}</span>${node.collapsed ? 'Expandir' : 'Colapsar'}</div>
      <div class="mm-ctx-sep"></div>
      <div class="mm-ctx-sub"><span style="color:var(--mm-text-3);font-size:10.5px;text-transform:uppercase;letter-spacing:.06em">Cor</span>
        <div class="mm-color-grid" style="margin-top:6px">
          ${ColorPalette.swatches.map(c => `<button class="mm-color-opt" data-color="${c}" style="background:${c}"></button>`).join('')}
        </div>
      </div>
      <div class="mm-ctx-sub"><span style="color:var(--mm-text-3);font-size:10.5px;text-transform:uppercase;letter-spacing:.06em">Ícone</span>
        <div class="mm-icon-grid" style="margin-top:6px">
          ${IconLibrary.list().slice(0, 18).map(key => `<button class="mm-icon-opt" data-icon="${key}">${IconLibrary.glyph(key)}</button>`).join('')}
        </div>
      </div>
      <div class="mm-ctx-sep"></div>
      ${!isRoot ? `<div class="mm-ctx-item mm-danger" data-act="delete"><span class="mm-ctx-icon">🗑</span>Excluir</div>` : ''}
    `;
    this.el.querySelectorAll('[data-act]').forEach(item => {
      item.addEventListener('click', (e) => { e.stopPropagation(); this._handle(item.dataset.act, nodeId); this.close(); });
    });
    this.el.querySelectorAll('[data-color]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        this.app.history.record();
        this.app.model.update(nodeId, { color: item.dataset.color });
        this.app.commit({ skipHistory: true });
        this.close();
      });
    });
    this.el.querySelectorAll('[data-icon]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        this.app.history.record();
        this.app.model.update(nodeId, { icon: item.dataset.icon });
        this.app.commit({ skipHistory: true });
        this.close();
      });
    });

    this._position(x, y);
    this.el.hidden = false;
  }

  openForCanvas(x, y) {
    this.el.innerHTML = `<div class="mm-ctx-item" data-act="add-root-child"><span class="mm-ctx-icon">＋</span>Adicionar nó</div>`;
    this.el.querySelector('[data-act]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.app.addChild(this.app.model.root.id);
      this.close();
    });
    this._position(x, y);
    this.el.hidden = false;
  }

  _position(x, y) {
    this.el.style.left = '0px'; this.el.style.top = '0px'; this.el.hidden = false;
    requestAnimationFrame(() => {
      const rect = this.el.getBoundingClientRect();
      const maxX = window.innerWidth - rect.width - 8;
      const maxY = window.innerHeight - rect.height - 8;
      this.el.style.left = `${Utils.clamp(x, 8, maxX)}px`;
      this.el.style.top = `${Utils.clamp(y, 8, maxY)}px`;
    });
  }

  close() { this.el.hidden = true; }

  _handle(action, nodeId) {
    switch (action) {
      case 'add-child': this.app.addChild(nodeId); break;
      case 'add-sibling': this.app.addSibling(nodeId); break;
      case 'rename': this.app.selectNode(nodeId, { openEditor: true, focusTitle: true }); break;
      case 'duplicate': this.app.duplicateNode(nodeId); break;
      case 'move': this.app.beginMoveMode(nodeId); break;
      case 'toggle-collapse': this.app.toggleCollapse(nodeId); break;
      case 'delete': this.app.deleteNode(nodeId); break;
    }
  }
}

/* --------------------------- 12. EXPORT MANAGER ---------------------------- */
class ExportManager {
  constructor(app) { this.app = app; }

  exportJSON() { Storage.exportJSON(this.app.model.toJSON()); this.app.toast('JSON exportado.'); }

  async importJSON(file) {
    try {
      const data = await Storage.importJSON(file);
      if (!data || !data.id || !('children' in data)) throw new Error('Estrutura inválida.');
      this.app.history.record();
      this.app.loadModel(data);
      this.app.toast('Mapa importado com sucesso.');
    } catch (e) {
      this.app.toast(`Erro ao importar: ${e.message}`, true);
    }
  }

  /* Gera um SVG "real" e independente (nós como <rect>/<text>, conexões como <path>) */
  buildStandaloneSVG() {
    const positions = this.app.renderer.positions;
    const b = this.app.renderer._bounds(positions);
    const pad = 60;
    const W = (b.maxX - b.minX) + pad * 2;
    const H = (b.maxY - b.minY) + pad * 2;
    const ox = -b.minX + pad, oy = -b.minY + pad;

    let edges = '';
    let nodes = '';
    const walk = (node) => {
      const p = positions.get(node.id);
      if (!p) return;
      const x = p.x + ox, y = p.y + oy;
      if (!node.collapsed) {
        (node.children || []).forEach(child => {
          const cp = positions.get(child.id);
          if (!cp) return;
          const x0 = x + p.w, y0 = y + p.h / 2;
          const x1 = cp.x + ox, y1 = cp.y + oy + cp.h / 2;
          const dx = Math.max(40, (x1 - x0) * 0.5);
          edges += `<path d="M ${x0} ${y0} C ${x0 + dx} ${y0}, ${x1 - dx} ${y1}, ${x1} ${y1}" fill="none" stroke="#22314A" stroke-width="2"/>`;
        });
      }
      const title = Utils.escapeHtml(node.title).slice(0, 34);
      nodes += `
        <g>
          <rect x="${x}" y="${y}" width="${p.w}" height="${p.h}" rx="14" fill="#131F33" stroke="${node.color || '#2BA9E0'}" stroke-width="2"/>
          <rect x="${x}" y="${y}" width="6" height="${p.h}" rx="3" fill="${node.color || '#2BA9E0'}"/>
          <text x="${x + 20}" y="${y + p.h / 2 + 5}" font-family="IBM Plex Sans, sans-serif" font-size="13" font-weight="600" fill="#E7EEF7">${title}</text>
        </g>`;
      if (!node.collapsed) (node.children || []).forEach(walk);
    };
    walk(this.app.model.root);

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <rect width="${W}" height="${H}" fill="#0A0F1A"/>
      ${edges}
      ${nodes}
    </svg>`;
  }

  exportSVG() {
    const svg = this.buildStandaloneSVG();
    Utils.download(`mindmap-${Date.now()}.svg`, svg, 'image/svg+xml');
    this.app.toast('SVG exportado.');
  }

  async exportPNG() {
    if (typeof html2canvas === 'undefined') { this.app.toast('Biblioteca html2canvas indisponível (offline).', true); return; }
    this.app.toast('Gerando imagem PNG...');
    try {
      const canvas = await html2canvas(this.app.el.world, {
        backgroundColor: '#0A0F1A', scale: 2, useCORS: true,
      });
      canvas.toBlob(blob => Utils.download(`mindmap-${Date.now()}.png`, blob, 'image/png'));
    } catch (e) { this.app.toast('Falha ao exportar PNG.', true); }
  }

  async exportPDF() {
    if (typeof html2canvas === 'undefined' || !window.jspdf) { this.app.toast('Bibliotecas de PDF indisponíveis (offline).', true); return; }
    this.app.toast('Gerando PDF...');
    try {
      const canvas = await html2canvas(this.app.el.world, { backgroundColor: '#0A0F1A', scale: 2, useCORS: true });
      const { jsPDF } = window.jspdf;
      const orientation = canvas.width > canvas.height ? 'l' : 'p';
      const pdf = new jsPDF({ orientation, unit: 'px', format: [canvas.width, canvas.height] });
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height);
      pdf.save(`mindmap-${Date.now()}.pdf`);
    } catch (e) { this.app.toast('Falha ao exportar PDF.', true); }
  }
}

/* ------------------------------ FALLBACK DATA ------------------------------- */
/* Cópia embutida de mindmap-data.json — usada quando o arquivo é aberto
 * diretamente (file://) e o fetch() é bloqueado pelo navegador. */
const DEFAULT_TREE = {
  id: 'root', title: 'POP Operações', description: 'Procedimento Operacional Padrão — visão geral das frentes de operação.',
  category: 'Raiz', icon: 'hub', color: '#2BA9E0', notes: '', collapsed: false, ox: 0, oy: 0,
  children: [
    { id: 'mineracao', title: 'Mineração', description: '', category: 'Setor', icon: 'mountain', color: '#F2A65A', notes: '', collapsed: false, ox: 0, oy: 0, children: [
      { id: 'min-barragens', title: 'Barragens', description: '', category: 'Ativo', icon: 'dam', color: '#F2A65A', notes: '', collapsed: false, ox: 0, oy: 0, children: [] },
      { id: 'min-correias', title: 'Correias', description: '', category: 'Ativo', icon: 'belt', color: '#F2A65A', notes: '', collapsed: false, ox: 0, oy: 0, children: [] },
      { id: 'min-britadores', title: 'Britadores', description: '', category: 'Ativo', icon: 'gear', color: '#F2A65A', notes: '', collapsed: false, ox: 0, oy: 0, children: [] },
      { id: 'min-moinhos', title: 'Moinhos', description: '', category: 'Ativo', icon: 'gear', color: '#F2A65A', notes: '', collapsed: false, ox: 0, oy: 0, children: [] },
      { id: 'min-chutes', title: 'Chutes', description: '', category: 'Ativo', icon: 'funnel', color: '#F2A65A', notes: '', collapsed: false, ox: 0, oy: 0, children: [] }
    ]},
    { id: 'petroleo-gas', title: 'Petróleo e Gás', description: '', category: 'Setor', icon: 'flame', color: '#34C795', notes: '', collapsed: false, ox: 0, oy: 0, children: [
      { id: 'og-fpso', title: 'FPSO', description: '', category: 'Ativo', icon: 'ship', color: '#34C795', notes: '', collapsed: false, ox: 0, oy: 0, children: [] },
      { id: 'og-navios', title: 'Navios', description: '', category: 'Ativo', icon: 'ship', color: '#34C795', notes: '', collapsed: false, ox: 0, oy: 0, children: [] },
      { id: 'og-plataformas', title: 'Plataformas Offshore', description: '', category: 'Ativo', icon: 'platform', color: '#34C795', notes: '', collapsed: false, ox: 0, oy: 0, children: [] },
      { id: 'og-tanques', title: 'Tanques', description: '', category: 'Ativo', icon: 'tank', color: '#34C795', notes: '', collapsed: false, ox: 0, oy: 0, children: [] },
      { id: 'og-tubulacoes', title: 'Tubulações', description: '', category: 'Ativo', icon: 'pipe', color: '#34C795', notes: '', collapsed: false, ox: 0, oy: 0, children: [] },
      { id: 'og-flare', title: 'Flare', description: '', category: 'Ativo', icon: 'flame', color: '#34C795', notes: '', collapsed: false, ox: 0, oy: 0, children: [] },
      { id: 'og-vasos', title: 'Vasos', description: '', category: 'Ativo', icon: 'vessel', color: '#34C795', notes: '', collapsed: false, ox: 0, oy: 0, children: [] }
    ]},
    { id: 'celulose', title: 'Celulose', description: '', category: 'Setor', icon: 'leaf', color: '#4FD1C5', notes: '', collapsed: false, ox: 0, oy: 0, children: [
      { id: 'cel-digestores', title: 'Digestores', description: '', category: 'Ativo', icon: 'flask', color: '#4FD1C5', notes: '', collapsed: false, ox: 0, oy: 0, children: [] },
      { id: 'cel-caldeiras', title: 'Caldeiras', description: '', category: 'Ativo', icon: 'boiler', color: '#4FD1C5', notes: '', collapsed: false, ox: 0, oy: 0, children: [] },
      { id: 'cel-chamines', title: 'Chaminés', description: '', category: 'Ativo', icon: 'chimney', color: '#4FD1C5', notes: '', collapsed: false, ox: 0, oy: 0, children: [] },
      { id: 'cel-silos', title: 'Silos', description: '', category: 'Ativo', icon: 'silo', color: '#4FD1C5', notes: '', collapsed: false, ox: 0, oy: 0, children: [] }
    ]},
    { id: 'energia', title: 'Energia', description: '', category: 'Setor', icon: 'bolt', color: '#F2B84B', notes: '', collapsed: false, ox: 0, oy: 0, children: [
      { id: 'energ-torres', title: 'Torres', description: '', category: 'Ativo', icon: 'tower', color: '#F2B84B', notes: '', collapsed: false, ox: 0, oy: 0, children: [] },
      { id: 'energ-subestacoes', title: 'Subestações', description: '', category: 'Ativo', icon: 'substation', color: '#F2B84B', notes: '', collapsed: false, ox: 0, oy: 0, children: [] },
      { id: 'energ-linhas', title: 'Linhas', description: '', category: 'Ativo', icon: 'line', color: '#F2B84B', notes: '', collapsed: false, ox: 0, oy: 0, children: [] },
      { id: 'energ-turbinas', title: 'Turbinas', description: '', category: 'Ativo', icon: 'turbine', color: '#F2B84B', notes: '', collapsed: false, ox: 0, oy: 0, children: [] }
    ]},
    { id: 'infraestrutura', title: 'Infraestrutura', description: '', category: 'Setor', icon: 'bridge', color: '#7C93FF', notes: '', collapsed: false, ox: 0, oy: 0, children: [
      { id: 'infra-pontes', title: 'Pontes', description: '', category: 'Ativo', icon: 'bridge', color: '#7C93FF', notes: '', collapsed: false, ox: 0, oy: 0, children: [] },
      { id: 'infra-tuneis', title: 'Túneis', description: '', category: 'Ativo', icon: 'tunnel', color: '#7C93FF', notes: '', collapsed: false, ox: 0, oy: 0, children: [] },
      { id: 'infra-galerias', title: 'Galerias', description: '', category: 'Ativo', icon: 'gallery', color: '#7C93FF', notes: '', collapsed: false, ox: 0, oy: 0, children: [] },
      { id: 'infra-reservatorios', title: 'Reservatórios', description: '', category: 'Ativo', icon: 'tank', color: '#7C93FF', notes: '', collapsed: false, ox: 0, oy: 0, children: [] }
    ]},
    { id: 'siderurgia', title: 'Siderurgia', description: '', category: 'Setor', icon: 'factory', color: '#F2726C', notes: '', collapsed: false, ox: 0, oy: 0, children: [
      { id: 'sid-altos-fornos', title: 'Altos-Fornos', description: '', category: 'Ativo', icon: 'furnace', color: '#F2726C', notes: '', collapsed: false, ox: 0, oy: 0, children: [] },
      { id: 'sid-coquerias', title: 'Coquerias', description: '', category: 'Ativo', icon: 'furnace', color: '#F2726C', notes: '', collapsed: false, ox: 0, oy: 0, children: [] },
      { id: 'sid-convertedores', title: 'Convertedores', description: '', category: 'Ativo', icon: 'flask', color: '#F2726C', notes: '', collapsed: false, ox: 0, oy: 0, children: [] },
      { id: 'sid-pontes-rolantes', title: 'Pontes Rolantes', description: '', category: 'Ativo', icon: 'crane', color: '#F2726C', notes: '', collapsed: false, ox: 0, oy: 0, children: [] }
    ]}
  ]
};

/* ------------------------------- 13. APP ------------------------------------ */
class MindMapApp {
  constructor() {
    this.el = {
      app: document.getElementById('mmApp'),
      sidebar: document.getElementById('mmSidebar'),
      tree: document.getElementById('mmTree'),
      viewport: document.getElementById('mmViewport'),
      world: document.getElementById('mmWorld'),
      svg: document.getElementById('mmSvg'),
      nodesLayer: document.getElementById('mmNodesLayer'),
      editor: document.getElementById('mmEditor'),
      ctxMenu: document.getElementById('mmCtxMenu'),
      toast: document.getElementById('mmToast'),
      searchInput: document.getElementById('mmSearchInput'),
      searchCount: document.getElementById('mmSearchCount'),
      searchNav: document.getElementById('mmSearchNav'),
      moveBanner: document.getElementById('mmMoveBanner'),
      selectedPath: document.getElementById('mmSelectedPath'),
      zoomLbl: document.getElementById('mmZoomLbl'),
    };

    this.selectedId = null;
    this.dragDropTargetId = null;
    this.moveModeSourceId = null;
    this.search = { active: false, query: '', matchIds: new Set(), pathIds: new Set(), matches: [], cursor: -1 };

    this.layout = new LayoutEngine({});
    this.history = new HistoryManager(() => this.model.toJSON(), (data) => this.loadModel(data, { fromHistory: true }));
    this.renderer = new MindMapRenderer(this);
    this.sidebar = new Sidebar(this);
    this.editor = new NodeEditor(this);
    this.ctxMenu = new ContextMenu(this);
    this.exportMgr = new ExportManager(this);
    this.viewport = new Viewport(this.el.viewport, this.el.world, (scale) => {
      this.el.zoomLbl.textContent = `${Math.round(scale * 100)}%`;
    });

    this._saveDebounced = Utils.debounce(() => {
      Storage.saveTree(this.model.toJSON());
      this._flashAutosave();
    }, 500);

    this._init();
  }

  async _init() {
    const data = await Storage.loadTree();
    this.model = TreeModel.fromJSON ? TreeModel.fromJSON(data) : new TreeModel(data);
    this.selectedId = this.model.root.id;
    this._bindGlobalEvents();
    this.render();
    requestAnimationFrame(() => this.centerMap());
  }

  loadModel(data, opts = {}) {
    this.model = new TreeModel(Utils.clone(data));
    if (!this.model.find(this.selectedId)) this.selectedId = this.model.root.id;
    this.editor.close();
    this.render();
    if (!opts.fromHistory) requestAnimationFrame(() => this.centerMap());
    this._saveDebounced();
  }

  render() {
    this.renderer.render();
    this._updateSelectedPath();
  }

  /* Chamado após qualquer mutação de dados */
  commit(opts = {}) {
    if (!opts.skipHistory) this.history.record();
    this.render();
    if (opts.keepEditor) this.editor.refreshIfOpen();
    this._saveDebounced();
  }

  /* ------------------------- ações sobre nós ------------------------- */
  addChild(parentId) {
    this.history.record();
    const node = this.model.addChild(parentId, {});
    this.render();
    this._saveDebounced();
    if (node) this.selectNode(node.id, { openEditor: true, focusTitle: true, center: true });
    this.toast('Nó adicionado.');
  }

  addSibling(id) {
    this.history.record();
    const node = this.model.addSibling(id, {});
    this.render();
    this._saveDebounced();
    if (node) this.selectNode(node.id, { openEditor: true, focusTitle: true, center: true });
    this.toast('Nó adicionado.');
  }

  duplicateNode(id) {
    if (id === this.model.root.id) { this.toast('Não é possível duplicar a raiz.', true); return; }
    this.history.record();
    const clone = this.model.duplicate(id);
    this.render();
    this._saveDebounced();
    if (clone) this.selectNode(clone.id, { center: true });
    this.toast('Nó duplicado.');
  }

  deleteNode(id) {
    if (id === this.model.root.id) { this.toast('A raiz não pode ser excluída.', true); return; }
    const count = this.model.countDescendants(id);
    const node = this.model.find(id);
    const msg = count > 0
      ? `Excluir "${node.title}" e seus ${count} nó(s) filho(s)?`
      : `Excluir "${node.title}"?`;
    if (!confirm(msg)) return;
    this.history.record();
    const parent = this.model.parentOf(id);
    this.model.remove(id);
    this.editor.close();
    this.selectedId = parent ? parent.id : this.model.root.id;
    this.render();
    this._saveDebounced();
    this.toast('Nó excluído.');
  }

  toggleCollapse(id) {
    this.history.record();
    this.model.toggleCollapse(id);
    this.render();
    this._saveDebounced();
  }

  expandAll() { this.history.record(); this.model.expandAll(); this.render(); this._saveDebounced(); }
  collapseAll() { this.history.record(); this.model.collapseAll(); this.render(); this._saveDebounced(); }

  beginMoveMode(id) {
    this.moveModeSourceId = id;
    this.el.moveBanner.hidden = false;
    this.toast('Clique no nó de destino.');
  }
  cancelMoveMode() {
    this.moveModeSourceId = null;
    this.el.moveBanner.hidden = true;
  }

  /* ---------------------------- seleção -------------------------------- */
  selectNode(id, opts = {}) {
    if (this.moveModeSourceId) {
      if (id !== this.moveModeSourceId) {
        this.history.record();
        const ok = this.model.move(this.moveModeSourceId, id);
        if (ok) this.toast('Nó movido.'); else this.toast('Movimento inválido.', true);
        this.render();
        this._saveDebounced();
      }
      this.cancelMoveMode();
      return;
    }
    this.selectedId = id;
    this.render();
    if (opts.openEditor) {
      this.editor.open(id);
      if (opts.focusTitle) {
        requestAnimationFrame(() => {
          const t = document.getElementById('mmFieldTitle');
          t.focus(); t.select();
        });
      }
    }
    if (opts.center) this.centerOnNode(id);
  }

  handleNodeClick(id) {
    this.selectNode(id, { openEditor: true });
  }

  startInlineRename(id, titleEl) {
    titleEl.contentEditable = 'true';
    titleEl.focus();
    document.execCommand('selectAll', false, null);
    const finish = (commit) => {
      titleEl.contentEditable = 'false';
      titleEl.removeEventListener('blur', onBlur);
      titleEl.removeEventListener('keydown', onKey);
      if (commit) {
        const val = titleEl.textContent.trim() || 'Sem título';
        this.history.record();
        this.model.update(id, { title: val });
        this.commit({ skipHistory: true });
      } else {
        this.render();
      }
    };
    const onBlur = () => finish(true);
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    };
    titleEl.addEventListener('blur', onBlur);
    titleEl.addEventListener('keydown', onKey);
  }

  /* ----------------------------- viewport ------------------------------- */
  centerMap() {
    const b = this.renderer._bounds(this.renderer.positions);
    this.viewport.centerOnBounds(b);
  }
  centerOnNode(id) {
    const pos = this.renderer.positions.get(id);
    if (!pos) return;
    this.viewport.centerOnPoint(pos.x + pos.w / 2, pos.y + pos.h / 2);
  }

  _updateSelectedPath() {
    const path = this.model.pathTo(this.selectedId);
    this.el.selectedPath.textContent = path.map(n => n.title).join(' › ') || this.model.root.title;
  }

  updateToolbarState() {
    document.getElementById('mmBtnUndo').style.opacity = this.history.canUndo ? 1 : .35;
    document.getElementById('mmBtnRedo').style.opacity = this.history.canRedo ? 1 : .35;
  }

  /* ------------------------------ busca ---------------------------------- */
  runSearch(query) {
    query = (query || '').trim().toLowerCase();
    this.search.query = query;
    this.search.matchIds = new Set();
    this.search.pathIds = new Set();
    this.search.matches = [];
    this.search.cursor = -1;
    this.search.active = query.length > 0;

    if (this.search.active) {
      const walk = (node) => {
        const hay = `${node.title} ${node.description} ${node.category} ${node.notes}`.toLowerCase();
        if (hay.includes(query)) this.search.matches.push(node.id);
        (node.children || []).forEach(walk);
      };
      walk(this.model.root);
      this.search.matchIds = new Set(this.search.matches);
      if (this.search.matches.length) this.gotoSearchMatch(0);
    }

    this.el.searchCount.hidden = !this.search.active;
    this.el.searchCount.textContent = this.search.active ? `${this.search.matches.length}` : '';
    this.el.searchNav.hidden = !this.search.active || this.search.matches.length === 0;
    this.render();
  }

  gotoSearchMatch(idx) {
    if (!this.search.matches.length) return;
    this.search.cursor = ((idx % this.search.matches.length) + this.search.matches.length) % this.search.matches.length;
    const id = this.search.matches[this.search.cursor];
    // expande ancestrais para revelar o nó
    let n = this.model.find(id);
    let p = this.model.parentOf(id);
    while (p) { p.collapsed = false; p = p._parent; }
    // caminho para destacar
    this.search.pathIds = new Set(this.model.pathTo(id).map(x => x.id));
    this.selectedId = id;
    this.render();
    this.centerOnNode(id);
  }

  clearSearch() {
    this.el.searchInput.value = '';
    this.runSearch('');
  }

  /* --------------------------- toast / feedback --------------------------- */
  toast(msg, isError = false) {
    const el = this.el.toast;
    el.textContent = msg;
    el.style.borderColor = isError ? 'var(--mm-danger)' : 'var(--mm-border)';
    el.style.color = isError ? 'var(--mm-danger)' : 'var(--mm-text)';
    el.hidden = false;
    el.classList.add('mm-show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { el.classList.remove('mm-show'); }, 2200);
  }

  _flashAutosave() {
    const tag = document.getElementById('mmAutosaveTag');
    tag.textContent = 'Salvo automaticamente ✓';
    tag.style.opacity = 1;
    clearTimeout(this._autosaveTimer);
    this._autosaveTimer = setTimeout(() => { tag.style.opacity = .55; }, 1200);
  }

  /* ------------------------------ eventos --------------------------------- */
  _bindGlobalEvents() {
    // sidebar collapse (desktop) / abrir menu (mobile)
    document.getElementById('mmSidebarCollapse').addEventListener('click', () => {
      this.el.app.classList.toggle('mm-sidebar-collapsed');
    });
    document.getElementById('mmToggleSidebar').addEventListener('click', () => {
      this.el.app.classList.toggle('mm-sidebar-open');
    });

    // busca
    this.el.searchInput.addEventListener('input', Utils.debounce((e) => this.runSearch(e.target.value), 180));
    document.getElementById('mmSearchNext').addEventListener('click', () => this.gotoSearchMatch(this.search.cursor + 1));
    document.getElementById('mmSearchPrev').addEventListener('click', () => this.gotoSearchMatch(this.search.cursor - 1));
    document.getElementById('mmSearchClear').addEventListener('click', () => this.clearSearch());

    // ações da sidebar
    document.getElementById('mmBtnNewNode').addEventListener('click', () => this.addChild(this.selectedId || this.model.root.id));
    document.getElementById('mmBtnExpandAll').addEventListener('click', () => this.expandAll());
    document.getElementById('mmBtnCollapseAll').addEventListener('click', () => this.collapseAll());
    document.getElementById('mmBtnCenter').addEventListener('click', () => this.centerMap());

    // undo/redo/zoom
    document.getElementById('mmBtnUndo').addEventListener('click', () => { if (this.history.undo()) this.toast('Desfeito.'); });
    document.getElementById('mmBtnRedo').addEventListener('click', () => { if (this.history.redo()) this.toast('Refeito.'); });
    document.getElementById('mmZoomIn').addEventListener('click', () => this.viewport.zoomStep(1));
    document.getElementById('mmZoomOut').addEventListener('click', () => this.viewport.zoomStep(-1));

    // exportar / importar
    const expMenu = document.getElementById('mmExportMenu');
    document.getElementById('mmBtnExportToggle').addEventListener('click', (e) => { e.stopPropagation(); expMenu.hidden = !expMenu.hidden; });
    document.getElementById('mmBtnExportMenu').addEventListener('click', (e) => { e.stopPropagation(); expMenu.hidden = !expMenu.hidden; });
    document.addEventListener('click', () => { expMenu.hidden = true; });
    expMenu.addEventListener('click', (e) => e.stopPropagation());
    expMenu.querySelectorAll('[data-fmt]').forEach(btn => {
      btn.addEventListener('click', () => {
        const fmt = btn.dataset.fmt;
        if (fmt === 'json') this.exportMgr.exportJSON();
        if (fmt === 'png') this.exportMgr.exportPNG();
        if (fmt === 'svg') this.exportMgr.exportSVG();
        if (fmt === 'pdf') this.exportMgr.exportPDF();
        expMenu.hidden = true;
      });
    });
    const importInput = document.getElementById('mmImportInput');
    document.getElementById('mmBtnImport').addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', () => {
      if (importInput.files[0]) this.exportMgr.importJSON(importInput.files[0]);
      importInput.value = '';
    });

    // banner de "mover"
    document.getElementById('mmMoveCancel').addEventListener('click', () => this.cancelMoveMode());

    // ajuda
    const helpBackdrop = document.getElementById('mmHelpBackdrop');
    document.getElementById('mmBtnHelp').addEventListener('click', () => { helpBackdrop.hidden = false; });
    document.getElementById('mmHelpClose').addEventListener('click', () => { helpBackdrop.hidden = true; });
    helpBackdrop.addEventListener('click', (e) => { if (e.target === helpBackdrop) helpBackdrop.hidden = true; });

    // clique vazio no canvas: fecha editor / seleciona raiz visualmente
    this.el.viewport.addEventListener('mousedown', (e) => {
      if (e.target === this.el.viewport || e.target === this.el.world) {
        if (this.moveModeSourceId) { /* mantém modo mover ativo */ }
      }
    });
    this.el.viewport.addEventListener('contextmenu', (e) => {
      if (e.target === this.el.viewport || e.target === this.el.world || e.target.closest('.mm-edges')) {
        e.preventDefault();
        this.ctxMenu.openForCanvas(e.clientX, e.clientY);
      }
    });

    // atalhos de teclado
    window.addEventListener('keydown', (e) => this._handleKeydown(e));

    window.addEventListener('resize', Utils.debounce(() => this.render(), 200));
  }

  _handleKeydown(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    const isTyping = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;

    if (e.key === 'Escape') {
      if (this.moveModeSourceId) this.cancelMoveMode();
      this.ctxMenu.close();
      document.getElementById('mmHelpBackdrop').hidden = true;
      if (isTyping) e.target.blur();
      return;
    }
    if (isTyping) return;

    const meta = e.ctrlKey || e.metaKey;

    if (meta && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); if (this.history.undo()) this.toast('Desfeito.'); return; }
    if ((meta && e.key.toLowerCase() === 'y') || (meta && e.shiftKey && e.key.toLowerCase() === 'z')) { e.preventDefault(); if (this.history.redo()) this.toast('Refeito.'); return; }
    if (meta && e.key.toLowerCase() === 'f') { e.preventDefault(); this.el.searchInput.focus(); return; }
    if (meta && e.key.toLowerCase() === 'd') { e.preventDefault(); if (this.selectedId) this.duplicateNode(this.selectedId); return; }

    if (!this.selectedId) return;

    if (e.key === 'Tab') { e.preventDefault(); this.addChild(this.selectedId); return; }
    if (e.key === 'Enter') { e.preventDefault(); this.addSibling(this.selectedId); return; }
    if (e.key === 'F2') { e.preventDefault(); this.editor.open(this.selectedId); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.deleteNode(this.selectedId); return; }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); this.viewport.zoomStep(1); return; }
    if (e.key === '-' || e.key === '_') { e.preventDefault(); this.viewport.zoomStep(-1); return; }
    if (e.key === '0') { e.preventDefault(); this.centerMap(); return; }
  }
}

/* --------------------------------- BOOT -------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  window.mindMapApp = new MindMapApp();
});
