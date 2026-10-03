import { handleAgent } from './agent';
import { collect } from './collect';

export default {
  fetch: (request, env) => handleAgent(request, env),
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(collect(env, new Date(controller.scheduledTime)));
  },
} satisfies ExportedHandler<Env>;
