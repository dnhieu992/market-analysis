export type AuthUser = {
  id: string;
  email: string;
  name: string;
  createdAt?: Date;
  updatedAt?: Date;
};

export type AuthenticatedRequest = {
  headers?: {
    cookie?: string;
  };
  authUser?: AuthUser;
};
