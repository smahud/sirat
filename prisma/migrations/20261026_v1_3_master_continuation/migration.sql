-- AlterTable
ALTER TABLE "Unit" ADD COLUMN     "description" TEXT;

-- AlterTable
ALTER TABLE "Committee" ADD COLUMN     "description" TEXT;

-- AlterTable
ALTER TABLE "LetterType" ADD COLUMN     "notes" TEXT,
ADD COLUMN     "purpose" TEXT,
ADD COLUMN     "usageExamples" TEXT;

-- CreateTable
CREATE TABLE "LetterReference" (
    "id" TEXT NOT NULL,
    "letterId" TEXT NOT NULL,
    "refLetterId" TEXT,
    "refNumberText" TEXT NOT NULL,
    "isAutoLinked" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LetterReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "unitId" TEXT,
    "committeeId" TEXT,
    "canExport" BOOLEAN NOT NULL DEFAULT false,
    "canRestore" BOOLEAN NOT NULL DEFAULT false,
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackupGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupEvent" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "fileName" TEXT,
    "sizeBytes" INTEGER,
    "sha256" TEXT,
    "status" TEXT NOT NULL DEFAULT 'STARTED',
    "scopeJson" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "BackupEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LetterReference_letterId_refLetterId_key" ON "LetterReference"("letterId", "refLetterId");

-- CreateIndex
CREATE UNIQUE INDEX "BackupGrant_userId_unitId_committeeId_key" ON "BackupGrant"("userId", "unitId", "committeeId");

-- AddForeignKey
ALTER TABLE "LetterReference" ADD CONSTRAINT "LetterReference_letterId_fkey" FOREIGN KEY ("letterId") REFERENCES "Letter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LetterReference" ADD CONSTRAINT "LetterReference_refLetterId_fkey" FOREIGN KEY ("refLetterId") REFERENCES "Letter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackupGrant" ADD CONSTRAINT "BackupGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackupGrant" ADD CONSTRAINT "BackupGrant_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackupGrant" ADD CONSTRAINT "BackupGrant_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "Committee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

