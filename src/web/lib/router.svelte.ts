// Minimal hash router: #/ , #/s/<surveyId> , #/r/<rackId> , #/d/<deviceId>|new?rack=&pos=
export type Route =
  | { name: 'home' }
  | { name: 'settings' }
  | { name: 'import' }
  | { name: 'survey'; id: string }
  | { name: 'rack'; id: string }
  | { name: 'room'; id: string }
  | { name: 'plan'; id: string }
  | { name: 'room3d'; id: string }
  | { name: 'device'; id: string; params: URLSearchParams };

function parse(hash: string): Route {
  const [path, qs = ''] = hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(qs);
  if (parts[0] === 's' && parts[1]) return { name: 'survey', id: parts[1] };
  if (parts[0] === 'r' && parts[1]) return { name: 'rack', id: parts[1] };
  if (parts[0] === 'room' && parts[1] && parts[2] === '3d') return { name: 'room3d', id: parts[1] };
  if (parts[0] === 'room' && parts[1] && parts[2] === 'plan') return { name: 'plan', id: parts[1] };
  if (parts[0] === 'room' && parts[1]) return { name: 'room', id: parts[1] };
  if (parts[0] === 'd' && parts[1]) return { name: 'device', id: parts[1], params };
  if (parts[0] === 'settings') return { name: 'settings' };
  if (parts[0] === 'import') return { name: 'import' };
  return { name: 'home' };
}

export const router = $state({ route: parse(location.hash) as Route });

addEventListener('hashchange', () => {
  router.route = parse(location.hash);
  scrollTo(0, 0);
});

export const go = (hash: string) => {
  location.hash = hash;
};
