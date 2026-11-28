CREATE TABLE "PreviewImageUpload" (
    "printId" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "imageId" TEXT,
    "contentSha256" TEXT NOT NULL,

    CONSTRAINT "PreviewImageUpload_pkey" PRIMARY KEY ("printId", "uploadId"),
    CONSTRAINT "PreviewImageUpload_printId_fkey"
        FOREIGN KEY ("printId") REFERENCES "Print"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
