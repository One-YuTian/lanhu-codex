import { expect, it } from 'vitest';
import { ConcurrentTasks } from '../panel/compression-tasks';
const tick = () => new Promise(resolve => setTimeout(resolve,0));
it('默认最多 5 并发，重复任务只执行一次，空闲槽补充后续任务', async () => {
 const started:string[] = [], finish = new Map<string,()=>void>(); let peak=0, active=0;
 const queue=new ConcurrentTasks(async id=>{ started.push(id);active++;peak=Math.max(peak,active);await new Promise<void>(resolve=>finish.set(id,resolve));active--; });
 queue.enqueue(['a','b','c','d','e','f','g','a']);await tick();expect(started).toEqual(['a','b','c','d','e']);expect(queue.activeCount).toBe(5);
 finish.get('a')!();await tick();expect(started).toContain('f');expect(queue.activeCount).toBe(5);expect(peak).toBe(5);
 for(const fn of finish.values()) fn();await tick();for(const fn of finish.values()) fn();await tick();expect(queue.activeCount).toBe(0);expect(new Set(started).size).toBe(7);
});
it('暂停后不启动排队项，当前任务可完成；恢复时只运行显式加入的任务', async () => {
 const started:string[]=[], finish=new Map<string,()=>void>();const queue=new ConcurrentTasks(async id=>{started.push(id);await new Promise<void>(resolve=>finish.set(id,resolve));});
 queue.setConcurrency(1);queue.enqueue(['a','b','c']);await tick();queue.pause();finish.get('a')!();await tick();expect(started).toEqual(['a']);expect(queue.queuedCount).toBe(0);
 queue.resume();queue.enqueue(['b']);await tick();expect(started).toEqual(['a','b']);finish.get('b')!();await tick();expect(queue.activeCount).toBe(0);
});
it('调低并发不取消活动任务，之后遵守新上限；失败不阻断后续任务', async () => {
 const started:string[]=[], finish=new Map<string,()=>void>();const queue=new ConcurrentTasks(async id=>{started.push(id);if(id==='bad')throw new Error('fixture');await new Promise<void>(resolve=>finish.set(id,resolve));});
 queue.setConcurrency(2);queue.enqueue(['a','b','bad','c']);await tick();queue.setConcurrency(1);finish.get('a')!();await tick();expect(started).toEqual(['a','b']);finish.get('b')!();await tick();await tick();expect(started).toEqual(['a','b','bad','c']);finish.get('c')!();await tick();expect(queue.activeCount).toBe(0);
 expect(()=>queue.setConcurrency(0)).toThrow('1–20');
});
