import { expect, it, vi } from 'vitest';
import { AnnotationStore, annotationPrompt, annotationTarget, annotationVisible, annotationProjection, annotationTargetsInRect, annotationLabel, annotationDescription } from '../panel/canvas/annotations.js';
import { buildGroups } from '../panel/canvas/model.js';
import { appendAnnotationDraft } from '../panel/annotation-draft';
import { annotationHitTarget, annotationInstructions } from '../panel/canvas/annotations.js';
import { OpenAIMessageParamsSchema } from '@openai/mcp-extensions/app';
import { createAnnotationDraftSender } from '../panel/annotation-draft';

const board = { id: 'board', name: '画板', x: 500, y: 100, width: 750, height: 1300 };
const groups = buildGroups([{ id: 'root', name: '目录' }, { id: 'group', name: '玩法', parent_id: 'root', images: ['board'] }], [board]);
const context = { route: { project_id: 'project', team_id: 'team' }, filter: 'group', groups, boards: [board], detail: false, layers: [] };

it('多轮标注复用同一个发送连接，按提交顺序追加；失败后仍不切换会话或自动重试', async () => {
  let finish!: () => void;
  const send = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({}); }))
    .mockResolvedValueOnce({ isError: true }).mockResolvedValue({});
  const provider = vi.fn(() => ({ send }) as any);
  const sender = createAnnotationDraftSender(provider, { getHostCapabilities: () => ({ message: { text: {} } }) } as any);
  const first = sender([{ title: '第一轮', prompt: '修改按钮' }]);
  const second = sender([{ title: '第二轮', prompt: '修改标题' }]);
  const rejected = expect(second).rejects.toThrow('未能确认');
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  finish(); await first; await rejected;
  await sender([{ title: '第三轮', prompt: '修改背景' }]);
  expect(provider).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledTimes(3);
  expect(send.mock.calls.map(([message]) => message.content[0].text)).toEqual(['修改按钮', '修改标题', '修改背景']);
  for (const [message] of send.mock.calls) expect(message._meta['openai/message']).toEqual({ target: 'active', send: false });
});

it('分组画布和画板标注保持对象 ID、分组路径和局部坐标', () => {
  expect(annotationTarget(context, { x: 530, y: 140 }, 'board')).toMatchObject({ target_id: 'board', image_id: 'board', path: ['目录', '玩法', '画板'], x: 30, y: 40 });
  expect(annotationTarget(context, { x: 30, y: 40 })).toMatchObject({ target_id: 'group', image_id: '', path: ['目录', '玩法', '分组画布'], x: 30, y: 40 });
  expect(annotationTarget({ ...context, filter: 'root' }, { x: 530, y: 140 }, 'board').path).toEqual(['目录', '玩法', '画板']);
});
it('详情标注命中最深子层，包含画板、组、父子层级和具体对象 ID', () => {
  const layers = [{ id: 'parent', name: '容器', parentId: '', depth: 1, x: 0, y: 0, width: 500, height: 500 },
    { id: 'child', name: '按钮', parentId: 'parent', depth: 2, x: 20, y: 30, width: 100, height: 60 }];
  expect(annotationTarget({ ...context, detail: true, boards: [{ ...board, x: 0, y: 0 }], layers }, { x: 40, y: 50 }, 'board'))
    .toMatchObject({ target_id: 'child', target_type: 'layer', path: ['目录', '玩法', '画板', '容器', '按钮'] });
});
it('连续编号、编辑和删除使用同一标注集合，删除后重新连续编号', () => {
  const store = new AnnotationStore();
  const first = store.add(annotationTarget(context, { x: 10, y: 20 }));
  const second = store.add(annotationTarget(context, { x: 20, y: 20 }));
  store.update(second.id, '调整间距'); store.remove(first.id);
  expect(store.items.map(item => [item.number, item.text])).toEqual([[1, '调整间距']]);
  expect(store.add(annotationTarget(context, { x: 0, y: 0 })).number).toBe(2);
  expect(annotationPrompt(store.items)).toContain('id:group');
});
it('仅宿主确认草稿成功后清空；等待期间防止重复追加和修改，失败保留全部标注', async () => {
  const store = new AnnotationStore(), item = store.add(annotationTarget(context, { x: 1, y: 2 }, 'board'));
  store.update(item.id, '修改图片');
  let confirm!: () => void;
  const sender = vi.fn(() => new Promise<void>(resolve => { confirm = resolve; }));
  const pending = store.send(sender);
  expect(store.items).toHaveLength(1); expect(store.busy).toBe(true);
  store.remove(item.id); store.update(item.id, '不应修改');
  await expect(store.send(sender)).rejects.toThrow('重复');
  expect(store.items[0].text).toBe('修改图片'); expect(sender).toHaveBeenCalledTimes(1);
  confirm(); await pending; expect(store.items).toHaveLength(0);
  const next = store.add(annotationTarget(context, { x: 0, y: 0 })); expect(next.number).toBe(1);
  store.update(next.id, '保留');
  await expect(store.send(async () => { throw new Error('宿主失败'); })).rejects.toThrow('宿主失败');
  expect(store.items[0].text).toBe('保留'); expect(store.busy).toBe(false);
});
it('提交每条标注的可评审文本，不调用资源登记，不自动发送', async () => {
  const items = [{ title: '1.对象「按钮」', prompt: '标注内容：调整字号\n对象 ID：button' }, { title: '2.页面「首页」', prompt: '标注内容：调整布局\n页面 ID：home' }];
  const send = vi.fn(async () => ({})), callServerTool = vi.fn();
  const app = { getHostCapabilities: () => ({ message: { text: {} } }), callServerTool } as any;
  await appendAnnotationDraft({ send } as any, app, items);
  expect(send).toHaveBeenCalledWith({ role: 'user', content: items.map(item => ({ type: 'text', text: item.prompt, _meta: { 'openai/title': item.title } })),
    _meta: { 'openai/message': { target: 'active', send: false } } });
  expect(callServerTool).not.toHaveBeenCalled();
  expect(JSON.stringify(send.mock.calls[0])).not.toContain('resource_link');
  expect(JSON.stringify(send.mock.calls[0])).not.toContain('lanhu://selection');
  expect(OpenAIMessageParamsSchema.parse(send.mock.calls[0][0]).content).toHaveLength(2);
  await expect(appendAnnotationDraft(undefined, app, items)).rejects.toThrow('不支持');
  await expect(appendAnnotationDraft({ send } as any, { ...app, getHostCapabilities: () => ({}) }, items)).rejects.toThrow('不支持');
  await expect(appendAnnotationDraft({ send: async () => ({ isError: true }) } as any, app, items)).rejects.toThrow('尚未清空');
});
it('仅真实命中页面或图层时可创建标注，详情画板外不回退为分组标注', () => {
  expect(annotationHitTarget(context, { x: 20, y: 20 })).toBeNull();
  expect(annotationHitTarget(context, { x: 530, y: 140 }, 'board')).toMatchObject({ target_id: 'board', target_type: 'artboard' });
  const detail = { ...context, detail: board, layers: [{ id: 'layer', name: '图层', x: 20, y: 20, width: 100, height: 100, depth: 1 }] };
  expect(annotationHitTarget(detail, { x: 540, y: 140 })).toMatchObject({ target_id: 'layer', target_type: 'layer' });
  expect(annotationHitTarget(detail, { x: 10, y: 10 }, 'board')).toBeNull();
  expect(annotationHitTarget({ ...context, boards: [] }, { x: 530, y: 140 })).toBeNull();
});
it('详情标注在可见画板的分组中也显示，但不混入其他画板或详情加载状态', () => {
  const groupNote = annotationTarget(context, { x: 530, y: 140 }, 'board');
  const detailContext = { ...context, detail: { id: 'board' }, route: { ...context.route, image_id: 'board' } };
  const detailNote = annotationTarget(detailContext, { x: 530, y: 140 }, 'board');
  expect(annotationVisible(groupNote, context)).toBe(true);
  expect(annotationVisible(detailNote, detailContext)).toBe(true);
  expect(annotationVisible(detailNote, context)).toBe(true);
  expect(annotationVisible(detailNote, { ...context, boards: [] })).toBe(false);
  expect(annotationVisible(groupNote, detailContext)).toBe(false);
  expect(annotationVisible(groupNote, { ...context, route: detailContext.route })).toBe(false);
  expect(annotationVisible(detailNote, { ...detailContext, detail: { id: 'other' } })).toBe(false);
});
it('详情气泡与选择框按分组画板位置、大小映射，保存的原始坐标不变', () => {
  const source = { ...board, x: 0, y: 0 }, detailContext = { ...context, detail: source, boards: [source] };
  const target = annotationTarget(detailContext, { x: 200, y: 100 }, 'board');
  const projected = annotationProjection({ ...target, bounds: { x: 20, y: 40, width: 200, height: 100 }, area: { x: 10, y: 30, width: 400, height: 200 } },
    { ...context, boards: [{ ...board, width: 375, height: 650 }] });
  expect(projected).toEqual({ x: 600, y: 150, bounds: { x: 510, y: 120, width: 100, height: 50 }, area: { x: 505, y: 115, width: 200, height: 100 } });
  expect(target).toMatchObject({ x: 200, y: 100, artboard_size: { width: 750, height: 1300 } });
});
it('清空重置全部标注和序号，提交期间不能清空', async () => {
  const store = new AnnotationStore(), item = store.add(annotationTarget(context, { x: 10, y: 10 }));
  store.update(item.id, '保留');
  let resolve!: () => void;
  const pending = store.send(() => new Promise<void>(done => { resolve = done; }));
  store.clear(); expect(store.items).toHaveLength(1);
  resolve(); await pending;
  store.add(annotationTarget(context, { x: 10, y: 10 })); store.clear();
  expect(store.items).toHaveLength(0); expect(store.add(annotationTarget(context, { x: 10, y: 10 })).number).toBe(1);
});
it('分组框选只命中可见画板，详情框选忽略隐藏图层并保留最深对象路径', () => {
  const second = { ...board, id: 'second', name: '第二画板', x: 1400 };
  expect(annotationTargetsInRect({ ...context, boards: [board, second] }, { x: 400, y: 50, width: 1500, height: 300 }).map(item => item.target_id)).toEqual(['board', 'second']);
  const detailContext = { ...context, detail: board, layers: [
    { id: 'group-layer', name: '组件组', x: 0, y: 0, width: 600, height: 300 },
    { id: 'a', name: '文字', parentId: 'group-layer', x: 10, y: 10, width: 100, height: 60 },
    { id: 'b', name: '图标', parentId: 'group-layer', x: 200, y: 10, width: 100, height: 60 },
    { id: 'hidden', visible: false, x: 0, y: 0, width: 300, height: 300 }
  ] };
  const targets = annotationTargetsInRect(detailContext, { x: 500, y: 100, width: 500, height: 200 });
  expect(targets.map(item => item.target_id)).toEqual(['a', 'b']);
  expect(targets[0].path).toEqual(['目录', '玩法', '画板', '组件组', '文字']);
  const item = { ...targets[0], targets, number: 1, text: '修改选中的对象' };
  expect(annotationLabel(item)).toBe('1.文字、图标');
  const prompt = annotationPrompt([item]);
  expect(prompt).toContain('id:a'); expect(prompt).toContain('id:b');
  expect(prompt).toContain('page:"目录/玩法/画板"'); expect(prompt).toContain('path:"组件组/图标"');
});
it('空白标注不能发送，输入内容有长度限制', async () => {
  const store = new AnnotationStore(), item = store.add(annotationTarget(context, { x: 0, y: 0 }));
  await expect(store.send(vi.fn())).rejects.toThrow('填写');
  store.update(item.id, 'a'.repeat(5000)); expect(store.items[0].text).toHaveLength(4000);
});
it('评审文本明确区分页面、对象及混合多选，包含完整内容、路径和具体 ID', () => {
  const page = annotationTarget(context, { x: 530, y: 140 }, 'board');
  const layer = { ...page, target_type: 'layer', target_id: 'button', path: ['目录', '玩法', '画板', '按钮'] };
  expect(annotationDescription(page)).toBe('页面「画板」');
  expect(annotationDescription(layer)).toBe('对象「按钮」');
  const item = { ...page, targets: [page, layer], text: '增大按钮字号，调整页面布局', number: 1 };
  expect(annotationDescription(item)).toBe('多选（1 个页面、1 个对象，共 2 项）');
  const text = annotationPrompt([item]);
  for (const content of ['增大按钮字号，调整页面布局', 'multi(page:1,object:1)', 'imageid:board', 'id:button', 'page:"目录/玩法/画板"', 'path:"按钮"', 'pid:project', 'tid:team']) expect(text).toContain(content);
  expect(text).not.toContain('lanhu://selection');
});
it('同一页面合并一个标题块，公共 ID 与路径只写一次，无 URL', () => {
  const page = annotationTarget(context, { x: 530, y: 140 }, 'board');
  const object = { ...page, target_type: 'layer', target_id: 'button', path: [...page.path, '组件', '按钮'] };
  const items = [{ ...page, number: 1, text: '调整页面' }, { ...object, number: 2, text: '增大按钮' }];
  const blocks = annotationInstructions(items);
  expect(blocks).toHaveLength(1); expect(blocks[0].title).toBe('画板页面：共2处标记');
  for (const key of ['pid:project', 'tid:team', 'imageid:board', 'page:"目录/玩法/画板"']) expect(blocks[0].prompt.split(key)).toHaveLength(2);
  for (const note of ['#1 page', '调整页面', '#2 object', '增大按钮', 'id:button\n  path:"组件/按钮"']) expect(blocks[0].prompt).toContain(note);
  expect(blocks[0].prompt).not.toMatch(/https?:|url|项目 ID|团队 ID|所属画板/);
});
it('跨页面多选拆分页面块，各块不混入其他页面目标，同页后续标注继续合并', () => {
  const first = annotationTarget(context, { x: 530, y: 140 }, 'board');
  const second = { ...first, image_id: 'second', image_name: '第二页', target_id: 'second-layer', target_type: 'layer', page_path: ['目录', '第二页'], path: ['目录', '第二页', '图标'] };
  const blocks = annotationInstructions([{ ...first, targets: [first, second], number: 1, text: '统一调整' }, { ...second, number: 2, text: '补充说明' }]);
  expect(blocks.map(item => item.title)).toEqual(['画板页面：统一调整', '第二页页面：共2处标记']);
  expect(blocks[0].prompt).not.toContain('second-layer'); expect(blocks[0].prompt).not.toContain('补充说明');
  expect(blocks[1].prompt).toContain('id:second-layer\n  path:"图标"'); expect(blocks[1].prompt).toContain('补充说明');
  expect(blocks[1].prompt).not.toContain('imageid:board');
  expect(annotationInstructions([{ ...first, number: 1, text: 'A' }, { ...first, project_id: 'other', number: 2, text: 'B' }])).toHaveLength(2);
});
it('Composer 标题按单处描述或多处数量命名，定位字段使用冒号和换行', () => {
  const page = annotationTarget(context, { x: 530, y: 140 }, 'board');
  const first = { ...page, image_name: '首页', number: 1, text: '调整按钮\n间距' };
  const single = annotationInstructions([first])[0];
  expect(single.title).toBe('首页页面：调整按钮 间距');
  expect(single.prompt.split('\n').slice(0, 5)).toEqual(['pid:project', 'tid:team', 'imageid:board', 'gid:group', 'page:"目录/玩法/画板"']);
  expect(single.prompt).toContain('#1 page\nat:30,40\n调整按钮\n间距');
  expect(single.prompt).not.toMatch(/(?:pid|tid|imageid|gid|page|at|path)=/);
  expect(annotationInstructions([first, { ...first, number: 2, text: '修改颜色' }])[0].title).toBe('首页页面：共2处标记');
  expect(annotationInstructions([{ ...first, image_name: '详情页面' }])[0].title).toBe('详情页面：调整按钮 间距');
});
