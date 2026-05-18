import jwt from 'jsonwebtoken';

const SECRET = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('Missing JWT_SECRET env var');
  return s;
};

export function signToken(payload = {}) {
  return jwt.sign(payload, SECRET(), { expiresIn: '12h' });
}

export function verifyToken(token) {
  return jwt.verify(token, SECRET()); // throws if invalid/expired
}

/**
 * Middleware helper — call at the top of any protected API route.
 * Returns the decoded payload, or sends 401 and returns null.
 */
export function requireAuth(req, res) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return null;
  }
  try {
    return verifyToken(header.slice(7));
  } catch {
    res.status(401).json({ error: 'Token invalid or expired' });
    return null;
  }
}
