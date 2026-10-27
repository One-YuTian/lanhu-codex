import { icon } from './icons.js';
import { assignImage, recallTeam, rememberTeam, recallRecentProjects } from './transport.js';
import { resource, unwrap } from './model.js';
import { selectMarkup } from './ui/components.js';
const catalog = new Map();
export function knownProject(route) {
  return catalog.get(`${route.team_id || ''}:${route.project_id}`) || (!route.team_id ? [...catalog.values()].find(project => project.id === route.project_id) : undefined);
}
function rememberCatalog(projects, team) { for (const project of projects) catalog.set(`${team}:${project.id}`, { ...project, team_id: team }); }

export function mountProjectManager({ root, api, openProject, openDialog, selectionMode = false, onSelectionChange = () => {} }) {
  let generation = 0, team = '', folder = '', projects = [], folders = [], expanded = new Set(['']);
  let view = 'overview', recentProjects = [];
  let selectedRoute = null;
  let treeLoading = false, listLoading = false, listError = '';
  const loadedFolders = new Set(), pendingFolders = new Set(), folderErrors = new Map();
  const element = (tag, className, text) => { const node = document.createElement(tag); node.className = className; if (text) node.textContent = text; return node; };
  root.innerHTML = '<aside class="manager-sidebar"><label>团队文件</label><div class="manager-team-field"></div><nav aria-label="项目文件夹"></nav></aside><section class="manager-content"><div class="manager-heading"><h1>团队文件</h1><button class="manager-import primary">通过链接打开</button></div><div class="manager-controls"><input type="search" placeholder="搜索项目" aria-label="搜索项目"><div class="manager-sort"></div></div><section class="manager-project-section" data-section="recent"><h2>最近打开</h2><div class="manager-grid manager-recent-grid"></div><p class="manager-section-empty">暂无最近打开的项目</p></section><section class="manager-project-section" data-section="all"><h2>全部项目</h2><div class="manager-grid manager-all-grid"></div></section><p class="manager-status" role="status"></p></section>';
  const teamField = root.querySelector('.manager-team-field'), nav = root.querySelector('nav'), grid = root.querySelector('.manager-all-grid'), status = root.querySelector('.manager-status');
  const recentSection = root.querySelector('[data-section=recent]'), allSection = root.querySelector('[data-section=all]'), recentGrid = root.querySelector('.manager-recent-grid');
  let select;
  function setTeams(teams = [], preferred = '') {
    const options = teams.map(item => ({ value: item.id, label: item.name }));
    const value = options.some(item => item.value === preferred) ? preferred : options[0]?.value || '';
    teamField.innerHTML = selectMarkup({ id: `${root.id}-team`, label: '选择团队', value, options });
    select = teamField.querySelector('lh-select'); select.onchange = () => { void loadTeam(); };
    select.querySelector('button').disabled = !options.length;
  }
  setTeams();
  const importButton = root.querySelector('.manager-import');
  importButton.onclick = openDialog; importButton.hidden = selectionMode;
  const sortHost = root.querySelector('.manager-sort');
  sortHost.innerHTML = selectMarkup({ id: `${root.id}-sort`, label: '项目排序', value: 'default', options: [{ value: 'default', label: '默认排序' }, { value: 'name', label: '按名称排序' }] });
  const search = root.querySelector('input'), sort = sortHost.querySelector('lh-select');
  search.oninput = sort.onchange = () => render();
  function updateProjectSelection() {
    for (const item of root.querySelectorAll('[data-project-id]')) {
      const selected = selectedRoute?.project_id === item.dataset.projectId && selectedRoute.team_id === team;
      item.classList.toggle('selected', selected); item.setAttribute('aria-pressed', String(selected));
    }
    for (const item of nav.querySelectorAll('.manager-category')) {
      const active = !selectedRoute && view === item.dataset.view;
      item.classList.toggle('active', active); item.setAttribute('aria-current', String(active));
    }
    for (const item of nav.querySelectorAll('.manager-folder')) {
      const active = !selectedRoute && (item.dataset.folderId ? view === 'folder' && folder === item.dataset.folderId : view === 'overview');
      item.classList.toggle('active', active);
    }
  }
  function chooseProject(project, fromTree = false) {
    const route = { project_id: project.id, team_id: team };
    selectedRoute = route; onSelectionChange(route);
    if (fromTree) { view = project.folder_id ? 'folder' : 'all'; folder = project.folder_id || ''; if (folder) expanded.add(folder); search.value = ''; render(); }
    else updateProjectSelection();
  }
  function placeholder(parent, count, cards = false) {
    for (let index = 0; index < count; index++) {
      const item = element('div', cards ? 'manager-card manager-card-placeholder' : 'manager-tree-placeholder');
      item.setAttribute('aria-hidden', 'true');
      if (cards) item.innerHTML = '<div class="manager-cover manager-skeleton"></div><div class="manager-card-label"><span class="manager-skeleton"></span></div>';
      else item.innerHTML = '<span class="manager-skeleton"></span><span class="manager-skeleton"></span>';
      parent.append(item);
    }
  }
  function render() {
    nav.replaceChildren(); grid.replaceChildren(); recentGrid.replaceChildren();
    recentSection.hidden = !['overview', 'recent'].includes(view); allSection.hidden = view === 'recent';
    allSection.querySelector('h2').hidden = view === 'folder';
    const loading = listLoading || pendingFolders.has(folder);
    nav.setAttribute('aria-busy', String(treeLoading || pendingFolders.size > 0)); grid.setAttribute('aria-busy', String(loading));
    const chosen = folders.find(item => item.id === folder);
    root.querySelector('h1').textContent = chosen ? `团队文件 › ${chosen.name}` : view === 'recent' ? '团队文件 › 最近' : view === 'all' ? '团队文件 › 全部' : '团队文件';
    const folderButton = (item, depth = 0) => {
      const row = element('div', `manager-folder${(!selectedRoute && (item.id ? folder === item.id && view === 'folder' : view === 'overview')) ? ' active' : ''}`); row.dataset.folderId = item.id; row.style.paddingLeft = `${8 + depth * 16}px`;
      const children = item.id ? folders.filter(child => child.parent_id === item.id) : [];
      const toggle = element('button', 'manager-toggle'); toggle.innerHTML = icon(expanded.has(item.id) ? 'chevron-down' : 'chevron-right');  toggle.ariaLabel = `展开或收起 ${item.name}`;
      toggle.setAttribute('aria-expanded', String(expanded.has(item.id)));
      toggle.onclick = () => { expanded.has(item.id) ? expanded.delete(item.id) : expanded.add(item.id); render(); if (item.id && expanded.has(item.id)) void loadFolder(item.id); };
      const button = element('button', 'manager-folder-name'); button.innerHTML = icon('folder'); button.append(document.createTextNode(item.name)); button.title = item.name;
      button.onclick = () => { selectedRoute = null; onSelectionChange(null); view = item.id ? 'folder' : 'overview'; folder = item.id; expanded.add(item.id); render(); if (item.id) void loadFolder(item.id); }; row.append(toggle, button); nav.append(row);
      if (!item.id && expanded.has('')) for (const [key, label, glyph] of [['recent', '最近', 'history'], ['all', '全部', 'panels-top-left']]) {
        const category = element('button', `manager-category${!selectedRoute && view === key ? ' active' : ''}`);
        category.dataset.view = key; category.innerHTML = icon(glyph); category.append(element('span', '', label));
        category.onclick = () => { selectedRoute = null; onSelectionChange(null); view = key; folder = ''; render(); }; nav.append(category);
      }
      if (expanded.has(item.id)) for (const child of children) if (child.id !== item.id && depth < 30) folderButton(child, depth + 1);
      if (item.id && expanded.has(item.id)) for (const project of projects.filter(project => project.folder_id === item.id)) {
        const entry = element('button', 'manager-project-entry'); entry.style.paddingLeft = `${38 + depth * 16}px`;
        entry.innerHTML = icon('panels-top-left'); entry.append(element('span', '', project.name || '未命名项目')); entry.title = project.name;
        entry.dataset.projectId = project.id;
        entry.onclick = () => chooseProject(project, true); nav.append(entry);
      }
      if (item.id && expanded.has(item.id) && pendingFolders.has(item.id)) placeholder(nav, 3);
    };
    if (treeLoading) placeholder(nav, 7);
    else {
      folderButton({ id: '', name: '全部项目' });
      for (const item of folders.filter(item => !item.parent_id || !folders.some(parent => parent.id === item.parent_id))) folderButton(item);
    }
    const matches = item => String(item.name || '').toLowerCase().includes(search.value.trim().toLowerCase());
    const visible = projects.filter(item => (!folder || item.folder_id === folder) && matches(item));
    const recent = recentProjects.filter(matches);
    if (sort.value === 'name') visible.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-CN'));
    else visible.sort((a, b) => (Number(b.order) || 0) - (Number(a.order) || 0));
    const cards = (entries, target) => {
      if (loading) { placeholder(target, 4, true); return; }
      for (const project of entries) {
        const card = element('button', 'manager-card'); card.title = project.name; card.onclick = () => chooseProject(project);
        card.dataset.projectId = project.id;
        const open = () => openProject({ project_id: project.id, team_id: team });
        card.ondblclick = open; card.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); open(); } };
        const preview = element('div', 'manager-cover'); preview.innerHTML = icon('panels-top-left');
        if (project.cover) { try { const image = element('img', ''); image.alt = ''; preview.append(image); void assignImage(image, resource(project.cover), { placeholder: true }); } catch {} }
        const label = element('div', 'manager-card-label'); label.innerHTML = icon('panels-top-left'); label.append(element('span', '', project.name || '未命名项目')); card.append(preview, label); target.append(card);
      }
    };
    if (!recentSection.hidden) cards(recent, recentGrid);
    if (!allSection.hidden) cards(visible, grid);
    recentSection.querySelector('.manager-section-empty').hidden = loading || recent.length > 0;
    const visibleCount = view === 'recent' ? recent.length : view === 'overview' ? recent.length + visible.length : visible.length;
    updateProjectSelection();
    status.textContent = loading ? '' : listError || folderErrors.get(folder) || (visibleCount || view === 'recent' ? '' : search.value ? '没有匹配的项目' : '当前目录暂无项目，可通过链接打开项目。');
  }
  async function loadFolder(id) {
    if (loadedFolders.has(id) || pendingFolders.has(id)) return;
    const current = generation;
    pendingFolders.add(id); folderErrors.delete(id); render();
    try {
      const data = await api('projects', { team_id: team, folder_id: id });
      if (current !== generation || root.hidden) return;
      const entries = (data.projects || []).map(project => ({ ...project, folder_id: id }));
      rememberCatalog(entries, team);
      const ids = new Set(entries.map(project => project.id));
      projects = projects.filter(project => project.folder_id !== id && !ids.has(project.id)).concat(entries);
      loadedFolders.add(id);
    } catch (error) {
      if (current === generation) folderErrors.set(id, `文件夹项目加载失败：${error.message}，请再次点击文件夹重试。`);
    } finally {
      if (current === generation) { pendingFolders.delete(id); render(); }
    }
  }
  async function loadTeam() {
    const current = ++generation; team = select.value; folder = ''; view = 'overview'; projects = []; folders = []; recentProjects = []; expanded.clear(); expanded.add('');
    treeLoading = listLoading = !!team; listError = '';
    selectedRoute = null; onSelectionChange(null);
    loadedFolders.clear(); pendingFolders.clear(); folderErrors.clear();
    render();
    if (team) void rememberTeam(team).catch(() => { status.textContent = '无法保存团队选择，下次打开可能需要重新选择。'; });
    if (!team) { status.textContent = '暂无可访问的团队，可通过链接打开项目。'; return; }
    try {
      const selectedTeam = team;
      const [data, history] = await Promise.all([api('projects', { team_id: selectedTeam }), recallRecentProjects()]);
      if (current !== generation || root.hidden) return;
      projects = data.projects || []; folders = data.folders || []; rememberCatalog(projects, team);
      const recent = history.filter(route => route.team_id === selectedTeam || !route.team_id && projects.some(project => project.id === route.project_id));
      const resolved = await Promise.all(recent.map(async route => {
        const project = projects.find(item => item.id === route.project_id); if (project) return project;
        try {
          const raw = unwrap(await api('project', { project_id: route.project_id, team_id: selectedTeam }));
          const detail = raw.project || raw;
          return detail.name ? { ...detail, id: route.project_id } : null;
        } catch { return null; }
      }));
      if (current !== generation || root.hidden) return;
      recentProjects = resolved.filter(Boolean); rememberCatalog(recentProjects, team);
    }
    catch (error) { if (current === generation) listError = `项目加载失败：${error.message}，请点击刷新重试。`; }
    finally { if (current === generation) { treeLoading = listLoading = false; render(); } }
  }
  return {
    cancel() { generation++; },
    async show(preferredTeam) {
      projects = []; folders = []; recentProjects = []; view = 'overview'; expanded.clear(); expanded.add(''); pendingFolders.clear(); loadedFolders.clear(); folderErrors.clear();
      const current = ++generation; setTeams(); treeLoading = listLoading = true; listError = ''; selectedRoute = null; onSelectionChange(null); render();
      search.value = '';
      try {
        const [data, recent] = await Promise.all([api('teams'), recallTeam()]);
        if (current !== generation || root.hidden) return;
        setTeams(data.teams || [], recent || preferredTeam || team);
        await loadTeam();
      } catch (error) { if (current === generation) { treeLoading = listLoading = false; listError = `团队加载失败：${error.message}，请点击刷新重试或通过链接打开。`; render(); } }
    }
  };
}
