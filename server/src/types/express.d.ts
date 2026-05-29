import type { Session } from '../auth/sessions';
import type { DB } from '../db/crypto-db';

declare global {
  namespace Express {
    interface Request {
      /** Present only on authenticated (unlocked + valid session) requests. */
      session?: Session;
      /** The unlocked DB handle, attached alongside a valid session. */
      db?: DB;
    }
  }
}

export {};
