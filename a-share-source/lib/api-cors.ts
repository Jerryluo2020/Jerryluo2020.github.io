const allowedOrigin = 'https://jerryluo2020.github.io';
export function cors(request: Request, response: Response) {
  if (request.headers.get('Origin') === allowedOrigin) {
    response.headers.set('Access-Control-Allow-Origin', allowedOrigin);
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type');
    response.headers.append('Vary', 'Origin');
  }
  return response;
}
export function preflight(request: Request) {
  return cors(request, new Response(null, {status: request.headers.get('Origin') === allowedOrigin ? 204 : 403}));
}
