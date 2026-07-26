import type { PublicUser } from "../../users/types/public-user.type";

export type AuthenticatedRequest = {
  headers: {
    authorization?: string | string[];
  };
  user?: PublicUser;
};
