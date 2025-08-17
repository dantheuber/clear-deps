import { PrismaClient } from '@prisma/client';
export const prisma = new PrismaClient({
    log: ['error', 'warn'],
});
//# sourceMappingURL=db.js.map