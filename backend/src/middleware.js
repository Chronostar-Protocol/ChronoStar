import rateLimit from 'express-rate-limit';

const STELLAR_PUBLIC_KEY_RE = /^G[A-Z0-9]{55}$/;

export function validateStellarAddress(req, res, next) {
  const { address } = req.params;
  if (!STELLAR_PUBLIC_KEY_RE.test(address)) {
    return res.status(400).json({ error: 'Invalid Stellar address. Must be a G-starting 56-character public key.' });
  }
  next();
}

export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

export const addressRouteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests for this address, please try again later.' },
});

export const eventsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
