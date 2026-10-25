import { prisma } from "../../db";

const MYMINIFACTORY_API_KEY_KEY = "myminifactory_api_key";

// Instance-wide, like the Thingiverse token: the key belongs to whichever account created it.
export async function getMyminifactoryApiKey(): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key: MYMINIFACTORY_API_KEY_KEY } });
  const value = row?.value;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function setMyminifactoryApiKey(value: string | null): Promise<void> {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    await prisma.setting.deleteMany({ where: { key: MYMINIFACTORY_API_KEY_KEY } });
    return;
  }
  await prisma.setting.upsert({
    where: { key: MYMINIFACTORY_API_KEY_KEY },
    create: { key: MYMINIFACTORY_API_KEY_KEY, value: trimmed },
    update: { value: trimmed },
  });
}
