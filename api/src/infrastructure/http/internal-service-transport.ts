const loopbackHostnames = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function isLoopbackHostname(hostname: string): boolean {
  return loopbackHostnames.has(hostname.toLowerCase());
}

export function isAllowedDevelopmentLoopbackHttpUrl(value: string | undefined): boolean {
  if (!value) return false;

  try {
    const url = new URL(value);
    return url.protocol === 'http:'
      && isLoopbackHostname(url.hostname)
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && url.pathname.endsWith('/');
  } catch {
    return false;
  }
}
