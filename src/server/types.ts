import type { Prisma, PrismaClient } from "@prisma/client";
import type { Role } from "@/domain/roles";

export type Db = PrismaClient;
export type Tx = Prisma.TransactionClient;

/** The authenticated user performing an action. */
export interface Actor {
  id: string;
  name: string;
  email: string;
  roles: Role[];
}
