import type { UserRole, UserStatus } from "../../generated/prisma/enums";

export type AuthUser = {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
};
