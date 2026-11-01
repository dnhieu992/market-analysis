export type AuthUser = {
  id: string;
  email: string;
  name: string;
  symbolsTracking: string[];
  createdAt?: Date;
  updatedAt?: Date;
};

export type AuthenticatedRequest = {
  headers?: {
    cookie?: string;
    'user-agent'?: string;
    'x-forwarded-for'?: string | string[];
  };
  ip?: string;
  socket?: { remoteAddress?: string };
  authUser?: AuthUser;
  /** Id of the session row the request authenticated with. */
  authSessionId?: string;
};
