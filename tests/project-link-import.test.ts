import { expect, it, vi } from 'vitest';
import { resolveProjectInput } from '../panel/canvas/lanhu-links.js';
import { nativeTransport } from '../panel/canvas-transport';
const invite='https://lanhuapp.com/link/#/invite?sid=example123';
it('邀请链接没有 pid 时调用解析器，保留返回的项目、团队和设计稿',async()=>{
 const resolve=vi.fn(async()=>({project_id:'project',team_id:'team',image_id:'image'}));
 expect(await resolveProjectInput(invite,resolve)).toEqual({project_id:'project',team_id:'team',image_id:'image'});expect(resolve).toHaveBeenCalledWith(invite);
});
it('完整链接本地打开，分享文本中的单个邀请链接也能解析',async()=>{
 const resolve=vi.fn(async()=>({project_id:'shared'}));
 expect(await resolveProjectInput('https://lanhuapp.com/web/#/item/project/stage?pid=direct&tid=t',resolve)).toEqual({project_id:'direct',team_id:'t'});expect(resolve).not.toHaveBeenCalled();
 expect(await resolveProjectInput(`分享项目：${invite}，请查看。`,resolve)).toEqual({project_id:'shared'});
});
it('失效、无效域名和多个链接给出可理解提示，不伪造项目或误判权限',async()=>{
 await expect(resolveProjectInput(invite,async()=>null)).rejects.toThrow('未能从邀请链接获取项目地址');
 const resolve=vi.fn();await expect(resolveProjectInput('https://evil.example/?pid=p',resolve)).rejects.toThrow('有效的蓝湖');expect(resolve).not.toHaveBeenCalled();
 await expect(resolveProjectInput(`${invite} https://lanhuapp.com/web/?pid=other`,resolve)).rejects.toThrow('一次导入一个');
 await expect(resolveProjectInput(invite,async()=>({project_id:'../invalid'}))).rejects.toThrow('未能从邀请链接获取项目地址');
});
it.each(['&', '\\&', '&amp;'])('用户提供的完整项目链接保留转义分隔符后的团队参数（%s）',async separator=>{
 const resolve=vi.fn();
 expect(await resolveProjectInput(`https://lanhuapp.com/web/#/item/project/stage?pid=11111111-1111-4111-8111-111111111111${separator}tid=22222222-2222-4222-8222-222222222222`,resolve)).toEqual({project_id:'11111111-1111-4111-8111-111111111111',team_id:'22222222-2222-4222-8222-222222222222'});
 expect(resolve).not.toHaveBeenCalled();
});
it('原生解析通道使用 url 参数，图片资源继续使用 target_url',async()=>{
 const callServerTool=vi.fn(async()=>({content:[],_meta:{'lanhu/response':{data:{route:{project_id:'p'}}}}}));
 const transport=nativeTransport({callServerTool,openLink:vi.fn()} as any);
 const response=await transport.fetch(`/api/resolve?${new URLSearchParams({url:invite})}`);
 expect(callServerTool.mock.calls[0][0]).toEqual({name:'lanhu_canvas_request',arguments:{endpoint:'resolve',url:invite}});
 expect((await response.json()).route).toEqual({project_id:'p'});
 await transport.fetch('/api/resource?url=https%3A%2F%2Fassets.lanhuapp.com%2Fimage.png');
 expect(callServerTool.mock.calls[1][0]).toEqual({name:'lanhu_canvas_request',arguments:{endpoint:'resource',target_url:'https://assets.lanhuapp.com/image.png'}});
});
