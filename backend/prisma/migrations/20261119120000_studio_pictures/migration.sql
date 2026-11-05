-- AlterTable
ALTER TABLE "User" ADD COLUMN "studioPromptLayout" TEXT;

-- AlterTable
ALTER TABLE "StudioMessage" ADD COLUMN "pictures" JSONB;

-- AlterTable
ALTER TABLE "AiConnection" ADD COLUMN "vision" BOOLEAN NOT NULL DEFAULT false;

-- The AIs already set up start as their model's name suggests, as a new one does (guessVision in
-- aiConnectionService.ts); an admin can change any of them.
UPDATE "AiConnection" SET "vision" = true
WHERE "kind" = 'anthropic'
   OR "model" ~* '(gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-5|^o[134]([-_]|$)|gemini|claude|llava|vision|vl([-_:.]|$)|gemma-?3|minicpm-v|pixtral|llama-?4|mistral-small-?3\.[12]|moondream|internvl|multimodal|omni)';
