import { AnnotationStore, annotationTarget, annotationHitTarget, annotationProjection, annotationTargetsInRect, annotationSelectedTargets, annotationLabel } from './annotations.js';
import { createButton } from './ui/components.js';
import { appendDraft } from './transport.js';

export function mountAnnotations({ viewport, getContext, setMode, reveal, toast, clearSelection = () => {} }) {
  const stores = new Map();
  let editor, editing, listOpen = false, hoverTimer, gesture, hovered, multiSelecting = false, selectedTargets = [], selectionKey = '';
  const tools = document.createElement('div'); tools.className = 'annotation-tools';
  const mode = createButton({ iconName: 'message-square-plus', title: '添加标注（拖动框选，Shift/Ctrl 点击多选）', onClick: () => setMode('annotate') });
  mode.dataset.mode = 'annotate'; mode.setAttribute('aria-label', '添加标注');
  mode.setAttribute('aria-expanded', 'false'); tools.append(mode);
  viewport.querySelector('.toolbar [data-mode="hand"]').after(tools);
  const pins = document.createElement('div'); pins.className = 'annotation-pins'; viewport.append(pins);
  const selection = document.createElement('div'); selection.className = 'annotation-selection'; viewport.append(selection);
  const marquee = document.createElement('div'); marquee.className = 'annotation-marquee'; marquee.hidden = true; viewport.append(marquee);
  const list = document.createElement('section'); list.className = 'annotation-list'; list.hidden = true;
  list.setAttribute('aria-label', '所有标注'); viewport.append(list);
  const showList = () => { clearTimeout(hoverTimer); if (!listOpen) { listOpen = true; render(); } };
  const hideList = () => { hoverTimer = setTimeout(() => { listOpen = false; render(); }, 250); };
  tools.addEventListener('mouseenter', showList); tools.addEventListener('mouseleave', hideList);
  list.addEventListener('mouseenter', () => clearTimeout(hoverTimer)); list.addEventListener('mouseleave', hideList);
  const contextKey = context => `${context.route.project_id}:${context.route.image_id || ''}:${context.detail ? 'detail' : 'group'}:${context.filter}`;
  const targetKey = target => `${target.image_id}:${target.target_type}:${target.target_id}`;
  const store = () => {
    const id = getContext().route.project_id;
    if (!stores.has(id)) stores.set(id, new AnnotationStore());
    return stores.get(id);
  };
  function anchor(item) {
    const context = getContext();
    const projection = annotationProjection(item, context);
    return projection ? { x: context.pan.x + projection.x * context.zoom, y: context.pan.y + projection.y * context.zoom } : null;
  }
  function targetNames(targets, { compact = false, onRemove } = {}) {
    const root = document.createElement('div'); root.className = `annotation-objects${compact ? ' annotation-objects--compact' : ''}`;
    if (targets.length <= 1) { root.hidden = true; return root; }
    const names = document.createElement('div'); names.className = 'annotation-object-names';
    let expanded = false;
    const update = () => {
      names.replaceChildren();
      for (const target of expanded ? targets : targets.slice(0, 3)) {
        const name = document.createElement('span'); name.className = 'annotation-object-name';
        const label = target.path.at(-1) || target.target_id;
        const text = document.createElement('span'); text.className = 'annotation-tag-label'; text.textContent = label; name.append(text);
        if (onRemove && targets.length > 1) {
          const remove = createButton({ iconName: 'x', className: 'annotation-tag-remove', title: `移除 ${label}`, onClick: () => onRemove(targetKey(target)) });
          remove.setAttribute('aria-label', `移除 ${label}`); name.append(remove);
        }
        names.append(name);
      }
    };
    root.append(names); update();
    if (targets.length > 3 && !compact) {
      const toggle = createButton({ label: `展开其余 ${targets.length - 3} 项`, className: 'annotation-objects-toggle', onClick: () => {
        expanded = !expanded; update(); toggle.textContent = expanded ? '收起' : `展开其余 ${targets.length - 3} 项`;
        toggle.setAttribute('aria-expanded', String(expanded)); toggle.setAttribute('aria-label', toggle.textContent);
      } });
      toggle.setAttribute('aria-expanded', 'false'); root.append(toggle);
    }
    return root;
  }
  function closeEditor() {
    editor?.remove(); editor = null; editing = null; hovered = null; selectedTargets = []; selection.replaceChildren();
  }
  function editorHidden() { return Boolean((gesture || multiSelecting) && !editing?.inputFocused); }
  function confirmEditor() {
    if (!editing || store().busy) return false;
    try {
      if (editing.text.trim()) {
        const item = editing.isNew ? store().add(editing.item) : editing.item;
        store().update(item.id, editing.text.trim(), editing.item);
      }
      closeEditor(); render(); return true;
    } catch (error) { toast(error.message); return false; }
  }
  function blankClick() {
    multiSelecting = false;
    if (editing && !confirmEditor()) return;
    clearSelection(); hovered = null; selectedTargets = []; drawTargets(); render();
  }
  function openEditor(item, isNew = false, text = item.text || '') {
    closeEditor();
    editing = { item, isNew, text, key: contextKey(getContext()), projectId: getContext().route.project_id };
    selectedTargets = item.targets?.length ? [...item.targets] : [item];
    editor = document.createElement('section'); editor.className = 'annotation-editor';
    editor.setAttribute('aria-label', '标注详情');
    const heading = document.createElement('strong'); heading.textContent = annotationLabel(item);
    const close = createButton({ iconName: 'x', title: '关闭标注弹窗', onClick: () => { closeEditor(); render(); } });
    close.setAttribute('aria-label', '关闭标注弹窗');
    const header = document.createElement('header'); header.append(heading, close);
    const removeTarget = key => {
      if (!editing || store().busy || selectedTargets.length <= 1) return;
      selectedTargets = selectedTargets.filter(target => targetKey(target) !== key);
      const previous = editing.item;
      editing.item = { ...selectedTargets[0], id: previous.id, number: previous.number, scope: previous.scope, text: previous.text, targets: [...selectedTargets] };
      hovered = null;
      const names = targetNames(selectedTargets, { onRemove: removeTarget });
      path.hidden = names.hidden; path.replaceChildren(...names.children); render();
    };
    const path = targetNames(selectedTargets, { onRemove: removeTarget });
    const input = document.createElement('textarea'); input.className = 'ui-input'; input.maxLength = 4000;
    input.placeholder = '输入标注内容…'; input.value = text; input.setAttribute('aria-label', '标注内容');
    input.oninput = () => { if (editing) { editing.text = input.value; editing.inputFocused = true; editor.hidden = false; } };
    input.addEventListener('focus', () => { if (editing) { editing.inputFocused = true; editor.hidden = false; } });
    input.addEventListener('blur', () => { if (editing) { editing.inputFocused = false; editor.hidden = editorHidden(); } });
    const footer = document.createElement('footer');
    footer.append(createButton({ label: '取消', onClick: () => { closeEditor(); render(); } }), createButton({ label: '确认', variant: 'primary', onClick: confirmEditor }));
    editor.append(header, path, input, footer); viewport.append(editor); render(); if (!editor.hidden) input.focus();
  }
  function remove(id) {
    if (store().busy) return;
    if (hovered?.id === id) hovered = null;
    store().remove(id); if (editing?.item.id === id) closeEditor(); render();
  }
  function drawTargets() {
    selection.replaceChildren();
    const context = getContext();
    const active = hovered || editing?.item;
    const area = active ? annotationProjection(active, context)?.area : null;
    if (area && !gesture) {
      const box = document.createElement('div'); box.className = 'annotation-target-outline';
      Object.assign(box.style, { left: `${context.pan.x + area.x * context.zoom}px`, top: `${context.pan.y + area.y * context.zoom}px`,
        width: `${area.width * context.zoom}px`, height: `${area.height * context.zoom}px` });
      selection.append(box);
    }
    const targets = gesture?.targets || (hovered ? hovered.targets?.length ? hovered.targets : [hovered] : selectedTargets);
    for (const target of targets) {
      const bounds = annotationProjection(target, context)?.bounds;
      if (!bounds) continue;
      const box = document.createElement('div'); box.className = 'annotation-target-outline';
      Object.assign(box.style, { left: `${context.pan.x + bounds.x * context.zoom}px`, top: `${context.pan.y + bounds.y * context.zoom}px`,
        width: `${bounds.width * context.zoom}px`, height: `${bounds.height * context.zoom}px` });
      selection.append(box);
    }
  }
  function render() {
    const context = getContext(), current = store(), key = contextKey(context);
    mode.disabled = !context.route.project_id || !context.boards.length || current.busy;
    mode.setAttribute('aria-expanded', String(listOpen));
    if (selectionKey !== key) { selectionKey = key; selectedTargets = []; hovered = null; gesture = null; marquee.hidden = true; multiSelecting = false; }
    if (editor && (editing.key !== key || !anchor(editing.item))) closeEditor();
    if (editing?.isNew) editing.item.number = current.items.length + 1;
    pins.replaceChildren();
    const items = current.items.map(item => editing?.item.id === item.id ? editing.item : item);
    if (editing?.isNew) items.push(editing.item);
    for (const item of items) {
      const position = anchor(item); if (!position) continue;
      const pin = createButton({ label: String(item.number), className: 'annotation-pin', title: annotationLabel(item), onClick: () => editing?.item.id === item.id ? (closeEditor(), render()) : openEditor(item) });
      pin.setAttribute('aria-label', annotationLabel(item));
      pin.addEventListener('mouseenter', () => { hovered = item; drawTargets(); });
      pin.addEventListener('mouseleave', () => { hovered = null; drawTargets(); });
      pin.style.left = `${position.x}px`; pin.style.top = `${position.y}px`; pins.append(pin);
      if (editing?.item.id === item.id && editor) {
        const width = Math.min(280, viewport.clientWidth - 24);
        editor.style.width = `${width}px`;
        editor.style.left = `${Math.max(12, Math.min(viewport.clientWidth - width - 12, position.x + 24))}px`;
        editor.style.top = `${Math.max(12, Math.min(viewport.clientHeight - 250, position.y - 18))}px`;
        editor.querySelector('strong').textContent = annotationLabel(item);
      }
    }
    drawTargets();
    if (editor) {
      editor.hidden = editorHidden();
      editor.querySelector('textarea').disabled = current.busy;
      editor.querySelectorAll('button').forEach(button => button.disabled = current.busy);
    }
    list.hidden = !listOpen || !context.route.project_id; list.replaceChildren();
    if (!listOpen) return;
    const heading = document.createElement('strong'); heading.textContent = `全部标注（${current.items.length}）`;
    const close = createButton({ iconName: 'x', title: '关闭标注列表', onClick: () => { listOpen = false; render(); } });
    const header = document.createElement('header'); header.append(heading, close); list.append(header);
    if (!current.items.length) { const empty = document.createElement('p'); empty.textContent = '点击或拖动框选添加标注，Shift/Ctrl 点击多选，确认后在此显示'; list.append(empty); }
    for (const item of current.items) {
      const row = document.createElement('div'); row.className = 'annotation-list-row';
      const content = createButton({ className: 'annotation-list-content', onClick: async () => {
        const projectId = context.route.project_id;
        try {
          if (!anchor(item)) await reveal(item);
          if (getContext().route.project_id !== projectId || !store().items.includes(item)) return;
          if (!anchor(item)) { toast('对应画板尚未加载，请稍后再次点击标注'); return; }
          listOpen = false; openEditor(item);
        } catch (error) { toast(error.message); }
      } });
      const title = document.createElement('strong'); title.textContent = `${item.number}.${item.text}`;
      content.append(title);
      const names = targetNames(item.targets?.length ? item.targets : [item], { compact: true });
      const body = document.createElement('div'); body.className = 'annotation-list-body'; body.append(content, names);
      const removeButton = createButton({ iconName: 'trash-2', title: `删除标注 ${item.number}`, onClick: () => remove(item.id) });
      removeButton.disabled = current.busy; content.disabled = current.busy;
      row.addEventListener('mouseenter', () => { hovered = item; drawTargets(); });
      row.addEventListener('mouseleave', () => { hovered = null; drawTargets(); });
      row.append(body, removeButton); list.append(row);
    }
    const footer = document.createElement('footer');
    const clear = createButton({ label: '清空', onClick: () => {
      if (current.busy) return;
      current.clear(); hovered = null; cancelGesture(); closeEditor(); render();
    } });
    const send = createButton({ label: current.busy ? '正在提交…' : '提交', variant: 'primary', onClick: async () => {
      closeEditor();
      const pending = current.send(appendDraft); render();
      try { await pending; if (store() === current) closeEditor(); toast('标注已追加到 Composer 草稿，未自动发送；标注已清空'); }
      catch (error) { toast(error.message); }
      finally { render(); }
    } });
    clear.disabled = current.busy || !current.items.length && !editing;
    send.disabled = !current.items.length || current.busy; footer.append(clear, send); list.append(footer);
  }
  const screenPoint = event => { const rect = viewport.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
  const worldPoint = point => { const context = getContext(); return { x: (point.x - context.pan.x) / context.zoom, y: (point.y - context.pan.y) / context.zoom }; };
  const rectangle = (start, end) => ({ x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) });
  function draftTargets(targets, point, area, additive) {
    if (!targets.length) { render(); return; }
    const context = getContext(), text = (additive || area) && editing?.isNew ? editing.text : '';
    const merged = new Map((additive ? selectedTargets : []).map(target => [targetKey(target), target]));
    for (const target of targets) {
      if (additive && !area && merged.has(targetKey(target))) merged.delete(targetKey(target));
      else merged.set(targetKey(target), target);
    }
    const chosen = [...merged.values()];
    if (!chosen.length && additive) { closeEditor(); render(); return; }
    const primary = chosen[0];
    const board = context.detail && context.boards[0];
    const localArea = area && board ? { ...area, x: area.x - board.x, y: area.y - board.y } : area;
    const item = { ...primary, scope: context.detail ? 'detail' : 'group', id: crypto.randomUUID(), number: store().items.length + 1, targets: chosen.length ? chosen : [primary],
      ...(localArea ? { area: localArea } : {}), text: '' };
    openEditor(item, true, text);
  }
  viewport.addEventListener('pointerdown', event => {
    const context = getContext();
    if (context.mode !== 'annotate' || context.space || event.button !== 0 || event.target.closest('.toolbar,.annotation-editor,.annotation-pin,.annotation-list,.panel-handle')) return;
    if (store().busy || !context.boards.length) return;
    if (!context.route.project_id || !context.detail && !context.filter) { toast('请先选择项目分组'); return; }
    event.preventDefault(); event.stopImmediatePropagation();
    hovered = null; multiSelecting = event.shiftKey || event.ctrlKey || event.metaKey;
    if (editor) { editing.inputFocused = false; editor.querySelector('textarea').blur(); editor.hidden = true; }
    listOpen = false; list.hidden = true;
    const start = screenPoint(event);
    gesture = { pointerId: event.pointerId, start, worldStart: worldPoint(start), key: contextKey(context),
      imageId: event.target.closest('.board')?.dataset.id, additive: event.shiftKey || event.ctrlKey || event.metaKey };
    viewport.setPointerCapture(event.pointerId);
  }, true);
  viewport.addEventListener('pointermove', event => {
    if (!gesture) {
      const context = getContext(), imageId = event.target.closest('.board')?.dataset.id;
      if (context.mode === 'annotate' && !context.space && !editing && imageId) { hovered = annotationHitTarget(context, worldPoint(screenPoint(event)), imageId); drawTargets(); }
      else if (!editing && hovered) { hovered = null; drawTargets(); }
      return;
    }
    if (gesture.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const area = rectangle(gesture.start, screenPoint(event));
    if (Math.max(area.width, area.height) < 4) return;
    gesture.moved = true; marquee.hidden = false;
    if (editor) editor.hidden = true;
    const targets = annotationTargetsInRect(getContext(), rectangle(gesture.worldStart, worldPoint(screenPoint(event))));
    gesture.targets = gesture.additive ? [...new Map([...selectedTargets, ...targets].map(target => [targetKey(target), target])).values()] : targets;
    drawTargets();
    Object.assign(marquee.style, { left: `${area.x}px`, top: `${area.y}px`, width: `${area.width}px`, height: `${area.height}px` });
  }, true);
  viewport.addEventListener('pointerup', event => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const ended = gesture; gesture = null; marquee.hidden = true;
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    const context = getContext();
    if (ended.key !== contextKey(context)) return;
    const point = worldPoint(screenPoint(event));
    try {
      if (ended.moved) {
        const area = rectangle(ended.worldStart, point);
        draftTargets(annotationTargetsInRect(context, area), point, area, ended.additive);
      } else {
        const target = annotationHitTarget(context, point, ended.imageId);
        if (!target) { blankClick(); return; }
        let targets = [target];
        if (!ended.additive && !context.detail && context.selected?.size > 1 && context.selected.has(ended.imageId)) {
          targets = context.boards.filter(board => context.selected.has(board.id)).map(board => annotationTarget(context, { x: board.x + board.width / 2, y: board.y + board.height / 2 }, board.id));
        }
        draftTargets(targets, point, null, ended.additive);
      }
    } catch (error) { toast(error.message); }
  }, true);
  const cancelGesture = () => {
    if (gesture && viewport.hasPointerCapture(gesture.pointerId)) viewport.releasePointerCapture(gesture.pointerId);
    gesture = null; marquee.hidden = true;
    if (editor) editor.hidden = editorHidden();
  };
  viewport.addEventListener('pointercancel', cancelGesture);
  viewport.addEventListener('lostpointercapture', cancelGesture);
  viewport.addEventListener('pointerleave', () => { if (!gesture) { hovered = null; drawTargets(); } });
  document.addEventListener('pointerdown', event => {
    if (editor && !event.target.closest('.annotation-editor,.annotation-pin,.annotation-list,.annotation-tools')
      && (!viewport.contains(event.target) || getContext().mode !== 'annotate' || event.target.closest('.toolbar'))) {
      if (editing?.temporary) { confirmEditor(); } else { closeEditor(); render(); }
    }
  }, true);
  document.addEventListener('keydown', event => {
    if (['Shift', 'Control', 'Meta'].includes(event.key) && getContext().mode === 'annotate') {
      multiSelecting = true; if (editor) editor.hidden = editorHidden();
      listOpen = false; list.hidden = true;
    }
    if (event.key === 'Escape' && (editor || listOpen || gesture)) {
      event.preventDefault(); event.stopImmediatePropagation(); multiSelecting = false; hovered = null; cancelGesture(); closeEditor(); listOpen = false; render();
    }
  });
  document.addEventListener('keyup', event => {
    if (!['Shift', 'Control', 'Meta'].includes(event.key)) return;
    multiSelecting = Boolean(event.shiftKey || event.ctrlKey || event.metaKey);
    if (editor) { editor.hidden = editorHidden(); if (!editor.hidden) editor.querySelector('textarea').focus(); }
  });
  return { render,
    canAddForSelection: () => !store().busy && annotationSelectedTargets(getContext()).length > 0,
    addForSelection() {
      if (store().busy) return;
      const targets = annotationSelectedTargets(getContext()); if (!targets.length) return;
      cancelGesture(); multiSelecting = false; listOpen = false;
      draftTargets(targets, null, null, false);
      if (editing) editing.temporary = true;
    }
  };
}
