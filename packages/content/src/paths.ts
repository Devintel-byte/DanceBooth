import path from 'node:path';

/**
 * Resolves a renderer-supplied relative asset path inside `root`.
 * Returns null for anything that could escape the root: absolute paths,
 * drive letters, UNC paths, `..` segments, encoded traversal, NUL bytes,
 * or Windows alternate data streams.
 */
export function resolveAssetPath(root: string, requested: string): string | null {
  let rel: string;
  try {
    rel = decodeURIComponent(requested);
  } catch {
    return null;
  }
  if (rel.length === 0 || rel.length > 260) return null;
  if (rel.includes('\0') || rel.includes(':') || rel.includes('\\')) return null;
  if (rel.startsWith('/') || rel.startsWith('//')) return null;
  const segments = rel.split('/');
  if (segments.some((s) => s === '..' || s === '.' || s === '')) return null;
  if (!/^[A-Za-z0-9_\-./]+$/.test(rel)) return null;

  const absRoot = path.resolve(root);
  const resolved = path.resolve(absRoot, ...segments);
  const relative = path.relative(absRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}

export const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.fbx': 'application/octet-stream',
  '.gltf': 'model/gltf+json',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

export function mimeTypeFor(filePath: string): string | null {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? null;
}
