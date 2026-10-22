import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';

import { PROFILE_COOKIE, PROFILE_PATH } from './app/account-profile';

const engine = new AngularNodeAppEngine({
  allowedHosts: ['127.0.0.1', 'localhost'],
});

/**
 * The account's preference, kept in a cookie only this deployment reads, which stands in for the
 * session a real account would be looked up by.
 */
function answerProfile(method: string, cookie: string, body: string) {
  const stored = cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PROFILE_COOKIE}=`))
    ?.slice(PROFILE_COOKIE.length + 1);
  if (method === 'GET') {
    return { status: 200, body: stored ?? '', cookie: undefined };
  }
  if (method === 'PUT' && /^[A-Za-z0-9-]{1,64}$/u.test(body)) {
    return {
      status: 204,
      body: '',
      cookie: `${PROFILE_COOKIE}=${body}; Path=/; HttpOnly; SameSite=Lax`,
    };
  }
  if (method === 'DELETE') {
    return {
      status: 204,
      body: '',
      cookie: `${PROFILE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
    };
  }
  return { status: 400, body: '', cookie: undefined };
}

export const reqHandler = createNodeRequestHandler(
  async (request, response, next) => {
    try {
      const host = request.headers.host ?? 'localhost';
      if (
        new URL(request.url ?? '/', `http://${host}`).pathname === PROFILE_PATH
      ) {
        let body = '';
        for await (const chunk of request) body += String(chunk);
        const answer = answerProfile(
          request.method ?? 'GET',
          request.headers.cookie ?? '',
          body,
        );
        response.statusCode = answer.status;
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        if (answer.cookie !== undefined) {
          response.setHeader('Set-Cookie', answer.cookie);
        }
        response.end(answer.body);
        return;
      }
      const answered = await engine.handle(request);
      if (answered === null) {
        next();
        return;
      }
      await writeResponseToNodeResponse(answered, response);
    } catch (error: unknown) {
      next(error);
    }
  },
);
