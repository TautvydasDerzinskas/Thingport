-- CreateEnum
CREATE TYPE "AiProviderKind" AS ENUM ('openai', 'anthropic');

-- AlterTable: every AI added so far spoke the OpenAI-style API.
ALTER TABLE "AiConnection" ADD COLUMN "kind" "AiProviderKind" NOT NULL DEFAULT 'openai';
