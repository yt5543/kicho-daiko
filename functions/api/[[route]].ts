/// <reference types="@cloudflare/workers-types" />
import app from '../../src/server/app';
import type { Bindings } from '../../src/types';

export const onRequest: PagesFunction<Bindings> = (context) => {
  return app.fetch(
    context.request,
    context.env,
    context as unknown as ExecutionContext
  );
};
