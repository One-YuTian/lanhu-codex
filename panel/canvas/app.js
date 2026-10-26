import { unwrap, resource, parseRoute, routeHash, layoutImages, boundsOf, designLayers, designSize, buildGroups, sortByRecent, groupImages, layerIcon, hitTestLayer, layerCss, officialProjectUrl } from './model.js';
import { icon, iconHref, renderIcons } from './icons.js';
import { inspectorMarkup, layerSlice } from './inspector.js';
import { formatColor } from './layer-style.js';
import { createButton, installComponents, promptNumber } from './ui/components.js';
import { canvasFetch, assignImage, hydrateImages, openExternal, currentUrl, updateUrl, rememberProject, recallGroup, rememberGroup, setLoginCookie } from './transport.js';
import { mountAnnotations } from './annotation-ui.js';
import { renderLoginState } from './login-state.js';
import { mountProjectManager } from './project-manager.js';
import { mountProjectPicker } from './project-picker.js';
import { promptCookie } from './login-cookie.js';
import { firstProjectGroup } from './lanhu-links.js';
import { installInterfaceEvents } from './interface-events.js';
import { installClipboardProjects } from './clipboard-project.js';

const $ = selector => document.querySelector(selector);
const state = { route: parseRoute(currentUrl()), images: [], sectors: [], groups: buildGroups([], []), expanded: new Set(), searchCollapsed: new Set(), collapsedLayers: new Set(), selected: new Set(), filter: '', search: '', zoom: 1, pan: { x: 80, y: 80 }, mode: 'select', space: false, detail: null, layers: [], layer: null, slices: [], sliceStatus: 'loading', exportScales: new Set([1]), format: 'png', colorFormat: 'hex', nav: 'project', generation: 0 };
installComponents();
renderIcons();
const panels = { leftCollapsed: false, rightCollapsed: false };
let loginRequired = false;
let loginFlow;
document.documentElement.classList.add('auth-checking');
for (const [side, iconName] of [['left', 'panel-left-open'], ['right', 'panel-right-open']]) {
  const button = createButton({ className: `panel-handle ${side}` }); button.id = `expand-${side}`;
  button.title = button.ariaLabel = side === 'left' ? '展开左侧面板' : '展开右侧面板'; button.innerHTML = icon(iconName); button.hidden = true;
  document.querySelector('#viewport').append(button);
}
clearVersionParams(state.route);
let drag, toastTimer, detailGeneration = 0, controller;
let navigationSnapshot;
const viewport = $('#viewport'), world = $('#world');
const annotations = mountAnnotations({ viewport, setMode, toast, clearSelection: () => { state.selected.clear(); if (state.layer) deselectLayer(); updateSelection(); }, getContext: () => ({ ...state,
  boards: loginRequired ? [] : state.detail ? [state.detail] : state.route.image_id ? [] : visibleImages() }),
  reveal: async item => {
    state.filter = item.group_id;
    void rememberGroup(state.route, state.filter).catch(() => {});
    const route = { ...state.route, image_id: item.scope === 'detail' ? item.image_id : '' };
    const url = new URL(currentUrl()); url.hash = routeHash(route); updateUrl(url);
    await onRoute();
  } });
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const manager = mountProjectManager({ root: $('#project-manager'), api, openProject: navigate, openDialog });
const projectPicker = mountProjectPicker({ dialog: $('#project-picker'), root: $('#project-picker-content'), api, getRoute: () => state.route, openProject: navigate, openDialog });
const number = value => Math.round(Number(value || 0) * 100) / 100;
function updatePanels() {
  const hasProject = !loginRequired && !!state.route.project_id;
  $('#sidebar').hidden = !hasProject || panels.leftCollapsed;
  $('#expand-left').hidden = !hasProject || !panels.leftCollapsed;
  const selected = !loginRequired && !!state.detail && !!state.layer;
  $('#inspector').hidden = !selected || panels.rightCollapsed;
  $('#expand-right').hidden = !selected || !panels.rightCollapsed;
}
function showLogin() {
  const alreadyShown = loginRequired;
  loginRequired = true;
  controller?.abort(); state.generation++; detailGeneration++;
  document.documentElement.classList.remove('auth-checking');
  document.documentElement.classList.add('login-required');
  $('#link-dialog').close(); $('#context-menu').hidden = true;
  projectPicker.close();
  updatePanels();
  if (!alreadyShown) loginFlow = renderLoginState(document, toast, async () => {
    const saved = await promptCookie(setLoginCookie);
    if (saved) completeLogin();
  });
}
function completeLogin() {
  if (loginFlow) loginFlow.manual = false;
  loginRequired = false;
  document.documentElement.classList.remove('auth-checking', 'login-required');
  $('#state').replaceChildren();
  projectPicker.close();
  // Always enter project management after authentication, even for an old route.
  navigate({});
  void loadProfile();
}
async function checkCanvasLogin() {
  const response = await canvasFetch('/api/status');
  if (!response.ok) throw new Error('登录状态读取失败，请稍后重试');
  const status = await response.json();
  if (loginFlow?.manual) return false;
  if (status.mode !== 'mcp') { document.documentElement.classList.remove('auth-checking'); return true; }
  if (!status.loggedIn) { showLogin(); return false; }
  if (loginRequired) { completeLogin(); return false; }
  loginRequired = false;
  document.documentElement.classList.remove('auth-checking', 'login-required');
  updatePanels();
  return true;
}
async function loadProfile() {
  const avatar = $('#user-avatar');
  if (!avatar) return;
  try {
    const response = await canvasFetch(`/api/profile?${new URLSearchParams({ team_id: state.route.team_id })}`);
    if (!response.ok) throw new Error('用户信息读取失败');
    const profile = await response.json();
    const name = profile.name || '蓝湖用户';
    avatar.textContent = Array.from(name)[0].toUpperCase(); avatar.title = name; avatar.setAttribute('aria-label', name);
    if (profile.color && CSS.supports('color', profile.color)) avatar.style.backgroundColor = profile.color;
    if (profile.avatar) {
      const picture = new Image(); picture.alt = name;
      picture.onload = () => avatar.replaceChildren(picture);
      void assignImage(picture, resource(profile.avatar));
    }
  } catch { avatar.title = '用户信息读取失败'; }
}
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 3500); }
function setProjectTitle(title) {
  const label = $('#project-name');
  if (label) label.textContent = title;
  document.title = document.documentElement.classList.contains('native-panel') ? title : `${title} - 蓝湖`;
}
function message(title, description, action) { $('#state').innerHTML = `<div class="empty-icon">${icon('images')}</div><h2>${escape(title)}</h2><p>${escape(description)}</p>${action ? '<button id="state-action">打开项目</button>' : ''}`; $('#state-action')?.addEventListener('click', openDialog); }
async function api(endpoint, extra = {}, signal = controller?.signal) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ project_id: state.route.project_id, team_id: state.route.team_id, ...extra })) if (value !== '' && value != null) query.set(key, value);
  try {
    const response = await canvasFetch(`/api/${endpoint}?${query}`, { signal });
    const result = await response.json();
    if (!response.ok || result.error) throw Object.assign(new Error(result.error || '请求失败'), { code: result.code });
    return result;
  } catch (error) {
    if (['LOGIN_REQUIRED', 'LOGIN_REJECTED', 'COOKIE_SCOPE_MISMATCH'].includes(error.code)) showLogin();
    throw error;
  }
}
const matchesSearch = image => !state.search || image.name?.toLowerCase().includes(state.search.toLowerCase()) || state.groups.byImage.get(image.id)?.some(group => group.name?.toLowerCase().includes(state.search.toLowerCase()));
const visibleImages = () => groupImages(state.groups, state.filter).filter(matchesSearch);
function clearVersionParams(route) {
  if (!/[?&](versionId|version_id)=/.test(currentUrl())) return;
  const url = new URL(currentUrl()); url.searchParams.delete('versionId'); url.searchParams.delete('version_id'); url.hash = routeHash(route); updateUrl(url, true);
}
function navigate(route, replace = false) {
  const url = new URL(currentUrl()); url.search = ''; url.hash = routeHash(route);
  updateUrl(url, replace);
  void onRoute();
}
async function onRoute(force = false) {
  const next = parseRoute(currentUrl()), previous = state.route;
  const managing = !next.project_id;
  document.documentElement.classList.toggle('manager-open', managing);
  $('#project-manager').hidden = !managing;
  if (managing) {
    controller?.abort(); controller = new AbortController(); state.generation++; detailGeneration++;
    state.route = next; state.detail = null; state.layer = null; state.images = []; state.selected.clear();
    world.replaceChildren(); updatePanels(); annotations.render(); setProjectTitle('项目管理');
    try { if (await checkCanvasLogin()) await manager.show(previous.team_id); }
    catch (error) { toast(error.message); }
    return;
  }
  manager.cancel();
  const projectChanged = next.project_id !== previous.project_id || next.team_id !== previous.team_id;
  state.route = next;
  annotations.render();
  clearVersionParams(next);
  if (projectChanged) { state.filter = ''; state.expanded.clear(); state.search = ''; $('#search').value = ''; void loadProfile(); }
  if (projectChanged || force || !state.images.length) return loadProject();
  void rememberProject(next).catch(() => toast('无法保存最近打开的项目'));
  if (next.image_id) return loadDetail();
  detailGeneration++; state.detail = null; state.layers = []; state.layer = null;
  $('#inspector').hidden = true; $('#layer-tab').hidden = true; state.nav = 'project';
  renderNavigation(); renderBoards(); fit();
}
async function loadProject() {
  try { if (!await checkCanvasLogin()) return; }
  catch (error) {
    if (!loginRequired) message('暂时无法检查登录状态', error.message, true);
    return;
  }
  controller?.abort(); controller = new AbortController(); const generation = ++state.generation; detailGeneration++;
  state.images = []; state.sectors = []; state.groups = buildGroups([], []); state.selected.clear(); state.detail = null; state.layers = []; state.slices = []; state.sliceStatus = 'loading';
  world.replaceChildren(); $('#inspector').hidden = true; $('#layer-tab').hidden = true; state.nav = 'project'; renderNavigation();
  annotations.render();
  if (!state.route.project_id) { setProjectTitle('蓝湖'); message('打开你的蓝湖项目', '输入蓝湖项目链接，开始浏览设计图、分组与设计标注。', true); return; }
  message('正在加载项目', '正在读取项目详情、设计图与分组…');
  try {
    const results = await Promise.allSettled([api('project'), api('images'), api('sectors')]);
    if (generation !== state.generation) return;
    if (results[1].status === 'rejected') throw results[1].reason;
    const imageData = unwrap(results[1].value), project = results[0].status === 'fulfilled' ? unwrap(results[0].value) : {};
    state.images = layoutImages(sortByRecent(imageData.images || project.images || []));
    state.sectors = results[2].status === 'fulfilled' ? unwrap(results[2].value).sectors || [] : [];
    state.groups = buildGroups(state.sectors, state.images);
    const preferredGroup = state.filter || await recallGroup(state.route);
    if (generation !== state.generation) return;
    state.filter = firstProjectGroup(state.groups, preferredGroup);
    let selectedGroup = state.groups.byId.get(state.filter); const expandedGroups = new Set();
    while (selectedGroup && !expandedGroups.has(selectedGroup.id)) { expandedGroups.add(selectedGroup.id); state.expanded.add(selectedGroup.id); selectedGroup = state.groups.byId.get(selectedGroup.parent_id); }
    void rememberGroup(state.route, state.filter).catch(() => {});
    setProjectTitle(project.name || project.project?.name || imageData.name || '蓝湖项目');
    void rememberProject(state.route).catch(() => toast('无法保存最近打开的项目'));
    $('#state').innerHTML = ''; renderNavigation();
    if (results[0].status === 'rejected' || results[2].status === 'rejected') toast('部分项目资料或分组加载失败，设计图仍可浏览');
    if (state.route.image_id) await loadDetail(); else { renderBoards(); fit(); }
  } catch (error) { if (error.name !== 'AbortError') {
    let description = error.message;
    try {
      const response = await canvasFetch('/api/status'); const status = await response.json();
      if (generation !== state.generation) return;
      if (status.mode === 'mcp' && !status.loggedIn) { showLogin(); return; }
    } catch {}
    if (generation === state.generation) message('暂时无法加载项目', description, true);
  } }
}
function renderNavigation() {
  updatePanels();
  const snapshot = [state.detail, state.nav, state.images, state.groups, state.layers, state.search,
    JSON.stringify([...state.expanded]), JSON.stringify([...state.searchCollapsed]), JSON.stringify([...state.collapsedLayers])];
  if (navigationSnapshot?.every((value, index) => value === snapshot[index])) { updateNavigationSelection(); return; }
  navigationSnapshot = snapshot;
  const navigation = $('#navigation'), scrollTop = navigation.scrollTop; navigation.replaceChildren();
  $('#nav-tab').classList.toggle('active', state.nav === 'project');
  $('#nav-tab').textContent = state.detail ? '项目分组' : '项目目录';
  $('#layer-tab').classList.toggle('active', state.nav === 'layers');
  const searchLabel = state.detail && state.nav === 'layers' ? '搜索图层' : '搜索设计图或分组';
  $('#search').placeholder = searchLabel; $('#search').setAttribute('aria-label', searchLabel);
  const entry = (label, iconName, callback, active, count, depth = 0) => {
    const button = createButton({ className: `nav-item${active ? ' active' : ''}` }); button.style.paddingLeft = `${10 + depth * 14}px`;
    button.innerHTML = `${icon(iconName, 'nav-icon')}<span class="nav-label">${escape(label)}</span>${count != null ? `<small>${count}</small>` : ''}`;
    button.title = label; button.addEventListener('click', callback); navigation.append(button);
    return button;
  };
  if (state.detail && state.nav === 'layers') {
    if (!state.layers.length) navigation.innerHTML = '<p class="muted" style="padding:12px">当前版本没有可读取的图层数据</p>';
    const byId = new Map(state.layers.map(layer => [layer.id, layer]));
    const parents = new Set(state.layers.map(layer => layer.parentId));
    const shown = new Set();
    for (const layer of state.layers) {
      if (state.search && !layer.name.toLowerCase().includes(state.search.toLowerCase())) continue;
      let current = layer;
      while (current && !shown.has(current.id)) { shown.add(current.id); current = byId.get(current.parentId); }
    }
    for (const layer of state.layers) {
      if (!shown.has(layer.id)) continue;
      let parent = byId.get(layer.parentId), hidden = false;
      while (parent) { if (!state.search && state.collapsedLayers.has(parent.id)) { hidden = true; break; } parent = byId.get(parent.parentId); }
      if (hidden) continue;
      const row = document.createElement('div'); row.className = 'layer-row'; row.style.paddingLeft = `${Math.max(0, layer.depth - 1) * 14}px`;
      const children = parents.has(layer.id);
      const toggle = createButton({ className: 'layer-toggle', iconName: state.collapsedLayers.has(layer.id) ? 'chevron-right' : 'chevron-down', title: `${state.collapsedLayers.has(layer.id) ? '展开' : '收起'}${layer.name}` });
      if (children) { toggle.setAttribute('aria-expanded', String(!state.collapsedLayers.has(layer.id))); toggle.onclick = () => { if (state.collapsedLayers.has(layer.id)) state.collapsedLayers.delete(layer.id); else state.collapsedLayers.add(layer.id); renderNavigation(); }; }
      else { toggle.disabled = true; toggle.classList.add('layer-toggle-empty'); }
      const button = createButton({ className: `nav-item${state.layer?.id === layer.id ? ' active' : ''}`, title: layer.name, onClick: () => selectLayer(layer.id) });
      button.dataset.layerId = layer.id;
      button.innerHTML = `${icon(layerIcon(layer, state.slices), 'nav-icon')}<span class="nav-label">${escape(layer.name)}</span>`;
      row.append(toggle, button); navigation.append(row);
    }
    if (state.search && !shown.size) navigation.innerHTML = '<p class="group-empty">没有匹配的图层</p>';
    navigation.scrollTop = scrollTop;
    return;
  }
  const imageEntry = (image, depth, groupId) => {
    const button = entry(image.name, 'image', () => { if (state.detail) openImage(image.id); else { state.filter = groupId; focusImage(image); } }, state.detail?.id === image.id || state.selected.has(image.id), null, depth);
    button.dataset.imageId = image.id;
  };
  const group = (sector, depth) => {
    const images = sortByRecent([...sector.directIds].map(id => state.groups.imageById.get(id)).filter(matchesSearch));
    if (state.search && ![...sector.imageIds].some(id => matchesSearch(state.groups.imageById.get(id))) && !sector.name?.toLowerCase().includes(state.search.toLowerCase())) return;
    const expanded = state.search ? !state.searchCollapsed.has(sector.id) : state.expanded.has(sector.id);
    const row = document.createElement('div'); row.className = `group-row${!state.detail && state.filter === sector.id ? ' active' : ''}`; row.style.paddingLeft = `${depth * 14 + 4}px`;
    row.dataset.groupId = sector.id;
    const toggle = createButton({ className: 'group-toggle', iconName: expanded ? 'chevron-down' : 'chevron-right' }); toggle.setAttribute('aria-label', `${expanded ? '收起' : '展开'}${sector.name}`); toggle.setAttribute('aria-expanded', String(expanded));
    toggle.disabled = !sector.imageIds.size && !sector.children.length;
    toggle.onclick = () => { if (state.search) { if (expanded) state.searchCollapsed.add(sector.id); else state.searchCollapsed.delete(sector.id); } else { if (expanded) state.expanded.delete(sector.id); else state.expanded.add(sector.id); } renderNavigation(); };
    const label = createButton({ className: 'group-label', title: sector.name });
    label.innerHTML = `${icon(expanded ? 'folder-open' : 'folder')}<span>${escape(sector.name)}</span><small>${sector.imageIds.size}</small>`;
    label.onclick = () => { state.expanded.add(sector.id); state.searchCollapsed.delete(sector.id); filter(sector.id); };
    row.append(toggle, label); navigation.append(row);
    if (expanded) {
      sector.children.forEach(child => group(child, depth + 1));
      images.forEach(image => imageEntry(image, depth + 2, sector.id));
      if (!sector.imageIds.size && !sector.children.length) { const empty = document.createElement('p'); empty.className = 'group-empty'; empty.textContent = '暂无设计图'; navigation.append(empty); }
    }
  };
  state.groups.roots.forEach(sector => group(sector, 0));
  group({ id: 'ungrouped', name: '未分组', directIds: new Set(state.groups.ungrouped.map(image => image.id)), imageIds: new Set(state.groups.ungrouped.map(image => image.id)), children: [] }, 0);
  if (state.search && !navigation.querySelector('.group-row')) { const empty = document.createElement('p'); empty.className = 'group-empty'; empty.textContent = '没有匹配的分组或设计图'; navigation.append(empty); }
  navigation.scrollTop = scrollTop;
}
function updateNavigationSelection() {
  $('#navigation').querySelectorAll('[data-layer-id]').forEach(button => button.classList.toggle('active', button.dataset.layerId === state.layer?.id));
  $('#navigation').querySelectorAll('[data-image-id]').forEach(button => button.classList.toggle('active', state.detail ? button.dataset.imageId === state.detail.id : state.selected.has(button.dataset.imageId)));
  $('#navigation').querySelectorAll('[data-group-id]').forEach(row => row.classList.toggle('active', !state.detail && row.dataset.groupId === state.filter));
}
function updateLayerIcons() {
  const byId = new Map(state.layers.map(layer => [layer.id, layer]));
  $('#navigation').querySelectorAll('[data-layer-id]').forEach(button => {
    const layer = byId.get(button.dataset.layerId), use = button.querySelector('.nav-icon use');
    if (layer && use) use.setAttribute('href', iconHref(layerIcon(layer, state.slices)));
  });
}
function filter(value) {
  if (value !== 'ungrouped' && !state.groups.byId.has(value)) return;
  state.filter = value; state.selected.clear();
  void rememberGroup(state.route, value).catch(() => {});
  if (state.route.image_id) navigate({ ...state.route, image_id: '', version_id: '', page_id: '' });
  else { renderNavigation(); renderBoards(); fit(); }
}
function createBoard(image, detail = false) {
  const board = document.createElement('div'); board.className = `board image-loading${detail ? ' detail' : ''}${state.selected.has(image.id) && !detail ? ' selected' : ''}`; board.dataset.id = image.id;
  Object.assign(board.style, { left: `${detail ? 0 : image.x}px`, top: `${detail ? 0 : image.y}px`, width: `${image.width}px`, height: `${image.height}px` });
  board.innerHTML = `<div class="board-title"><span>${escape(image.name)}</span><small>${number(image.assetWidth || image.width)} × ${number(image.assetHeight || image.height)}</small></div>`;
  const picture = new Image(); picture.alt = image.name || '设计图'; picture.draggable = false; picture.loading = 'lazy';
  picture.addEventListener('load', () => {
    board.classList.remove('image-loading');
    if (detail) return;
    image.assetWidth = picture.naturalWidth; image.assetHeight = picture.naturalHeight;
    board.querySelector('.board-title small').textContent = `${picture.naturalWidth} × ${picture.naturalHeight}`;
  });
  picture.addEventListener('error', () => { board.classList.remove('image-loading'); const error = document.createElement('div'); error.className = 'image-error'; error.textContent = '图片加载失败，请重新加载'; picture.replaceWith(error); });
  board.append(picture);
  void assignImage(picture, resource(image.url));
  if (!detail) {
    board.addEventListener('dblclick', () => { if (state.mode !== 'annotate') openImage(image.id); });
  }
  return board;
}
function renderBoards() {
  world.replaceChildren();
  const images = visibleImages(); images.forEach(image => world.append(createBoard(image)));
  if (!state.filter) message('选择项目分组', '请在左侧选择分组后浏览对应设计图。');
  else if (!images.length) message('当前分组没有设计图', '请选择子分组、其他分组或调整搜索关键词。'); else $('#state').innerHTML = '';
  updateSelection(); transform();
}
function openImage(id) { navigate({ ...state.route, image_id: id, version_id: '', page_id: '' }); }
function focusImage(image) { void rememberGroup(state.route, state.filter).catch(() => {}); state.selected = new Set([image.id]); renderBoards(); renderNavigation(); fit([image]); }
async function loadDetail() {
  const generation = ++detailGeneration;
  state.detail = null; state.layer = null; state.layers = []; state.collapsedLayers.clear(); state.slices = []; state.sliceStatus = 'loading'; state.exportScales = new Set([1]);
  world.replaceChildren(); $('#properties').textContent = '';
  $('#inspector').hidden = true; $('#layer-tab').hidden = false; $('#selection-info').hidden = true;
  message('正在加载设计稿', '读取最新设计稿与标注数据…');
  try {
    const data = unwrap(await api('design', { image_id: state.route.image_id }));
    if (generation !== detailGeneration) return;
    const image = state.images.find(item => item.id === state.route.image_id) || data.image || data;
    if (!state.filter) state.filter = state.groups.byImage.get(state.route.image_id)?.find(group => group.directIds.has(state.route.image_id))?.id || 'ungrouped';
    const version = data.versions?.[0];
    state.detail = { ...image, ...data.image, id: state.route.image_id, name: image.name || data.name || '设计稿', width: Number(version?.width || image.width || data.width) || 375, height: Number(version?.height || image.height || data.height) || 667, url: version?.url || version?.image_url || image.url || data.url };
    state.detail.x = 0; state.detail.y = 0;
    $('#state').innerHTML = ''; world.append(createBoard(state.detail, true)); renderNavigation(); renderProperties(); fit();
    try {
      let payload;
      if (version?.json_url) { const response = await canvasFetch(resource(version.json_url), { signal: controller.signal }); if (!response.ok) throw new Error('图层数据加载失败'); payload = await response.json(); }
      else if (version?.id) payload = await api('schema', { version_id: version.id });
      if (generation !== detailGeneration) return;
      Object.assign(state.detail, designSize(payload, state.detail));
      image.assetWidth = state.detail.width; image.assetHeight = state.detail.height;
      world.replaceChildren(createBoard(state.detail, true));
      state.layers = designLayers(payload, state.detail);
      renderLayers(); renderNavigation(); renderProperties(); fit(); void loadSlices(generation);
    } catch (error) { if (generation === detailGeneration && error.name !== 'AbortError') { toast(`图层标注不可用：${error.message}`); renderProperties(); } }
  } catch (error) { if (generation === detailGeneration && error.name !== 'AbortError') message('设计稿加载失败', error.message); }
}
function renderLayers() {
  const board = world.querySelector('.board'); if (!board) return;
  board.querySelectorAll('.layer-box').forEach(element => element.remove());
  state.layers.filter(layer => !layer.isArtboard && layer.visible !== false).sort((left, right) => right.width * right.height - left.width * left.height).forEach(layer => {
    const box = document.createElement('div'); box.className = `layer-box${state.layer?.id === layer.id ? ' selected' : ''}`; box.dataset.layer = layer.id;
    box.dataset.size = `${number(layer.width)} × ${number(layer.height)}`; box.title = layer.name;
    Object.assign(box.style, { left: `${layer.x}px`, top: `${layer.y}px`, width: `${layer.width}px`, height: `${layer.height}px` });
    box.addEventListener('pointerdown', event => {
      if (state.mode !== 'hand' && !state.space && event.button === 0) {
        event.stopPropagation();
        const position = point(event);
        const selected = hitTestLayer(state.layers, { x: (position.x - state.pan.x) / state.zoom, y: (position.y - state.pan.y) / state.zoom });
        if (selected) selectLayer(selected.id);
      }
    });
    board.append(box);
  });
}
function selectLayer(id) {
  state.layer = state.layers.find(layer => layer.id === id) || state.layers.find(layer => layer.sourceIds?.includes(id));
  const byId = new Map(state.layers.map(layer => [layer.id, layer]));
  let parent = byId.get(state.layer?.parentId);
  while (parent) { state.collapsedLayers.delete(parent.id); parent = byId.get(parent.parentId); }
  panels.rightCollapsed = false; state.exportScales = new Set([1]); updateLayerSelection(); renderNavigation(); renderProperties();
}
function updateLayerSelection() { world.querySelectorAll('.layer-box').forEach(box => box.classList.toggle('selected', box.dataset.layer === state.layer?.id)); }
function deselectLayer() { state.layer = null; updateLayerSelection(); updateNavigationSelection(); renderProperties(); }
function renderProperties() {
  updatePanels();
  if (!state.detail || !state.layer) { $('#properties').replaceChildren(); return; }
  const item = state.layer || state.detail, slice = layerSlice(state.layer, state.slices, state.layers);
  $('#properties').innerHTML = inspectorMarkup(item, slice, { scales: state.exportScales, format: state.format, colorFormat: state.colorFormat, sliceStatus: state.sliceStatus, selected: !!state.layer });
  document.querySelectorAll('.style-value').forEach(input => {
    input.onclick = () => copy(input.dataset.copyValue);
    input.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void copy(input.dataset.copyValue); } };
  });
  const copyCode = $('#copy-layer-code');
  if (copyCode) copyCode.onclick = () => copy(layerCss(item, { colorFormat: state.colorFormat }));
  document.querySelectorAll('.color-field lh-select').forEach(selector => selector.onchange = () => {
    state.colorFormat = selector.value;
    document.querySelectorAll('.color-field').forEach(container => {
      const value = formatColor(container.dataset.color, state.colorFormat), field = container.querySelector('.style-value');
      field.textContent = value; field.dataset.copyValue = value; field.setAttribute('aria-description', value);
      container.querySelector('lh-select').value = state.colorFormat;
    });
    const code = $('#properties .layer-code code');
    if (code) code.textContent = layerCss(item, { colorFormat: state.colorFormat });
  });
  if (!slice) return;
  const picture = $('#properties .slice-preview img');
  picture.addEventListener('error', () => { const error = document.createElement('p'); error.className = 'error'; error.textContent = '切图加载失败，请重新加载后重试'; picture.replaceWith(error); });
  hydrateImages($('#properties'));
  document.querySelectorAll('[name="slice-scale"]').forEach(input => input.onchange = () => {
    const scale = Number(input.value);
    if (input.checked) state.exportScales.add(scale); else state.exportScales.delete(scale);
    $('#download-slice').disabled = !state.exportScales.size;
  });
  $('#slice-format').onchange = event => { state.format = event.target.value; };
  $('#download-slice').onclick = async () => {
    const button = $('#download-slice'), scales = [...state.exportScales].sort(), format = state.format;
    button.disabled = true; button.textContent = '正在准备切图…';
    try {
      for (const scale of scales) await download(slice.url, `${slice.name || item.name}@${scale}x`, {
        width: Math.max(1, Math.round(slice.logical_size.width) * scale),
        height: Math.max(1, Math.round(slice.logical_size.height) * scale), format
      });
    } finally { if (button.isConnected) { button.disabled = !state.exportScales.size; button.textContent = '下载切图'; } }
  };
}
async function loadSlices(generation) {
  try {
    const slices = [], visited = new Set(); let offset = 0;
    do {
      if (visited.has(offset)) throw new Error('切图分页返回了重复位置');
      visited.add(offset);
      const response = await api('slices', { image_id: state.route.image_id, offset });
      if (generation !== detailGeneration) return;
      slices.push(...(response.slices || unwrap(response).slices || [])); offset = response.next_offset ?? null;
    } while (offset !== null);
    state.slices = slices; state.sliceStatus = 'ready';
  } catch (error) { if (generation !== detailGeneration || error.name === 'AbortError') return; state.sliceStatus = 'error'; }
  if (generation === detailGeneration) { updateLayerIcons(); renderProperties(); }
}
async function download(url, name, dimensions = {}) {
  try { const response = await canvasFetch(resource(url, dimensions)); if (!response.ok) { const failure = await response.json().catch(() => ({})); throw new Error(failure.error || '资源下载失败'); } const objectUrl = URL.createObjectURL(await response.blob()); const anchor = document.createElement('a'); anchor.href = objectUrl; anchor.download = `${name || 'design'}.${dimensions.format || 'png'}`; anchor.click(); setTimeout(() => URL.revokeObjectURL(objectUrl), 10000); } catch (error) { toast(error.message); }
}
async function copy(value) { try { await navigator.clipboard.writeText(value); toast('已复制到剪贴板'); } catch { toast('浏览器不允许写入剪贴板，请手动复制地址'); } }
function transform() {
  world.style.transform = `translate(${state.pan.x}px,${state.pan.y}px) scale(${state.zoom})`;
  world.style.setProperty('--annotation-scale', String(1 / state.zoom));
  world.style.setProperty('--canvas-zoom', String(state.zoom));
  $('#zoom-label').textContent = `${Math.round(state.zoom * 100)}%`; viewport.classList.toggle('hand', state.mode === 'hand' || state.space);
  viewport.classList.toggle('annotating', state.mode === 'annotate' && !state.space); annotations.render();
}
function zoomTo(zoom, point = { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 }) {
  const next = Math.max(.02, Math.min(8, zoom)); const ratio = next / state.zoom;
  state.pan = { x: point.x - (point.x - state.pan.x) * ratio, y: point.y - (point.y - state.pan.y) * ratio }; state.zoom = next; transform();
}
function fit(images) {
  const items = images || (state.detail ? [{ ...state.detail, x: 0, y: 0 }] : visibleImages());
  const left = $('#sidebar').hidden ? 0 : $('#sidebar').getBoundingClientRect().width;
  const right = $('#inspector').hidden ? 0 : $('#inspector').getBoundingClientRect().width;
  const availableWidth = Math.max(200, viewport.clientWidth - left - right);
  const bounds = boundsOf(items); state.zoom = Math.max(.02, Math.min(1.5, (availableWidth - 150) / bounds.width, (viewport.clientHeight - 170) / bounds.height));
  state.pan = { x: left + (availableWidth - bounds.width * state.zoom) / 2 - bounds.x * state.zoom, y: (viewport.clientHeight - bounds.height * state.zoom) / 2 - bounds.y * state.zoom }; transform();
}
function updateSelection() {
  updateNavigationSelection();
  world.querySelectorAll('.board').forEach(board => board.classList.toggle('selected', !state.detail && state.selected.has(board.dataset.id)));
  $('#selection-info').hidden = !state.selected.size || !!state.detail; $('#selection-info').textContent = `已选择 ${state.selected.size} 张设计图 · 双击进入详情`;
}
function point(event) { const rect = viewport.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
viewport.addEventListener('wheel', event => {
  if (loginRequired || !state.route.project_id) return;
  if (event.target.closest('.annotation-editor,.annotation-list')) return;
  event.preventDefault();
  if (event.shiftKey && !event.ctrlKey) { state.pan.x -= event.deltaY; state.pan.y -= event.deltaX; transform(); }
  else zoomTo(state.zoom * Math.exp(-event.deltaY * .0015), point(event));
}, { passive: false });
viewport.addEventListener('pointerdown', event => {
  if (loginRequired) return;
  if (event.button === 2 || event.target.closest('button,.toolbar,.annotation-editor,.annotation-list')) return;
  const start = point(event), board = event.target.closest('.board');
  (board || viewport).setPointerCapture(event.pointerId);
  if (state.mode === 'hand' || state.space || event.button === 1 || state.detail) { drag = { type: 'pan', start, pan: { ...state.pan }, deselect: !!state.detail && !board && state.mode !== 'hand' && !state.space && event.button === 0 }; viewport.classList.add('panning'); return; }
  if (board) {
    const id = board.dataset.id;
    if (event.shiftKey || event.ctrlKey || event.metaKey) { if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id); }
    else if (!state.selected.has(id)) state.selected = new Set([id]);
    drag = { type: 'move', start, positions: state.images.filter(image => state.selected.has(image.id)).map(image => ({ id: image.id, x: image.x, y: image.y })) };
  } else {
    if (!event.shiftKey) state.selected.clear(); drag = { type: 'marquee', start, previous: new Set(state.selected) }; $('#marquee').hidden = false;
  }
  updateSelection(); renderNavigation();
});
viewport.addEventListener('pointermove', event => {
  if (!drag) return;
  const current = point(event), dx = current.x - drag.start.x, dy = current.y - drag.start.y;
  if (drag.type === 'pan') { if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true; state.pan = { x: drag.pan.x + dx, y: drag.pan.y + dy }; transform(); }
  if (drag.type === 'move' && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
    drag.moved = true;
    drag.positions.forEach(position => { const image = state.images.find(item => item.id === position.id); image.x = position.x + dx / state.zoom; image.y = position.y + dy / state.zoom; const element = [...world.children].find(board => board.dataset.id === image.id); if (element) { element.style.left = `${image.x}px`; element.style.top = `${image.y}px`; } });
  }
  if (drag.type === 'marquee') {
    const left = Math.min(current.x, drag.start.x), top = Math.min(current.y, drag.start.y), right = Math.max(current.x, drag.start.x), bottom = Math.max(current.y, drag.start.y);
    Object.assign($('#marquee').style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
    state.selected = new Set(drag.previous); visibleImages().forEach(image => { if (image.x * state.zoom + state.pan.x < right && (image.x + image.width) * state.zoom + state.pan.x > left && image.y * state.zoom + state.pan.y < bottom && (image.y + image.height) * state.zoom + state.pan.y > top) state.selected.add(image.id); }); updateSelection();
  }
});
function endDrag() {
  if (!drag) return;
  if (drag?.deselect && !drag.moved) deselectLayer();
  if (drag?.type === 'move' && drag.moved) toast('画板位置已在本地调整');
  drag = undefined; $('#marquee').hidden = true; viewport.classList.remove('panning'); renderNavigation();
}
viewport.addEventListener('pointerup', endDrag); viewport.addEventListener('pointercancel', endDrag);
viewport.addEventListener('contextmenu', event => {
  if (loginRequired) { event.preventDefault(); return; }
  if (event.target.closest('.annotation-editor,.annotation-list')) return;
  event.preventDefault(); const board = event.target.closest('.board');
  if (board && !state.detail) { if (!state.selected.has(board.dataset.id)) state.selected = new Set([board.dataset.id]); updateSelection(); }
  if (board && state.detail) {
    const position = point(event), layer = hitTestLayer(state.layers, { x: (position.x - state.pan.x) / state.zoom, y: (position.y - state.pan.y) / state.zoom });
    if (layer) selectLayer(layer.id);
  }
  const menu = $('#context-menu'); menu.replaceChildren();
  const item = (label, action) => menu.append(createButton({ label, onClick: action }));
  if (annotations.canAddForSelection()) item('添加标注', () => { menu.hidden = true; annotations.addForSelection(); });
  if (board && !state.detail) item('查看设计稿标注', () => openImage(board.dataset.id));
  item('适应当前画布', () => fit()); item('实际尺寸 100%', () => zoomTo(1));
  if (!state.detail) item('全选当前分组', () => { state.selected = new Set(visibleImages().map(image => image.id)); updateSelection(); });
  item('复制当前链接', () => copy(`https://lanhuapp.com/web/${routeHash(state.route)}`)); menu.hidden = false; menu.style.left = `${Math.min(event.clientX, innerWidth - 180)}px`; menu.style.top = `${Math.min(event.clientY, innerHeight - 240)}px`;
});
document.addEventListener('click', event => { if (!event.target.closest('#context-menu')) $('#context-menu').hidden = true; else setTimeout(() => $('#context-menu').hidden = true, 0); });
function openDialog() { $('#link-error').textContent = ''; $('#link-dialog').showModal(); $('#project-url').focus(); }
$('#link-button').onclick = () => projectPicker.open(); $('#project-name')?.addEventListener('click', () => projectPicker.open()); $('#cancel-link').onclick = () => $('#link-dialog').close();
$('#link-form').onsubmit = event => {
  event.preventDefault();
  try { const route = parseRoute($('#project-url').value.trim()); if (!route.project_id) throw new Error('链接中没有找到项目 ID（pid）'); loginRequired = false; document.documentElement.classList.remove('login-required'); state.filter = ''; state.search = ''; $('#search').value = ''; $('#link-dialog').close(); projectPicker.close(); navigate(route); } catch (error) { $('#link-error').textContent = error.message; }
};
$('#refresh').onclick = () => { void loadProfile(); void onRoute(true); };
$('#share').onclick = () => {
  if (!state.route.project_id) { toast('请先打开蓝湖项目'); return; }
  const url = officialProjectUrl(state.route);
  void openExternal(url);
  void copy(url);
};
$('#collapse-left').onclick = () => { panels.leftCollapsed = true; updatePanels(); };
$('#expand-left').onclick = () => { panels.leftCollapsed = false; updatePanels(); };
$('#collapse-right').onclick = () => { panels.rightCollapsed = true; updatePanels(); };
$('#expand-right').onclick = () => { panels.rightCollapsed = false; updatePanels(); };
$('#search').oninput = event => { state.search = event.target.value; state.searchCollapsed.clear(); renderNavigation(); if (!state.detail) { renderBoards(); fit(); } };
function setSearchOpen(open) {
  $('#search-panel').hidden = !open;
  $('#toggle-search').setAttribute('aria-expanded', String(open));
  if (open) $('#search').focus();
  else { $('#search').value = ''; $('#search').dispatchEvent(new Event('input')); }
}
$('#toggle-search').onclick = () => setSearchOpen($('#search-panel').hidden);
$('#search').onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); setSearchOpen(false); $('#toggle-search').focus(); } };
$('#clear-search').onclick = () => { $('#search').value = ''; $('#search').dispatchEvent(new Event('input')); $('#search').focus(); };
function setMode(mode) { state.mode = mode; document.querySelectorAll('[data-mode]').forEach(button => button.classList.toggle('active', button.dataset.mode === mode)); transform(); }
document.querySelectorAll('[data-mode]').forEach(button => button.onclick = () => setMode(button.dataset.mode));
$('#zoom-in').onclick = () => zoomTo(state.zoom * 1.2); $('#zoom-out').onclick = () => zoomTo(state.zoom / 1.2); $('#fit').onclick = () => fit(); $('#actual').onclick = () => zoomTo(1);
$('#zoom-label').onclick = async () => { const value = await promptNumber({ title: '缩放比例（2% - 800%）', value: Math.round(state.zoom * 100), min: 2, max: 800 }); if (value !== null) zoomTo(value / 100); };
$('#help').onclick = () => toast('V 选择 · H 抓手 · 空格拖拽 · 滚轮缩放 · Shift 多选 · Ctrl+A 全选 · Ctrl+0 适应 · Esc 返回');
$('#nav-tab').onclick = () => { state.nav = 'project'; renderNavigation(); }; $('#layer-tab').onclick = () => { state.nav = 'layers'; renderNavigation(); };
installInterfaceEvents(document, window, { enabled: () => !loginRequired && !!state.route.project_id,
  setSpace: pressed => { if (state.space !== pressed) { state.space = pressed; transform(); } }, cancelDrag: () => { if (drag?.type === 'pan') endDrag(); } });
document.addEventListener('keydown', event => {
  if (loginRequired || !state.route.project_id) return;
  if (event.target.closest('input,textarea,select,dialog,button,lh-select,lh-checkbox,.ui-copy-field')) return;
  const modifier = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
  if (modifier && key === 'a') { event.preventDefault(); state.selected = new Set(visibleImages().map(image => image.id)); updateSelection(); }
  if (modifier && key === '0') { event.preventDefault(); fit(); }
  if (modifier && key === '1') { event.preventDefault(); zoomTo(1); }
  if (key === 'v' && !modifier) setMode('select'); if (key === 'h' && !modifier) setMode('hand');
  if (key === 'escape') { if (state.layer) deselectLayer(); else if (state.detail) navigate({ ...state.route, image_id: '', version_id: '', page_id: '' }); else { state.selected.clear(); updateSelection(); } }
});
window.addEventListener('blur', () => { state.space = false; endDrag(); transform(); });
window.addEventListener('popstate', () => onRoute()); window.addEventListener('hashchange', () => onRoute()); new ResizeObserver(() => transform()).observe(viewport);
window.addEventListener('lanhu-navigation', () => onRoute());
async function startCanvas() {
  updatePanels(); annotations.render();
  await onRoute(true); if (!loginRequired) void loadProfile();
}
void startCanvas();
installClipboardProjects({ enabled: () => !loginRequired && !document.documentElement.classList.contains('auth-checking'), open: route => { projectPicker.close(); navigate(route); } });
let checkingLogin = false;
async function refreshLoginState() {
  if (checkingLogin || document.visibilityState === 'hidden') return;
  checkingLogin = true;
  try {
    const wasRequired = loginRequired;
    if (await checkCanvasLogin() && wasRequired) { await onRoute(true); void loadProfile(); }
  } catch { /* A network error must not be treated as an expired identity. */ }
  finally { checkingLogin = false; }
}
setInterval(() => { void refreshLoginState(); }, 5000);
document.addEventListener('visibilitychange', () => { void refreshLoginState(); });
