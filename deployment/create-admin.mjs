import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../dist/database/connection.js';
import { newPassword } from '../dist/shared/password.js';

try {
  const email = z.email().parse(process.env.ADMIN_EMAIL).toLowerCase();
  const fullName = z.string().trim().min(1).max(160).parse(process.env.ADMIN_NAME);
  const password = newPassword.parse(process.env.ADMIN_PASSWORD);
  // INSERT deliberately refuses an existing email; it never resets an account.
  await db.execute(
    'INSERT INTO users(email,password_hash,full_name,role) VALUES(?,?,?,?)',
    [email, await bcrypt.hash(password, 12), fullName, 'ADMIN'],
  );
  console.log(`Created admin ${email}`);
} catch (error) {
  console.error(error instanceof z.ZodError ? 'Invalid admin name, email or password (8–72 UTF-8 bytes).' : `Admin creation failed (${error.code ?? 'unknown error'}).`);
  process.exitCode = 1;
} finally {
  await db.end();
}
