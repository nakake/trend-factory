import { handleAgent } from './agent';
import { collect } from './collect';

export default {
  fetch: (request, env) => handleAgent(request, env),
  // waitUntil にすると例外が実行結果に出ないので await する
  async scheduled(controller, env) {
    await collect(env, new Date(controller.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
