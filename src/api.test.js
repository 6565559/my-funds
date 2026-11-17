import { afterEach, expect, test, vi } from 'vitest';
import { api } from './api';
afterEach(()=>vi.unstubAllGlobals());
test('保留409状态供定投表单恢复并发冲突',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:409,json:async()=>({error:'计划已更新'})}));
  await expect(api.addDcaBuy('p',{})).rejects.toMatchObject({status:409,message:'计划已更新'});
});
