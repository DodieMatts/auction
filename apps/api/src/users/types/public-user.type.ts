import type { UserRole, UserStatus } from "../../generated/prisma/enums";

export type PublicUser = {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
};
