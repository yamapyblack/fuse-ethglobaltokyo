import dotenv from "dotenv";

dotenv.config({ path: [".env.local", ".env"], quiet: true });

export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (web/.env.local)`);
  return value;
}
